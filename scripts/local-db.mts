/**
 * A Postgres for development, on this machine.
 *
 * The database was on Neon in Virginia, which is ~280 ms per query from India.
 * One WhatsApp message costs a dozen sequential queries, so that alone was
 * three to four seconds of every reply. Running Postgres beside the app takes
 * that to about a millisecond.
 *
 *   npm run db          # start it, leave this terminal open
 *
 * Data lives in .pgdata/ (gitignored) and survives restarts. This is the
 * development convenience — a real deployment runs a real Postgres service,
 * not this.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

const repo = join(import.meta.dirname, "..");
const DATA_DIR = process.env.LOCAL_DB_DIR ?? join(repo, ".pgdata");
const PORT = Number(process.env.LOCAL_DB_PORT ?? 55433);   // 55432 is the test database
const DATABASES = ["clinic", "clinic_test"];

/** Postgres is chatty when it works and the only witness when it does not, so
 *  keep the last lines and print them only if something goes wrong. */
const recent: string[] = [];
const remember = (line: unknown) => {
  const text = line instanceof Error ? (line.stack ?? line.message) : String(line);
  for (const l of text.split("\n")) if (l.trim()) recent.push(l);
  while (recent.length > 40) recent.shift();
};

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR, user: "postgres", password: "devpass",
  port: PORT, persistent: true,
  // Without this Postgres binds a unix socket only and every TCP client sees
  // ECONNREFUSED.
  postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
  onLog: remember,
  onError: remember,
});

// A run killed mid-flight leaves a pid file naming a process that is gone.
try { rmSync(join(DATA_DIR, "postmaster.pid"), { force: true }); } catch { /* postgres will */ }
if (!existsSync(join(DATA_DIR, "PG_VERSION"))) {
  console.log("[db] first run — initialising the cluster (once)");
  await pg.initialise();
}

try {
  await pg.start();
} catch (e) {
  // embedded-postgres surfaces a start failure as an undefined rejection, which
  // tells you nothing. The overwhelmingly common cause is a second copy already
  // running, or a pid file left by one that was killed.
  // Postgres refuses to run as an administrator on Windows, by design. It is
  // the most likely reason on that platform and says nothing about the cluster,
  // so name it before the disposable-data advice sends someone deleting things.
  if (recent.some(l => /administrative permissions is not permitted/i.test(l))) {
    console.error(
      `\n[db] Postgres will not run from an administrator terminal — that is a\n` +
      `     deliberate refusal on its part, not a problem with your data.\n\n` +
      `     Open a normal PowerShell (not "Run as administrator") and try again.\n` +
      `     The cluster in ${DATA_DIR} is fine; do not delete it.\n`);
    process.exit(1);
  }

  console.error(
    `\n[db] Postgres would not start on port ${PORT}.\n\n` +
    `  - Another copy may already be running. Stop it, or set LOCAL_DB_PORT.\n` +
    `  - Otherwise the cluster is unusable: a lock left by a run that was\n` +
    `    killed, or a directory created by a different operating system (a\n` +
    `    Postgres data directory is not portable between them). This data is\n` +
    `    disposable — delete the whole directory and run this again:\n\n` +
    `      ${DATA_DIR}\n\n` +
    `    Then 'npm run migrate' and 'npm run seed' to rebuild it.\n`);
  if (e) console.error(e);
  if (recent.length) {
    console.error("[db] what Postgres itself said:\n");
    for (const line of recent) console.error(`    ${line}`);
    console.error("");
  } else {
    console.error("[db] Postgres printed nothing at all before failing.\n");
  }
  process.exit(1);
}

const admin = postgres(
  `postgresql://postgres:devpass@127.0.0.1:${PORT}/postgres`, { max: 1, onnotice: () => {} });
for (const name of DATABASES) {
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from pg_database where datname = ${name}`;
  if (row.n === 0) { await admin.unsafe(`create database "${name}"`); console.log(`[db] created ${name}`); }
}
await admin.end();

console.log(`\n  Postgres is up on 127.0.0.1:${PORT}\n`);
console.log(`  DATABASE_URL=postgresql://postgres:devpass@127.0.0.1:${PORT}/clinic`);
console.log(`\n  Leave this running. Ctrl-C to stop.\n`);

const stop = async () => { await pg.stop().catch(() => {}); process.exit(0); };
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
// Nothing else keeps the process alive; the cluster is a separate process.
setInterval(() => {}, 1 << 30);
