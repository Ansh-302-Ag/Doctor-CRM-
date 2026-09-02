import postgres, { type Sql, type TransactionSql } from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

/** Application pool — full privileges, used by the CRM and by staff-initiated work. */
export const sql = postgres(url, { max: 10, onnotice: () => {} });

/**
 * The agent's pool. It connects as the restricted `clinic_agent` role so the
 * grants in db/002_agent_role.sql actually bind at runtime — the agent physically
 * cannot write a prescription, whatever the application layer does.
 *
 * Falls back to the app pool only when AGENT_DATABASE_URL is unset (e.g. before
 * migration 002 has run); the app-layer RBAC check still applies in that case.
 */
export const agentSql = process.env.AGENT_DATABASE_URL
  ? postgres(process.env.AGENT_DATABASE_URL, { max: 5, onnotice: () => {} })
  : sql;

/** Anything you can run a query on — the pool, or a transaction handle from
 *  `sql.begin`. Business logic takes this so callers choose the transaction. */
export type Db = Sql<{}> | TransactionSql<{}>;
