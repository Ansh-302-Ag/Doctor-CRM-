import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { validDay } from "@/lib/valid-day";
import { patientScope } from "@/lib/patients";
import { checkAvailability, rescheduleAppointment, cancelAppointment } from "@/lib/booking";
import { isId, refusal } from "@/lib/desk";
import { Badge, appointmentStatus, btnPrimary, btnSecondary } from "../../_ui";

const field = "mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink";
const fieldLabel = "block text-xs font-semibold uppercase tracking-wide text-ink-3";

/** The appointment's patient, if the appointment is this clinic's (and, for a
 *  doctor, his). The booking functions check the patient owns the appointment;
 *  this is what makes a posted id this clinic's in the first place. */
async function patientOf(
  appointmentId: string, clinicId: string, doctorId: string | null,
): Promise<string | null> {
  if (!isId(appointmentId)) return null;
  const [a] = await sql<{ patient_id: string }[]>`
    select patient_id from appointments
     where id = ${appointmentId} and clinic_id = ${clinicId}
       ${doctorId ? sql`and doctor_id = ${doctorId}` : sql``}`;
  return a?.patient_id ?? null;
}

/** Move or cancel one appointment. */
export default async function AppointmentPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ day?: string; error?: string }>;
}) {
  const staff = await currentStaff();
  requirePermission(staff.role, "appointments:write");
  const { id } = await params;
  const { day: rawDay, error } = await searchParams;
  if (!isId(id)) notFound();
  const scope = patientScope(staff);

  const [[appt]] = await Promise.all([
    sql<{
      id: string; starts_at: Date; status: string; arrived_at: Date | null;
      reason_text: string | null; doctor_id: string; doctor_name: string;
      patient_name: string | null; patient_phone: string;
    }[]>`
      select a.id, a.starts_at, a.status, a.arrived_at, a.reason_text, a.doctor_id,
             d.name as doctor_name, p.name as patient_name, p.phone as patient_phone
        from appointments a
        join doctors d on d.id = a.doctor_id
        join patients p on p.id = a.patient_id
       where a.id = ${id} and a.clinic_id = ${staff.clinicId} and p.deleted_at is null
         ${scope ? sql`and a.doctor_id = ${scope}` : sql``}`,
    audit(sql, { kind: "staff", id: staff.id }, "read_appointment", "appointments", id),
  ]);
  if (!appt) notFound();

  const localDay = (at: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(at);
  const today = localDay(new Date());
  const apptDay = localDay(appt.starts_at);
  const day = validDay(rawDay, apptDay < today ? today : apptDay);
  const slots = appt.status === "booked" ? await checkAvailability(sql, appt.doctor_id, day) : [];

  async function reschedule(form: FormData) {
    "use server";
    const me = await currentStaff();
    const appointmentId = String(form.get("appointmentId") ?? "");
    const startsAt = new Date(String(form.get("startsAt") ?? ""));
    let error: string | null = null;
    let movedTo = "";
    try {
      requirePermission(me.role, "appointments:write");
      const patientId = await patientOf(appointmentId, me.clinicId, patientScope(me));
      if (!patientId) error = "no such appointment";
      else if (Number.isNaN(startsAt.getTime())) error = "pick a time";
      else {
        const booked = await rescheduleAppointment(sql, { kind: "staff", id: me.id }, me.role,
          { appointmentId, patientId, startsAt });
        movedTo = new Intl.DateTimeFormat("en-CA", { timeZone: me.timezone }).format(booked.startsAt);
      }
    } catch (e) {
      error = refusal(e);
      if (error === null) throw e;
    }
    if (error) {
      const back = new URLSearchParams({ error });
      const day = validDay(String(form.get("day") ?? ""), "");
      if (day) back.set("day", day);
      redirect(isId(appointmentId) ? `/appointments/${appointmentId}?${back}` : `/?${back}`);
    }
    revalidatePath("/");
    redirect(`/?day=${movedTo}`);
  }

  async function cancel(form: FormData) {
    "use server";
    const me = await currentStaff();
    const appointmentId = String(form.get("appointmentId") ?? "");
    let error: string | null = null;
    try {
      requirePermission(me.role, "appointments:write");
      const patientId = await patientOf(appointmentId, me.clinicId, patientScope(me));
      if (!patientId) error = "no such appointment";
      else {
        await cancelAppointment(sql, { kind: "staff", id: me.id }, me.role,
          { appointmentId, patientId });
      }
    } catch (e) {
      error = refusal(e);
      if (error === null) throw e;
    }
    if (error) {
      const back = new URLSearchParams({ error });
      redirect(isId(appointmentId) ? `/appointments/${appointmentId}?${back}` : `/?${back}`);
    }
    revalidatePath("/");
    redirect(`/?day=${validDay(String(form.get("apptDay") ?? ""), "")}`);
  }

  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, dateStyle: "full", timeStyle: "short",
  }).format(appt.starts_at);
  const time = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
  const status = appointmentStatus(appt.status);

  return (
    <section className="max-w-3xl">
      <Link href={`/?day=${apptDay}`} className="text-sm text-ink-3 transition-colors hover:text-ink">
        &larr; Calendar
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Appointment</h1>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger-ink">
          {error}
        </p>
      )}

      <div className="mt-4 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tabular-nums text-ink">{when}</span>
          {appt.arrived_at && appt.status === "booked" && <Badge tone="ok">Arrived</Badge>}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="mt-2 text-ink">
          {appt.patient_name ?? "Unnamed patient"}{" "}
          <span className="text-sm tabular-nums text-ink-3">{appt.patient_phone}</span>
        </p>
        <p className="mt-1 text-sm text-ink-2">{appt.doctor_name}</p>
        <p className="mt-1 break-words text-sm text-ink-2">
          <span className="text-ink-3">Reason (as given):</span> {appt.reason_text ?? "—"}
        </p>
      </div>

      {appt.status !== "booked" ? (
        <p className="mt-4 text-sm text-ink-3">This appointment can no longer be changed.</p>
      ) : (
        <>
          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-3">Move to</h2>
          <form method="GET" className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="day" className={fieldLabel}>Day</label>
              <input id="day" name="day" type="date" required min={today} defaultValue={day} className={field} />
            </div>
            <button className={btnSecondary}>Show open slots</button>
          </form>
          <form action={reschedule} className="mt-3">
            <input type="hidden" name="appointmentId" value={appt.id} />
            <input type="hidden" name="day" value={day} />
            {slots.length === 0 ? (
              <p className="text-sm text-ink-3">No open slots with {appt.doctor_name} on this day.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
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

          <form action={cancel} className="mt-6 border-t border-line pt-4">
            <input type="hidden" name="appointmentId" value={appt.id} />
            <input type="hidden" name="apptDay" value={apptDay} />
            <button className={btnPrimary}>Cancel appointment</button>
          </form>
        </>
      )}
    </section>
  );
}
