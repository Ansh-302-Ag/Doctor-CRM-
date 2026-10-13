/**
 * What the escalation inbox tells staff: which message raised each item, and
 * the reason in plain words.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, type Fixture } from "./helpers";
import { listEscalations, describeReason } from "../src/lib/escalations";

let f: Fixture;
const actor = () => ({ kind: "staff" as const, id: f.receptionistId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

test("each escalation shows the message that raised it", async () => {
  const t = (iso: string) => new Date(`2026-09-22T${iso}:00Z`);
  await db`
    insert into messages (conversation_id, direction, body, created_at) values
      (${f.conversationId}, 'inbound', 'first message', ${t("10:00")}),
      (${f.conversationId}, 'inbound', 'second message', ${t("12:00")})`;
  const [early] = await db<{ id: string }[]>`
    insert into escalations (conversation_id, patient_id, reason, created_at)
    values (${f.conversationId}, ${f.patientId}, 'clinical question', ${t("11:00")}) returning id`;
  const [late] = await db<{ id: string }[]>`
    insert into escalations (conversation_id, patient_id, reason, created_at)
    values (${f.conversationId}, ${f.patientId}, 'clinical question', ${t("13:00")}) returning id`;

  const rows = await listEscalations(db, actor(), "receptionist", f.clinicId);
  const byId = (id: string) => rows.find(r => r.id === id)!;
  assert.equal(byId(early.id).trigger_message, "first message");
  assert.equal(byId(late.id).trigger_message, "second message");
});

test("describeReason gives staff a plain label and keeps the raw text", () => {
  const cases: [string, string, string][] = [
    ["emergency signal: chest pain", "Emergency", "danger"],
    ["clinical question: dose?", "Medical question", "warn"],
    ["repeatedly unreadable voice note", "Voice note or photo — couldn't read it", "warn"],
    ["repeatedly unclear request", "Couldn't understand the request", "neutral"],
    ["intent unclear", "Couldn't understand the request", "neutral"],
    ['classifier unavailable: provider error 400 {"error":{"message":"bad"}}',
      "Assistant couldn't process this message", "neutral"],
    ["reply could not be delivered: 131047", "Our reply didn't reach the patient", "warn"],
    ["message could not be processed", "Message couldn't be processed", "warn"],
    ["reminder could not be delivered", "Reminder didn't reach the patient", "warn"],
    ["something new", "Needs a person", "neutral"],
  ];
  for (const [reason, label, tone] of cases) {
    assert.deepEqual(describeReason(reason), { label, tone, detail: reason }, reason);
  }
});
