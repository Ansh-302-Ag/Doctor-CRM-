import postgres, { type Sql, type TransactionSql } from "postgres";

const url = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_POOLED (or DATABASE_URL) is not set");

/** Application pool — full privileges, used by the CRM and by staff-initiated work.
 *  The pooled endpoint, not the direct one: this process opens many short-lived
 *  queries per request, which is what Neon's pooler is for. The direct endpoint
 *  is for migrations and tests, which need session-level features. */
export const sql = postgres(url, { max: 10, onnotice: () => {} });

/**
 * The agent's pool. It connects as the restricted `clinic_agent` role so the
 * grants in db/002_agent_role.sql actually bind at runtime — the agent physically
 * cannot write a prescription, whatever the application layer does.
 *
 * Falls back to the app pool only when AGENT_DATABASE_URL is unset (e.g. before
 * migration 002 has run); the app-layer RBAC check still applies in that case.
 */
const agentUrl = process.env.AGENT_DATABASE_URL;
if (!agentUrl) {
  const message =
    "AGENT_DATABASE_URL is not set: the agent would run with full database " +
    "privileges, and the docs/08 guarantee that it cannot write prescriptions " +
    "would rest on application code alone.";
  // In production this is a deployment error, not a convenience. Failing here
  // is far better than discovering the barrier was off after the fact.
  if (process.env.NODE_ENV === "production") throw new Error(message);
  console.warn(`[db] WARNING — ${message}`);
}

export const agentSql = agentUrl
  ? postgres(agentUrl, { max: 5, onnotice: () => {} })
  : sql;

/** Anything you can run a query on — the pool, or a transaction handle from
 *  `sql.begin`. Business logic takes this so callers choose the transaction. */
export type Db = Sql<{}> | TransactionSql<{}>;

/** A connection pool — the thing you can open a transaction on. */
export type Pool = Sql<{}>;
