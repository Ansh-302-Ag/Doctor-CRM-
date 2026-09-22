import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { audit } from "@/lib/audit";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getPatient, patientScope } from "@/lib/patients";
import { listPrescriptions, discontinuePrescription, InvalidPrescription } from "@/lib/prescriptions";
import { prescribeAndNotify, NotYourPatient } from "@/lib/doctor";

export default async function PatientRecordPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; sent?: string; nudged?: string }>;
}) {
  const staff = await currentStaff();
  const { id } = await params;
  const { error, sent, nudged } = await searchParams;
  const actor = { kind: "staff" as const, id: staff.id };
  const isDoctor = staff.role === "doctor";
  // A doctor may only open one of his own patients (docs/08).
  const scope = patientScope(staff);

  // One round trip for the whole record. Every query below is scoped to this
  // clinic on its own — the appointments and doctors lists by clinic_id, the
  // prescriptions by a join back to patients — so none of them depends on the
  // existence check to stay safe, and the check can move after them. Neon is a
  // continent away; three sequential hops here were most of the page's latency.
  const [patient, appointments, prescriptions, doctors] = await Promise.all([
    getPatient(sql, actor, staff.role, staff.clinicId, id, scope),
    sql<{
      id: string; starts_at: Date; status: string; doctor_name: string; reason_text: string | null;
    }[]>`
      select a.id, a.starts_at, a.status, d.name as doctor_name, a.reason_text
        from appointments a
        join doctors d on d.id = a.doctor_id
       where a.patient_id = ${id} and a.clinic_id = ${staff.clinicId}
       order by a.starts_at desc
       limit 20`,
    listPrescriptions(sql, actor, staff.role, staff.clinicId, id),
    // Only an admin has to say who prescribed: a doctor is the prescriber, and
    // currentStaff() now carries his doctor_id.
    isDoctor ? [] : sql<{ id: string; name: string }[]>`
      select id, name from doctors where clinic_id = ${staff.clinicId} order by name`,
    audit(sql, actor, "read_patient_appointments", "patients", id),
  ]);
  if (!patient) notFound();

  async function addPrescription(form: FormData) {
    "use server";
    const me = await currentStaff();
    const patientId = String(form.get("patientId"));
    const durationRaw = String(form.get("durationDays") ?? "").trim();

    // prescribeAndNotify re-resolves the patient under this staff member's own
    // scope before writing: the hidden field is not proof of anything (docs/08).
    let delivery;
    try {
      ({ delivery } = await prescribeAndNotify(sql, me, {
        patientId,
        doctorId: String(form.get("doctorId") ?? ""),
        drugName: String(form.get("drugName") ?? ""),
        dosage: String(form.get("dosage") ?? ""),
        durationDays: durationRaw ? Number(durationRaw) : undefined,
        notes: String(form.get("notes") ?? "") || undefined,
      }));
    } catch (e) {
      if (e instanceof NotYourPatient) notFound();
      if (e instanceof InvalidPrescription) {
        redirect(`/patients/${patientId}?error=${encodeURIComponent(e.message)}`);
      }
      throw e;
    }
    // The record is saved either way; the redirect only says what reached the
    // patient, so an undelivered message is never silent.
    revalidatePath(`/patients/${patientId}`);
    redirect(`/patients/${patientId}?sent=${delivery.delivered ? "1" : delivery.reason}` +
             (delivery.nudged ? "&nudged=1" : ""));
  }

  async function discontinue(form: FormData) {
    "use server";
    const me = await currentStaff();
    const meActor = { kind: "staff" as const, id: me.id };
    const patientId = String(form.get("patientId"));
    const prescriptionId = String(form.get("prescriptionId"));

    // Ownership check: discontinuePrescription trusts the id it's given, so we
    // must confirm both that the patient belongs to this clinic and that the
    // prescription actually belongs to that patient, before calling it (docs/08).
    const patient = await getPatient(
      sql, meActor, me.role, me.clinicId, patientId, patientScope(me));
    if (!patient) notFound();
    const existing = await listPrescriptions(sql, meActor, me.role, me.clinicId, patientId);
    if (!existing.some(p => p.id === prescriptionId)) notFound();

    await discontinuePrescription(sql, meActor, me.role, me.clinicId, prescriptionId);
    revalidatePath(`/patients/${patientId}`);
  }

  // The clinic's own clock, not the server's — an appointment time read an hour
  // out is worse than useless to the doctor reading it.
  const when = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, dateStyle: "medium", timeStyle: "short",
  }).format(at);

  return (
    <section>
      <div className="flex items-baseline gap-4">
        <h1 className="text-lg font-semibold text-slate-900">{patient.name ?? "Unnamed patient"}</h1>
        <span className="text-sm text-slate-500">{patient.phone}</span>
        <span className="text-sm text-slate-500">Consent: {patient.consent_status}</span>
        <Link href="/patients" className="ml-auto text-sm text-slate-600 hover:text-slate-900">
          ← Back to patients
        </Link>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {sent === "1" && (
        <p role="status" className="mt-4 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          Prescription saved and sent to the patient on WhatsApp.
        </p>
      )}
      {sent === "outside_window" && (
        <p role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Prescription saved, but it could not be sent: WhatsApp only allows us to message a
          patient within 24 hours of their own last message.{" "}
          {nudged
            ? "They have been sent a note asking them to reply, and the assistant will read this " +
              "record back to them when they do. Call them if it cannot wait."
            : "We could not reach them at all — please call them."}
        </p>
      )}
      {sent === "send_failed" && (
        <p role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Prescription saved, but WhatsApp would not accept the message. Nothing was lost —
          the record below is on file. Please tell the patient another way.
        </p>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-900">Appointments</h2>
        {appointments.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No appointments yet.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Doctor</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Reason (as given)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appointments.map(a => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-slate-900">{when(a.starts_at)}</td>
                    <td className="px-4 py-2 text-slate-700">{a.doctor_name}</td>
                    <td className="px-4 py-2 text-slate-600">{a.status}</td>
                    <td className="px-4 py-2 text-slate-600">{a.reason_text ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-slate-900">Prescriptions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Stored exactly as entered. The assistant reads these back to the patient verbatim and never interprets them.
        </p>

        {prescriptions.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No prescriptions on record.
          </p>
        ) : (
          <ul className="mt-2 space-y-3">
            {prescriptions.map(p => (
              <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{p.drug_name}</span>
                  <span className="text-slate-600">{p.dosage}</span>
                  {p.duration_days !== null && (
                    <span className="text-slate-500">for {p.duration_days} day{p.duration_days === 1 ? "" : "s"}</span>
                  )}
                  <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {p.doctor_name} · recorded by {p.created_by_name} · {when(p.created_at)}
                </p>
                {p.notes && <p className="mt-2 text-slate-700">{p.notes}</p>}
                {p.status === "active" && can(staff.role, "prescriptions:write") && (
                  <form action={discontinue} className="mt-3">
                    <input type="hidden" name="patientId" value={patient.id} />
                    <input type="hidden" name="prescriptionId" value={p.id} />
                    <button className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                      Discontinue
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {can(staff.role, "prescriptions:write") ? (
          <form action={addPrescription} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <input type="hidden" name="patientId" value={patient.id} />
            <div className="grid grid-cols-2 gap-3">
              {!isDoctor && (
                <label className="block text-sm">
                  <span className="text-slate-600">Doctor</span>
                  <select name="doctorId" required
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
                    {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              )}
              <label className="block text-sm">
                <span className="text-slate-600">Drug name</span>
                <input name="drugName" required
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Dosage</span>
                <input name="dosage" required
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Duration (days)</span>
                <input name="durationDays" type="number" min={1}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-slate-600">Notes</span>
              <textarea name="notes" rows={2}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
            </label>
            <p className="text-xs text-slate-500">
              Saved exactly as typed, attributed to {isDoctor ? "you" : "the doctor named above"},
              and sent to the patient on WhatsApp as written.
            </p>
            <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Save &amp; send to patient
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            Only a doctor or admin can add to the record.
          </p>
        )}
      </div>
    </section>
  );
}
