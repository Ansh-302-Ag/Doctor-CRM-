import type { Db } from "./db";

export type Actor = { kind: "staff"; id: string } | { kind: "agent" };

export const actorId = (a: Actor) => (a.kind === "agent" ? "agent" : a.id);

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
