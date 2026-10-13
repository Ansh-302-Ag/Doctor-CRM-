import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import { withdrawAndDelete, purgeDeletedPatients, PURGE_AFTER_DAYS } from "../src/lib/consent";
import { bookAppointment } from "../src/lib/booking";
import { listEscalations } from "../src/lib/escalations";

let f: Fixture;
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

const age = (id: string) =>
  db`update patients set deleted_at = now() - (${PURGE_AFTER_DAYS + 1} * interval '1 day')
      where id = ${id}`;

test("a withdrawn patient's open escalation stays in the inbox, marked", async () => {
  // An emergency from someone who has just sent DELETE is still an emergency:
  // the page is masked, so the inbox is the only place staff can find them.
  await db`insert into escalations (conversation_id, patient_id, reason, priority, status, resolved_at)
           values (${f.conversationId}, ${f.patientId}, 'chest pain', 'emergency', 'open', null),
                  (${f.conversationId}, ${f.patientId}, 'old question', 'normal', 'resolved', now())`;
  await withdrawAndDelete(db, { kind: "agent" }, f.patientId);

  const rows = await listEscalations(
    db, { kind: "staff", id: f.receptionistId }, "receptionist", f.clinicId);
  assert.deepEqual(rows.map(r => [r.reason, r.consentWithdrawn]), [["chest pain", true]]);
});

test("a patient inside the retention window is not purged", async () => {
  await withdrawAndDelete(db, { kind: "agent" }, f.patientId);
  assert.equal((await purgeDeletedPatients(db)).purged, 0);
  assert.equal((await db`select id from patients where id = ${f.patientId}`).length, 1);
});

test("a patient past the retention window is hard-deleted with their data", async () => {
  await bookAppointment(db, { kind: "staff", id: f.receptionistId }, "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) });
  await db`insert into messages (conversation_id, direction, body)
           values (${f.conversationId}, 'inbound', 'hello')`;
  await withdrawAndDelete(db, { kind: "agent" }, f.patientId);
  await age(f.patientId);

  assert.equal((await purgeDeletedPatients(db)).purged, 1);
  assert.equal((await db`select id from patients where id = ${f.patientId}`).length, 0);
  assert.equal((await db`select id from appointments where patient_id = ${f.patientId}`).length, 0);
  assert.equal((await db`select id from conversations where patient_id = ${f.patientId}`).length, 0);
});

test("the purge leaves an audit trail naming no patient data", async () => {
  await withdrawAndDelete(db, { kind: "agent" }, f.patientId);
  await age(f.patientId);
  await purgeDeletedPatients(db);

  const rows = await db<{ target_id: string }[]>`
    select target_id from audit_log where action = 'patient_purged'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_id, f.patientId);
});

test("a patient who is not soft-deleted is never purged, however old", async () => {
  await db`update patients set created_at = now() - interval '5 years' where id = ${f.patientId}`;
  assert.equal((await purgeDeletedPatients(db)).purged, 0);
});

test("the purge cron endpoint refuses a request without the shared secret", async () => {
  const { GET } = await import("../src/app/api/cron/purge/route");
  process.env.CRON_SECRET = "s3cret";
  try {
    assert.equal((await GET(new Request("http://localhost/x"))).status, 401);
    assert.equal((await GET(new Request("http://localhost/x", {
      headers: { authorization: "Bearer nope" },
    }))).status, 401);
  } finally { delete process.env.CRON_SECRET; }
});

test("the purge cron endpoint refuses to run at all when no secret is configured", async () => {
  const { GET } = await import("../src/app/api/cron/purge/route");
  delete process.env.CRON_SECRET;
  const res = await GET(new Request("http://localhost/x", {
    headers: { authorization: "Bearer anything" },
  }));
  assert.equal(res.status, 500, "an unprotected purge endpoint must not be callable");
});
