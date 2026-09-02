/**
 * Migration runner. Applies every db/*.sql not yet recorded in schema_migrations,
 * in filename order, each inside its own transaction.
 *
 * ponytail: no migration framework — a directory of numbered SQL files and a
 * table of applied names is the whole feature. Revisit if we ever need down-migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) throw new Error("pass a connection string or set DATABASE_URL");

const dir = join(import.meta.dirname, "..", "db");
const sql = postgres(url, { max: 1, onnotice: () => {} });

/** Postgres has no parameter binding in DDL, so the agent password is inlined.
 *  Quote it as a literal the same way the server would. */
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  await sql`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now()
  )`;
  const applied = new Set(
    (await sql<{ name: string }[]>`select name from schema_migrations`).map(r => r.name),
  );
  const dbName = (await sql<{ current_database: string }[]>`select current_database()`)[0].current_database;

  for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(dir, file), "utf8")
      .replaceAll(":AGENT_PASSWORD", quote(process.env.AGENT_DB_PASSWORD ?? "agent"))
      .replaceAll("current_database_placeholder", `"${dbName}"`);
    await sql.begin(async tx => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  console.log("migrations up to date");
  await sql.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
