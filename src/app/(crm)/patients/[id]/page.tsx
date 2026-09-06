import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { audit } from "@/lib/audit";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getPatient } from "@/lib/patients";
import { createPrescription, listPrescriptions, discontinuePrescription, InvalidPrescription } from "@/lib/prescriptions";

export default async function PatientRecordPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const staff = await currentStaff();
  const { id } = await params;
  const { error } = await searchParams;
  const actor = { kind: "staff" as const, id: staff.id };

  const patient = await getPatient(sql, actor, staff.role, staff.clinicId, id);
  if (!patient) notFound();

  const [appointments, prescriptions, doctors] = await Promise.all([
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
    sql<{ id: string; name: string }[]>`
      select id, name from doctors where clinic_id = ${staff.clinicId} order by name`,
  ]);
  await audit(sql, actor, "read_patient_appointments", "patients", id);

  async function addPrescription(form: FormData) {
    "use server";
    const me = await currentStaff();
    const meActor = { kind: "staff" as const, id: me.id };
    const patientId = String(form.get("patientId"));

    // The patient id comes from a hidden form field, not proof of anything —
    // re-check it resolves for this clinic before writing anything (docs/08).
    const patient = await getPatient(sql, meActor, me.role, me.clinicId, patientId);
    if (!patient) notFound();

    const durationRaw = String(form.get("durationDays") ?? "").trim();
    try {
      await createPrescription(sql, meActor, me.role, {
        patientId,
        doctorId: String(form.get("doctorId")),
        drugName: String(form.get("drugName") ?? ""),
        dosage: String(form.get("dosage") ?? ""),
        durationDays: durationRaw ? Number(durationRaw) : undefined,
        notes: String(form.get("notes") ?? "") || undefined,
      });
    } catch (e) {
      if (e instanceof InvalidPrescription) {
        redirect(`/patients/${patientId}?error=${encodeURIComponent(e.message)}`);
      }
      throw e;
    }
    revalidatePath(`/patients/${patientId}`);
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
    const patient = await getPatient(sql, meActor, me.role, me.clinicId, patientId);
    if (!patient) notFound();
    const existing = await listPrescriptions(sql, meActor, me.role, me.clinicId, patientId);
    if (!existing.some(p => p.id === prescriptionId)) notFound();

    await discontinuePrescription(sql, meActor, me.role, me.clinicId, prescriptionId);
    revalidatePath(`/patients/${patientId}`);
  }

  const when = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "short",
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
              <label className="block text-sm">
                <span className="text-slate-600">Doctor</span>
                <select name="doctorId" required
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
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
            <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
              Add prescription
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
