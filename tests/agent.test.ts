/**
 * End-to-end conversation behaviour (docs/05 flows, docs/08 failure modes).
 * These run the real handler against the real database.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, type Fixture } from "./helpers";
import { handleInbound } from "../src/lib/agent";
import { CONSENT_NOTICE } from "../src/lib/consent";
import { scripted } from "./stub-classifier";
import { ClassifierUnavailable } from "../src/lib/agent/intent";

let f: Fixture;
let seq = 0;

beforeEach(async () => { await reset(); f = await seed(); seq = 0; });
after(closeAll);

/** Send a message as the consenting patient seeded above. */
const say = (body: string, opts: { phone?: string; id?: string } = {}) =>
  handleInbound(db, {
    clinicId: f.clinicId,
    phone: opts.phone ?? "+919000000001",
    body,
    providerMessageId: opts.id ?? `wamid.${++seq}`,
  }, new Date(), scripted);

const escalations = () =>
  db<{ reason: string; priority: string; status: string }[]>`
    select reason, priority, status from escalations order by created_at`;

test("happy path: book an appointment end to end", async () => {
  const a = await say("Hi, I need an appointment with Dr. Rao");
  assert.match(a!.text, /what day/i);

  const b = await say("tomorrow");
  assert.match(b!.text, /these times are free/i);

  const offered = b!.text.match(/• ([^\n]+)/g)!;
  assert.ok(offered.length > 0);

  const firstTime = offered[0].match(/(\d{1,2}:\d{2})/)![1];
  const c = await say(`${firstTime} works`);
  assert.match(c!.text, /you are booked/i);
  assert.equal(c!.escalated, false);

  const rows = await db`select status, created_by from appointments`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "booked");
  assert.equal(rows[0].created_by, "agent");
  assert.equal((await escalations()).length, 0);
});

test("a clinical question escalates and books nothing", async () => {
  const r = await say("I'm on the antibiotics Dr Rao gave me, can I take paracetamol too?");
  assert.equal(r!.escalated, true);
  assert.match(r!.text, /not able to answer medical questions/i);

  const e = await escalations();
  assert.equal(e.length, 1);
  assert.equal(e[0].priority, "normal");
  assert.equal(e[0].status, "open");

  assert.equal((await db`select id from appointments`).length, 0);
});

test("the reply to a clinical question contains no clinical content", async () => {
  const r = await say("can I take ibuprofen with amoxicillin");
  // It must not name a drug, a dose, or a yes/no. It routes, it does not answer.
  assert.doesNotMatch(r!.text, /\b(yes|no|safe|unsafe|avoid|take it|do not take|mg)\b/i);
});

test("an emergency gets the templated response and a priority escalation", async () => {
  const r = await say("I'm having chest pain right now");
  assert.equal(r!.escalated, true);
  assert.match(r!.text, /emergency/i);
  assert.match(r!.text, /112/);

  const e = await escalations();
  assert.equal(e[0].priority, "emergency");
});

test("a clinical question wrapped inside a booking request still escalates", async () => {
  const r = await say("book me a slot on Friday, and is this rash normal?");
  assert.equal(r!.escalated, true);
  assert.equal((await db`select id from appointments`).length, 0);
});

test("an unclear message escalates rather than guessing", async () => {
  const r = await say("asdf qwerty ????");
  assert.equal(r!.escalated, true);
  assert.equal((await escalations())[0].reason, "intent unclear");
});

test("a new patient is asked for consent and cannot book until they give it", async () => {
  const a = await say("I want to book an appointment", { phone: "+919000000009" });
  assert.equal(a!.text, CONSENT_NOTICE);

  const [p] = await db<{ consent_status: string }[]>`
    select consent_status from patients where phone = '+919000000009'`;
  assert.equal(p.consent_status, "pending");
  assert.equal((await db`select id from appointments`).length, 0);

  const b = await say("yes", { phone: "+919000000009" });
  assert.match(b!.text, /thank you/i);
  const [after_] = await db<{ consent_status: string }[]>`
    select consent_status from patients where phone = '+919000000009'`;
  assert.equal(after_.consent_status, "granted");

  const [log] = await db<{ action: string; notice_version: string }[]>`
    select action, notice_version from consent_log`;
  assert.equal(log.action, "granted");
  assert.ok(log.notice_version);
});

test("a duplicate webhook delivery is a no-op", async () => {
  const first = await say("I need an appointment", { id: "wamid.duplicate" });
  const second = await say("I need an appointment", { id: "wamid.duplicate" });

  assert.ok(first);
  assert.equal(second, null, "the redelivered message must produce no second reply");

  const inbound = await db`select id from messages where direction = 'inbound'`;
  assert.equal(inbound.length, 1);
});

test("a duplicate delivery cannot create a duplicate appointment", async () => {
  await say("appointment with Dr Rao");
  const offer = await say("tomorrow");
  const time = offer!.text.match(/(\d{1,2}:\d{2})/)![1];

  await say(`${time}`, { id: "wamid.confirm" });
  const again = await say(`${time}`, { id: "wamid.confirm" });

  assert.equal(again, null);
  assert.equal((await db`select id from appointments where status = 'booked'`).length, 1);
});

