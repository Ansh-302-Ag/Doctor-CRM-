// The docs/08 role matrix, written once so no route re-derives it.

export type Role = "doctor" | "receptionist" | "admin" | "agent";

export type Permission =
  | "patients:read"
  | "appointments:read"
  | "appointments:write"
  | "prescriptions:read"
  | "prescriptions:write"
  | "escalations:read"
  | "escalations:create"
  | "escalations:resolve";

const STAFF: Permission[] = [
  "patients:read", "appointments:read", "appointments:write",
  "prescriptions:read", "escalations:read", "escalations:create", "escalations:resolve",
];

const MATRIX: Record<Role, Permission[]> = {
  // The agent can create escalations but never resolve them, and never writes prescriptions.
  agent: ["patients:read", "appointments:read", "appointments:write",
          "prescriptions:read", "escalations:create"],
  receptionist: STAFF,
  doctor: [...STAFF, "prescriptions:write"],
  admin:  [...STAFF, "prescriptions:write"],
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
