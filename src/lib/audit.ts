import type { Db } from "./db";

export type Actor =
  | { kind: "staff"; id: string } | { kind: "agent" }
  /** A patient viewing their own record through a secure link (record-links.ts). */
  | { kind: "patient"; id: string };

/** Staff are stored as their bare id and the agent as 'agent', as ever; a
 *  patient is prefixed so their id can never be mistaken for a staff id. */
export const actorId = (a: Actor) =>
  a.kind === "agent" ? "agent" : a.kind === "patient" ? `patient:${a.id}` : a.id;

/**
 * Append-only record of who touched what (docs/08). Pass the transaction handle
 * where there is one, so the audit row commits or rolls back with the work itself.
 */
export async function audit(
  db: Db, actor: Actor, action: string, targetTable: string, targetId: string | null,
) {
  await db`
    insert into audit_log (actor, action, target_table, target_id)
    values (${actorId(actor)}, ${action}, ${targetTable}, ${targetId})
  `;
}
