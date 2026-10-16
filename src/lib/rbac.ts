// The docs/08 role matrix, written once so no route re-derives it.

export type Role = "doctor" | "receptionist" | "admin" | "agent";

export type Permission =
  | "patients:read"
  | "patients:write"
  | "patients:merge"
  | "appointments:read"
  | "appointments:write"
  | "prescriptions:read"
  | "prescriptions:write"
  | "escalations:read"
  | "escalations:create"
  | "escalations:resolve"
  | "tasks:write";

const STAFF: Permission[] = [
  "patients:read", "appointments:read", "appointments:write",
  "prescriptions:read", "escalations:create",
  // Front desk: register walk-ins, add notes, keep the task list.
  "patients:write", "tasks:write",
];

/** Working the escalation inbox — taking one on and closing it. */
const INBOX: Permission[] = ["escalations:read", "escalations:resolve"];

const MATRIX: Record<Role, Permission[]> = {
  // The agent can create escalations but never resolve them, and never writes prescriptions.
  agent: ["patients:read", "appointments:read", "appointments:write",
          "prescriptions:read", "escalations:create"],
  // Merging two records is a desk judgement; a doctor never merges.
  receptionist: [...STAFF, ...INBOX, "patients:merge"],
  // No inbox: an escalation is a front-desk job. The doctor's screens are his
  // own queue and his own patients — see src/lib/doctor.ts.
  doctor: [...STAFF, "prescriptions:write"],
  admin:  [...STAFF, ...INBOX, "prescriptions:write", "patients:merge"],
};

export const can = (role: Role, p: Permission) => MATRIX[role].includes(p);

export class Forbidden extends Error {
  constructor(role: Role, p: Permission) {
    super(`role '${role}' is not permitted to '${p}'`);
    this.name = "Forbidden";
  }
}

export function requirePermission(role: Role, p: Permission) {
  if (!can(role, p)) throw new Forbidden(role, p);
}
