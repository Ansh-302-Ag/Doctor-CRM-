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
import { CalendarPlus, Search, UserPlus } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import {
  Alert, Avatar, Badge, Card, EmptyState, PageHeader, consentStatus,
  btnPrimary, btnSecondary, btnSm, field, fieldLabel,
} from "../../_ui";
import { slotChip } from "../_slots";

/** Who a doctor may book: his own patients, or someone nobody has seen yet (the
 *  walk-in he just registered). Not another doctor's patient — typing a known
 *  number on the walk-in form must not open someone else's record. */
const bookableBy = (doctorId: string | null) => doctorId
  ? sql`and (exists (select 1 from appointments a where a.patient_id = p.id and a.doctor_id = ${doctorId})
         or not exists (select 1 from appointments a where a.patient_id = p.id))`
  : sql``;

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
      select p.id, p.name, p.phone, p.consent_status from patients p
       where p.id = ${patientId} and p.clinic_id = ${staff.clinicId} and p.deleted_at is null
         ${bookableBy(patientScope(staff))}`,
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
           and d.id = ${doctorId} and d.clinic_id = ${me.clinicId}
           ${bookableBy(patientScope(me))}`;
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
  // A plain calendar date: format at UTC noon so no timezone shifts it.
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  }).format(new Date(`${day}T12:00:00Z`));

  return (
    <section className="max-w-5xl space-y-6">
      <PageHeader
        icon={CalendarPlus}
        title="Book appointment"
        back={{ href: `/?day=${day}`, label: "Calendar" }}
        subtitle={patient ? "Pick the doctor and day, then an open slot." : "Find the patient first."}
      />

      {params.error && <Alert>{params.error}</Alert>}

      {!patient && patientId && (
        <Alert tone="warn">
          {params.existing
            ? "This number is already registered as another doctor's patient — ask the front desk to book."
            : "That patient is not one you can book."}
        </Alert>
      )}

      {!patient ? (
        <Card title="Find the patient" description="Search by name or phone number.">
          <form method="GET" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="day" value={day} />
            {doctor && <input type="hidden" name="doctor" value={doctor.id} />}
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor="q" className={fieldLabel}>Patient name or phone</label>
              <input id="q" name="q" type="search" required defaultValue={params.q ?? ""} className={field} />
            </div>
            <button className={btnPrimary}><Search aria-hidden className="size-4" />Find</button>
            <Link href="/patients/new" className={btnSecondary}>
              <UserPlus aria-hidden className="size-4" />Register new patient
            </Link>
          </form>
          {params.q && (
            matches.length === 0 ? (
              <div className="mt-4">
                <EmptyState title="No patient matches.">Register them as new.</EmptyState>
              </div>
            ) : (
              <Reveal as="ul" className="mt-4 divide-y divide-line rounded-lg border border-line">
                {matches.map(m => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar name={m.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium break-words text-ink">{m.name ?? "Unnamed"}</span>
                      <span className="block text-xs tabular-nums text-ink-3">{m.phone}</span>
                    </span>
                    <Link
                      href={`/appointments/new?patient=${m.id}&day=${day}${doctor ? `&doctor=${doctor.id}` : ""}`}
                      className={`${btnSecondary} ${btnSm}`}
                    >
                      Choose
                    </Link>
                  </li>
                ))}
              </Reveal>
            )
          )}
        </Card>
      ) : (
        <>
          {params.existing && (
            <Alert tone="info">This number is already registered — booking for the existing patient.</Alert>
          )}
          <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
            <div className="space-y-6">
              <Card
                title="Patient"
                actions={
                  <Link href={`/appointments/new?day=${day}`} className="text-sm text-ink-3 underline underline-offset-2 hover:text-ink">
                    Change patient
                  </Link>
                }
              >
                <div className="flex items-center gap-3">
                  <Avatar name={patient.name} size="lg" />
                  <div className="min-w-0">
                    <p className="font-semibold break-words text-ink">{patient.name ?? "Unnamed patient"}</p>
                    <p className="text-sm tabular-nums text-ink-3">{patient.phone}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <Badge tone={consentStatus(patient.consent_status).tone}>
                    Consent: {consentStatus(patient.consent_status).label}
                  </Badge>
                </div>
              </Card>

              <Card title="Doctor and day">
                <form method="GET" className="space-y-4">
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
                  <button className={`${btnSecondary} w-full`}>Show open slots</button>
                </form>
              </Card>
            </div>

            {doctor && (
              <Card title={`Open slots with ${doctor.name}`} description={dayLabel}>
                <form action={book} className="space-y-4">
                  {/* Enter in "Reason" would submit with the first slot button and
                      book the earliest time. A disabled first submit button takes
                      the browser's implicit submission and does nothing. */}
                  <button type="submit" disabled hidden aria-hidden="true" tabIndex={-1} />
                  <input type="hidden" name="patientId" value={patient.id} />
                  <input type="hidden" name="doctorId" value={doctor.id} />
                  <input type="hidden" name="day" value={day} />
                  <div>
                    <label htmlFor="reason" className={fieldLabel}>Reason (optional)</label>
                    <input id="reason" name="reason" autoComplete="off" className={field} />
                  </div>
                  {slots.length === 0 ? (
                    <EmptyState title="No open slots on this day.">Try another day.</EmptyState>
                  ) : (
                    <fieldset>
                      <legend className={fieldLabel}>Pick a time to book</legend>
                      <Reveal className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5" step={20}>
                        {slots.map(s => (
                          <button
                            key={s.startsAt.toISOString()}
                            name="startsAt"
                            value={s.startsAt.toISOString()}
                            className={slotChip}
                          >
                            {time(s.startsAt)}
                          </button>
                        ))}
                      </Reveal>
                    </fieldset>
                  )}
                </form>
              </Card>
            )}
          </div>
        </>
      )}
    </section>
  );
}