test("cancelling works and frees the slot", async () => {
  await say("appointment with Dr Rao");
  const offer = await say("tomorrow");
  const time = offer!.text.match(/(\d{1,2}:\d{2})/)![1];
  await say(time);

  const r = await say("cancel");
  assert.match(r!.text, /cancelled/i);
  assert.equal((await db`select id from appointments where status = 'booked'`).length, 0);
});

test("reading the prescription record repeats it verbatim and offers no advice", async () => {
  await db`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, duration_days, created_by)
           values (${f.patientId}, ${f.doctorId}, 'Amoxicillin', '500mg twice daily', 5,
                   ${f.doctorUserId})`;

  const r = await say("what is my prescription");
  assert.match(r!.text, /Amoxicillin/);
  assert.match(r!.text, /500mg twice daily/);
  assert.match(r!.text, /speak to the clinic team/i);
  assert.equal(r!.escalated, false);
});

test("'when is my appointment' reads back, it does not start a booking", async () => {
  await say("appointment with Dr Rao");
  const offer = await say("tomorrow");
  await say(offer!.text.match(/(\d{1,2}:\d{2})/)![1]);

  const r = await say("when is my next appointment");
  assert.match(r!.text, /upcoming appointments/i);
  assert.equal((await db`select id from appointments where status = 'booked'`).length, 1);
});

test("withdrawing consent cancels appointments and soft-deletes the patient", async () => {
  await say("appointment with Dr Rao");
  const offer = await say("tomorrow");
  await say(offer!.text.match(/(\d{1,2}:\d{2})/)![1]);

  const r = await say("delete my data");
  assert.match(r!.text, /withdrawn/i);

  const [p] = await db<{ consent_status: string; deleted_at: Date | null }[]>`
    select consent_status, deleted_at from patients where id = ${f.patientId}`;
  assert.equal(p.consent_status, "withdrawn");
  assert.ok(p.deleted_at);
  assert.equal((await db`select id from appointments where status = 'booked'`).length, 0);
});

test("an ambiguous slot reply escalates instead of picking one", async () => {
  await say("appointment with Dr Rao");
  await say("tomorrow");

  const r = await say("whichever is fine");
  assert.equal(r!.escalated, true);
  assert.equal((await db`select id from appointments`).length, 0);
});

test("conversation state lives in the database, not in memory", async () => {
  await say("appointment with Dr Rao");
  const [c] = await db<{ state: { flow?: string; step?: string } }[]>`
    select state from conversations where patient_id = ${f.patientId}`;
  assert.equal(c.state.flow, "booking");
  assert.equal(c.state.step, "awaiting_day");
});

test("every inbound and outbound message is recorded", async () => {
  await say("I need an appointment");
  const rows = await db<{ direction: string }[]>`
    select direction from messages order by created_at`;
  assert.deepEqual([...rows].map(r => r.direction), ["inbound", "outbound"]);
});

test("the whole loop works while connected as the restricted agent role", async () => {
  // Everything above runs as the app role. This one proves the agent's own
  // database grants are sufficient for its job and no wider (docs/08).
  const { agentDb } = await import("./helpers");
  const asAgent = (body: string, id: string, over: Record<string, unknown> = {}) =>
    handleInbound(agentDb, {
      clinicId: f.clinicId, phone: "+919000000077", body, providerMessageId: id,
    }, new Date(), async (i) => ({ ...(await scripted(i)), ...(i.body === body ? over : {}) }));

  assert.match((await asAgent("I want an appointment", "a1"))!.text, /store your name/i);
  assert.match((await asAgent("yes", "a2"))!.text, /what name/i);
  assert.match((await asAgent("Priya Nair", "a3", { intent: "provide_name", name: "Priya Nair" }))!.text,
    /what day/i);
  const offer = await asAgent("tomorrow", "a4");
  assert.match(offer!.text, /these times are free/i);
  const time = offer!.text.match(/(\d{1,2}:\d{2})/)![1];
  assert.match((await asAgent(time, "a5"))!.text, /you are booked/i);

  const rows = await db`select created_by from appointments where status = 'booked'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].created_by, "agent");
});

test("a clinical question escalates correctly as the restricted agent role", async () => {
  const { agentDb } = await import("./helpers");
  const r = await handleInbound(agentDb, {
    clinicId: f.clinicId, phone: "+919000000001",
    body: "can I take this with my BP medicine", providerMessageId: "b1",
  }, new Date(), scripted);
  assert.equal(r!.escalated, true);
  assert.equal((await db`select id from escalations`).length, 1);
});

test("consenting resumes the original request instead of dropping it", async () => {
  const p = "+919000000055";
  const a = await handleInbound(db, {
    clinicId: f.clinicId, phone: p, body: "when is my next appointment",
    providerMessageId: "c1",
  }, new Date(), scripted);
  assert.equal(a!.text, CONSENT_NOTICE);

  const b = await handleInbound(db, {
    clinicId: f.clinicId, phone: p, body: "yes", providerMessageId: "c2",
  }, new Date(), scripted);
  // The answer to the original question, not a fresh "what day?" prompt.
  assert.match(b!.text, /no upcoming appointments/i);
});

test("a clinical question asked before consent still escalates", async () => {
  const r = await handleInbound(db, {
    clinicId: f.clinicId, phone: "+919000000056",
    body: "what are the side effects of this medicine", providerMessageId: "d1",
  }, new Date(), scripted);
  assert.equal(r!.escalated, true);
  assert.equal((await db`select id from escalations`).length, 1);
});

test("with several doctors, the agent asks which one and never picks for you", async () => {
  await db`insert into doctors (clinic_id, name, specialty, default_slot_minutes)
           values (${f.clinicId}, 'Dr. Iyer', 'Paediatrics', 20)`;

  const a = await say("I need an appointment");
  assert.match(a!.text, /which doctor/i);
  assert.match(a!.text, /Dr\. Rao/);
  assert.match(a!.text, /Dr\. Iyer/);

  // A day, given before a doctor is chosen, must not book anything.
  const b = await say("tomorrow");
  assert.equal(b!.escalated, true);
  assert.equal((await db`select id from appointments`).length, 0);
});

test("naming the doctor resumes the booking with the right one", async () => {
  const [iyer] = await db<{ id: string }[]>`
    insert into doctors (clinic_id, name, specialty, default_slot_minutes)
    values (${f.clinicId}, 'Dr. Iyer', 'Paediatrics', 20) returning id`;

  await say("I need an appointment");
  const b = await say("Dr Iyer please");
  assert.match(b!.text, /Dr\. Iyer/);

  const offer = await say("tomorrow");
  const time = offer!.text.match(/(\d{1,2}:\d{2})/)![1];
  await say(time);

  const rows = await db<{ doctor_id: string }[]>`
    select doctor_id from appointments where status = 'booked'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doctor_id, iyer.id);
});

