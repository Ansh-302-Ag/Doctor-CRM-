/**
 * Test runner.
 *
 * The suite used to require TEST_DATABASE_URL pointing at a Neon database. From
 * India that is ~280 ms per query, which made a full run take minutes and made
 * every edit expensive to verify. So by default this starts a throwaway
 * Postgres on the local machine, migrates it, runs the suite against it, and
 * shuts it down again — the same schema, no network.
 *
 * Setting TEST_DATABASE_URL still wins, so the pre-existing "run it against
 * real Neon" path is unchanged and is what to use before trusting a release.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

const repo = join(import.meta.dirname, "..");
const DATA_DIR = join(repo, ".pgdata");
const PORT = 55432;
const LOCAL_URL = `postgresql://postgres:devpass@127.0.0.1:${PORT}/clinic_test`;

/** Run a command, inheriting stdio, and resolve with its exit code. */
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: repo, stdio: "inherit", env, shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("close", code => resolve(code ?? 1));
  });

// `npm test -- tests/booking.test.ts` runs one file; no argument runs them all.
const files = process.argv.slice(2);
const testArgs = ["--test", "--test-concurrency=1", "--env-file=.env.local",
  ...(files.length ? files : ["tests/*.test.ts"])];

async function main(): Promise<number> {
  if (process.env.TEST_DATABASE_URL) {
    console.log("[test] using TEST_DATABASE_URL from the environment");
    return run("npx", ["tsx", ...testArgs], process.env);
  }

  console.log("[test] starting a local Postgres (no TEST_DATABASE_URL set)");
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR, user: "postgres", password: "devpass",
    port: PORT, persistent: true,
    // Without this Postgres listens on a unix socket only, and every test
    // fails with ECONNREFUSED against 127.0.0.1 — the tests connect over TCP.
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
    onLog: () => {},
  });

  // A previous run killed mid-flight leaves a stale lock that blocks startup.
  // The data is disposable by construction, so removing it beats asking.
  const stale = join(DATA_DIR, "postmaster.pid");
  if (existsSync(stale)) rmSync(stale);
  if (!existsSync(join(DATA_DIR, "PG_VERSION"))) await pg.initialise();

  await pg.start();
  try {
    const admin = postgres(LOCAL_URL.replace(/\/clinic_test$/, "/postgres"), { max: 1, onnotice: () => {} });
    const [existing] = await admin<{ n: number }[]>`
      select count(*)::int as n from pg_database where datname = 'clinic_test'`;
    if (existing.n === 0) await admin.unsafe("create database clinic_test");
    await admin.end();

    const code = await run("npx", ["tsx", "--env-file=.env.local", "scripts/migrate.ts", LOCAL_URL], process.env);
    if (code !== 0) return code;

    // `await` matters: `return run(...)` would let the finally below stop
    // Postgres the moment the child is spawned, not when it finishes.
    const testCode = await run("npx", ["tsx", ...testArgs], { ...process.env, TEST_DATABASE_URL: LOCAL_URL });
    return testCode;
  } finally {
    await pg.stop().catch(() => {});
  }
}

// Leaving a Postgres running after Ctrl-C would block the next run.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(130));

main().then(code => process.exit(code), err => { console.error(err); process.exit(1); });
