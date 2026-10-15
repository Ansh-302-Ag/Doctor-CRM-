import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { validDay } from "@/lib/valid-day";
import { searchPatients, patientScope } from "@/lib/patients";
import { bookAppointment, checkAvailability } from "@/lib/booking";
import { isId, refusal } from "@/lib/desk";
import { Badge, consentStatus, btnPrimary, btnSecondary } from "../../_ui";

const field = "mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink";
const fieldLabel = "block text-xs font-semibold uppercase tracking-wide text-ink-3";

/** Book for a patient at the desk: find (or register) the patient, pick the
 *  doctor and day, take one of the open slots. Same booking rules as the bots. */
export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{
    patient?: string; doctor?: string; day?: string; q?: string; error?: string; existing?: string;
  }>;
}) {
  const staff = await currentStaff();
  requirePermission(staff.role, "appointments:write");
  const actor = { kind: "staff" as const, id: staff.id };
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(new Date());
  const day = validDay(params.day, today);
  const patientId = params.patient && isId(params.patient) ? params.patient : null;

  // A doctor books with himself; the desk picks from the clinic's doctors.
  const doctors = staff.role === "doctor"
    ? await sql<{ id: string; name: string }[]>`
        select id, name from doctors where id = ${staff.doctorId} and clinic_id = ${staff.clinicId}`
    : await sql<{ id: string; name: string }[]>`
        select id, name from doctors where clinic_id = ${staff.clinicId} order by name`;
  const doctor = doctors.find(d => d.id === params.doctor) ?? doctors[0];

  // The patient by id, in this clinic. Only name, phone and consent are shown:
  // a doctor may reach here for someone not yet his patient (a walk-in he just
  // registered), and booking is what makes them his.
  const [patient] = patientId ? (await Promise.all([
    sql<{ id: string; name: string | null; phone: string; consent_status: string }[]>`
      select id, name, phone, consent_status from patients
       where id = ${patientId} and clinic_id = ${staff.clinicId} and deleted_at is null`,
    audit(sql, actor, "read_patient", "patients", patientId),
  ]))[0] : [];

  const matches = !patient && params.q
    ? await searchPatients(sql, actor, staff.role, staff.clinicId, params.q, patientScope(staff))
    : [];
  const slots = patient && doctor ? await checkAvailability(sql, doctor.id, day) : [];

  async function book(form: FormData) {
    "use server";
    const me = await currentStaff();
    const meActor = { kind: "staff" as const, id: me.id };
    const patientId = String(form.get("patientId") ?? "");
    const doctorId = me.role === "doctor" ? me.doctorId ?? "" : String(form.get("doctorId") ?? "");
    const startsAt = new Date(String(form.get("startsAt") ?? ""));
    const reason = String(form.get("reason") ?? "").trim();

    let error: string | null = null;
    try {
      requirePermission(me.role, "appointments:write");
      // Posted ids are not proof of anything: both must be this clinic's.
      const [ok] = !isId(patientId) || !isId(doctorId) ? [] : await sql`
        select 1 from patients p, doctors d
         where p.id = ${patientId} and p.clinic_id = ${me.clinicId} and p.deleted_at is null
           and d.id = ${doctorId} and d.clinic_id = ${me.clinicId}`;
      if (!ok) error = "no such patient or doctor at this clinic";
      else if (Number.isNaN(startsAt.getTime())) error = "pick a time";
      else {
        await bookAppointment(sql, meActor, me.role,
          { patientId, doctorId, startsAt, reasonText: reason || undefined });
      }
    } catch (e) {
      error = refusal(e);
      if (error === null) throw e;
    }
    const back = new URLSearchParams({ patient: patientId, doctor: doctorId });
    if (error) {
      back.set("day", String(form.get("day") ?? ""));
      back.set("error", error);
      redirect(`/appointments/new?${back}`);
    }
    revalidatePath("/");
    const bookedDay = new Intl.DateTimeFormat("en-CA", { timeZone: me.timezone }).format(startsAt);
    redirect(`/?day=${bookedDay}`);
  }

  const time = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);

  return (
    <section className="max-w-3xl">
      <Link href={`/?day=${day}`} className="text-sm text-ink-3 transition-colors hover:text-ink">
        &larr; Calendar
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Book appointment</h1>

      {params.error && (
        <p role="alert" className="mt-4 rounded-md border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger-ink">
          {params.error}
        </p>
      )}

      {!patient ? (
        <div className="mt-4 rounded-lg border border-line bg-surface p-4">
          <form method="GET" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="day" value={day} />
            {doctor && <input type="hidden" name="doctor" value={doctor.id} />}
            <div className="min-w-0 flex-1">
              <label htmlFor="q" className={fieldLabel}>Patient name or phone</label>
              <input id="q" name="q" type="search" required defaultValue={params.q ?? ""} className={field} />
            </div>
            <button className={btnPrimary}>Find</button>
            <Link href="/patients/new" className={btnSecondary}>Register new patient</Link>
          </form>
          {params.q && (
            matches.length === 0 ? (
              <p className="mt-4 text-sm text-ink-3">No patient matches. Register them as new.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {matches.map(m => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium text-ink">{m.name ?? "Unnamed"}</span>{" "}
                      <span className="text-sm tabular-nums text-ink-3">{m.phone}</span>
                    </span>
                    <Link
                      href={`/appointments/new?patient=${m.id}&day=${day}${doctor ? `&doctor=${doctor.id}` : ""}`}
                      className={btnSecondary}
                    >
                      Choose
                    </Link>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      ) : (
        <>
          {params.existing && (
            <p role="status" className="mt-4 rounded-md border border-line bg-subtle px-3.5 py-2.5 text-sm text-ink-2">
              This number is already registered — booking for the existing patient.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
            <span className="font-semibold text-ink">{patient.name ?? "Unnamed patient"}</span>
            <span className="text-sm tabular-nums text-ink-3">{patient.phone}</span>
            <Badge tone={consentStatus(patient.consent_status).tone}>
              Consent: {consentStatus(patient.consent_status).label}
            </Badge>
            <Link href={`/appointments/new?day=${day}`} className="ml-auto text-sm text-ink-3 underline underline-offset-2 hover:text-ink">
              Change patient
            </Link>
          </div>

          <form method="GET" className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="patient" value={patient.id} />
            <div>
              <label htmlFor="doctor" className={fieldLabel}>Doctor</label>
              <select id="doctor" name="doctor" defaultValue={doctor?.id} className={field}>
                {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="day" className={fieldLabel}>Day</label>
              <input id="day" name="day" type="date" required min={today} defaultValue={day} className={field} />
            </div>
            <button className={btnSecondary}>Show open slots</button>
          </form>

          {doctor && (
            <form action={book} className="mt-4 rounded-lg border border-line bg-surface p-4">
              <input type="hidden" name="patientId" value={patient.id} />
              <input type="hidden" name="doctorId" value={doctor.id} />
              <input type="hidden" name="day" value={day} />
              <label htmlFor="reason" className={fieldLabel}>Reason (optional)</label>
              <input id="reason" name="reason" autoComplete="off" className={field} />
              <p className={`${fieldLabel} mt-4`}>Open slots with {doctor.name}</p>
              {slots.length === 0 ? (
                <p className="mt-2 text-sm text-ink-3">No open slots on this day. Try another day.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map(s => (
                    <button
                      key={s.startsAt.toISOString()}
                      name="startsAt"
                      value={s.startsAt.toISOString()}
                      className={`${btnSecondary} tabular-nums`}
                    >
                      {time(s.startsAt)}
                    </button>
                  ))}
                </div>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
