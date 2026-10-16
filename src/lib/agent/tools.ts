/**
 * The agent's entire tool set (docs/05). There is deliberately no tool for
 * answering a clinical question and no tool for writing a prescription — the
 * absence is the safety mechanism, not the prompt wording.
 *
 * Every tool runs as actor 'agent' with role 'agent', so the docs/08 matrix and
 * the audit trail apply without any caller having to remember to pass them.
 */
import type { Db } from "../db";
import {
  checkAvailability, bookAppointment, rescheduleAppointment,
  cancelAppointment, getUpcomingAppointments,
} from "../booking";
import { audit } from "../audit";
import { createRecordLink } from "../record-links";
import { requirePermission } from "../rbac";

const AGENT = { kind: "agent" } as const;
const ROLE = "agent" as const;

export const tools = {
  check_availability: (db: Db, doctorId: string, day: string, now?: Date) =>
    checkAvailability(db, doctorId, day, now),

  book_appointment: (
    db: Db,
    a: { patientId: string; doctorId: string; startsAt: Date; reasonText?: string },
    now?: Date,
  ) => bookAppointment(db, AGENT, ROLE, a, now),

  reschedule_appointment: (
    db: Db, a: { appointmentId: string; patientId: string; startsAt: Date }, now?: Date,
  ) => rescheduleAppointment(db, AGENT, ROLE, a, now),

  cancel_appointment: (db: Db, a: { appointmentId: string; patientId: string }) =>
    cancelAppointment(db, AGENT, ROLE, a),

  get_upcoming_appointments: (db: Db, patientId: string) =>
    getUpcomingAppointments(db, AGENT, ROLE, patientId),

  /** "My prescription": the agent never reads the record into chat (Meta's
   *  policy forbids health information on WhatsApp). It only checks there is
   *  something active and creates a secure, code-protected link to it.
   *  Null when there is nothing active. */
  prescription_link: async (db: Db, patientId: string) => {
    requirePermission(ROLE, "prescriptions:read");
    const [row] = await db<{ n: number }[]>`
      select count(*)::int as n from prescriptions
       where patient_id = ${patientId} and status = 'active'`;
    if (row.n === 0) return null;
    const { url } = await createRecordLink(db, patientId);
    await audit(db, AGENT, "create_record_link", "patients", patientId);
    return url;
  },

  escalate_to_human: async (a: {
    db: Db; conversationId: string; patientId: string; reason: string;
    priority?: "normal" | "emergency";
  }) => {
    const db = a.db;
    requirePermission(ROLE, "escalations:create");
    const [row] = await db<{ id: string }[]>`
      insert into escalations (conversation_id, patient_id, reason, priority)
      values (${a.conversationId}, ${a.patientId}, ${a.reason}, ${a.priority ?? "normal"})
      returning id`;
    await audit(db, AGENT, "escalate_to_human", "escalations", row.id);
    return row;
  },
} as const;

export type ToolName = keyof typeof tools;
