import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { agentDb, db, reset, seed, futureSlot, localDay, closeAll, type Fixture } from "./helpers";
import { voiceAvailability, voiceBook, normalisePhone } from "../src/lib/voice";
import { bookAppointment } from "../src/lib/booking";

const AGENT = { kind: "agent" } as const;
let f: Fixture;

before(async () => { await reset(); });
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

test("a free slot is reported available", async () => {
  const day = localDay(futureSlot(10));
  const r = await voiceAvailability(agentDb, f.clinicId, { date: day, time: "10:00" });
  assert.equal(r.available, true);
  assert.equal(r.doctor, "Dr. Rao");
});

test("a taken slot offers the nearest open times that day", async () => {
  const at = futureSlot(10);
  await bookAppointment(db, AGENT, "agent", { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });
  const r = await voiceAvailability(agentDb, f.clinicId, { date: localDay(at), time: "10:00", doctor: "rao" });
  assert.equal(r.available, false);
  assert.deepEqual(r.alternatives.map(a => a.time).sort(), ["09:00", "09:30", "10:30"]);
});

test("a closed day offers the next open day", async () => {
  // Find a Sunday ahead.
  let d = new Date(Date.now() + 2 * 86_400_000);
  while (new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" }).format(d) !== "Sun") {
    d = new Date(d.getTime() + 86_400_000);
  }
  const r = await voiceAvailability(agentDb, f.clinicId, { date: localDay(d), time: "10:00" });
  assert.equal(r.available, false);
  assert.equal(r.alternatives[0].time, "09:00");
  assert.notEqual(r.alternatives[0].date, localDay(d));
});

test("booking a new caller records voice consent and the appointment", async () => {
  const day = localDay(futureSlot(11));
  const r = await voiceBook(agentDb, f.clinicId,
    { date: day, time: "11:00", phone: "98765 43210", name: "Ravi", consent: true });
  assert.equal(r.booked, true);
  const [p] = await db`select name, consent_status from patients where phone = '+919876543210'`;
  assert.equal(p.name, "Ravi");
  assert.equal(p.consent_status, "granted");
  const [c] = await db`select channel from consent_log where patient_id = (select id from patients where phone = '+919876543210')`;
  assert.equal(c.channel, "voice");

  // Same slot again: not booked, alternatives offered.
  const again = await voiceBook(agentDb, f.clinicId,
    { date: day, time: "11:00", phone: "+919000000002", consent: true });
  assert.equal(again.booked, false);
  assert.ok(again.alternatives.length > 0);
});

test("no consent, no booking; bad input is refused, not guessed", async () => {
  const day = localDay(futureSlot(12));
  await assert.rejects(voiceBook(agentDb, f.clinicId, { date: day, time: "12:00", phone: "9876543210", consent: false }));
  await assert.rejects(voiceAvailability(agentDb, f.clinicId, { date: "tomorrow", time: "12:00" }));
  await assert.rejects(voiceAvailability(agentDb, f.clinicId, { date: day, time: "12 pm" }));
  assert.equal(normalisePhone("+91 98765-43210"), "+919876543210");
  assert.equal(normalisePhone("09876543210"), "+919876543210");
});

test("call-start context names today, the clinic and its doctors", async () => {
  const { voiceContext } = await import("../src/lib/voice");
  const c = await voiceContext(agentDb, f.clinicId, new Date("2026-10-15T06:00:00Z"));
  assert.equal(c.today, "Thursday 2026-10-15");
  assert.equal(c.clinic_name, "Test Clinic");
  assert.equal(c.doctors, "Dr. Rao (General)");
});