test("when the classifier is unavailable, the message escalates rather than vanishing", async () => {
  const broken = async () => { throw new ClassifierUnavailable("503 upstream"); };
  const r = await handleInbound(db, {
    clinicId: f.clinicId, phone: "+919000000001",
    body: "I need an appointment", providerMessageId: "e1",
  }, new Date(), broken);

  assert.equal(r!.escalated, true);
  assert.match(r!.text, /technical issue/i);

  const [e] = await db<{ reason: string }[]>`select reason from escalations`;
  assert.match(e.reason, /classifier unavailable/);
  assert.equal((await db`select id from appointments`).length, 0);
});

test("a clinical question never reaches the classifier at all", async () => {
  let called = false;
  const spy = async () => { called = true; throw new Error("should not be reached"); };
  const r = await handleInbound(db, {
    clinicId: f.clinicId, phone: "+919000000001",
    body: "can I take paracetamol with the antibiotics", providerMessageId: "e2",
  }, new Date(), spy);

  assert.equal(called, false, "the safety screen must decide before any model call");
  assert.equal(r!.escalated, true);
});

test("the classifier is given only booking context, never patient history", async () => {
  await db`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
           values (${f.patientId}, ${f.doctorId}, 'Amoxicillin', '500mg', ${f.doctorUserId})`;

  let seen: unknown;
  const capture: typeof scripted = async (i) => {
    seen = i;
    return { intent: "book", doctor: null, day: null, slotIndex: null, name: null };
  };
  await handleInbound(db, {
    clinicId: f.clinicId, phone: "+919000000001",
    body: "I need an appointment", providerMessageId: "e3",
  }, new Date(), capture);

  // docs/02: minimise what any third-party API sees.
  assert.deepEqual(Object.keys(seen as object).sort(),
    ["body", "doctors", "offered", "today", "weekday"]);
  assert.doesNotMatch(JSON.stringify(seen), /Amoxicillin|\+9190000/);
});

test("a patient with no name on file is asked for one before booking", async () => {
  const p = "+919000000088";
  const ask = (body: string, id: string, over: Record<string, unknown> = {}) =>
    handleInbound(db, { clinicId: f.clinicId, phone: p, body, providerMessageId: id },
      // The override only applies to classifying this message itself. A booking
      // resumed off the back of it (e.g. the stashed request once we have a
      // name) reclassifies its own, different text and must not inherit it.
      new Date(), async (i) => ({ ...(await scripted(i)), ...(i.body === body ? over : {}) }));

  assert.match((await ask("I need an appointment", "n1"))!.text, /store your name/i);
  assert.match((await ask("yes", "n2"))!.text, /name/i);

  const named = await ask("Asha Verma", "n3", { intent: "provide_name", name: "Asha Verma" });
  assert.match(named!.text, /what day/i);

  const [row] = await db<{ name: string }[]>`select name from patients where phone = ${p}`;
  assert.equal(row.name, "Asha Verma");
});

test("a patient who already has a name is never asked again", async () => {
  const r = await say("I need an appointment with Dr. Rao");
  assert.doesNotMatch(r!.text, /what name/i);
});
