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

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR, user: "postgres", password: "devpass",
  port: PORT, persistent: true,
  // Without this Postgres binds a unix socket only and every TCP client sees
  // ECONNREFUSED.
  postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
  onLog: () => {},
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
  console.error(
    `\n[db] Postgres would not start on port ${PORT}.\n\n` +
    `  - Another copy may already be running. Stop it, or set LOCAL_DB_PORT.\n` +
    `  - A previous run may have left a lock behind. Delete this file and retry:\n` +
    `      ${join(DATA_DIR, "postmaster.pid")}\n`);
  if (e) console.error(e);
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
