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
import { CalendarClock, MessageSquareText, Stethoscope } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import {
  Alert, Avatar, Badge, Card, EmptyState, PageHeader, appointmentStatus,
  btnDanger, btnSecondary, field, fieldLabel,
} from "../../_ui";
import { slotChip } from "../_slots";

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
  // The picked day is a plain calendar date: format at UTC noon so no timezone shifts it.
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long",
  }).format(new Date(`${day}T12:00:00Z`));

  return (
    <section className="max-w-5xl space-y-6">
      <PageHeader
        title="Appointment"
        back={{ href: `/?day=${apptDay}`, label: "Calendar" }}
        subtitle={<>
          <span className="tabular-nums">{when}</span>
          {appt.arrived_at && appt.status === "booked" && <Badge tone="ok">Arrived</Badge>}
          <Badge tone={status.tone}>{status.label}</Badge>
        </>}
      />

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
        <Card title="Details">
          <div className="flex items-center gap-3">
            <Avatar name={appt.patient_name} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold break-words text-ink">{appt.patient_name ?? "Unnamed patient"}</p>
              <p className="text-sm tabular-nums text-ink-3">{appt.patient_phone}</p>
            </div>
          </div>
          <dl className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
            <div className="flex gap-3">
              <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div>
                <dt className="sr-only">When</dt>
                <dd className="tabular-nums text-ink">{when}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Stethoscope aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div>
                <dt className="sr-only">Doctor</dt>
                <dd className="text-ink-2">{appt.doctor_name}</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <MessageSquareText aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div className="min-w-0">
                <dt className="text-xs font-semibold tracking-wide text-ink-3">Reason (as given)</dt>
                <dd className="mt-0.5 break-words text-ink-2">{appt.reason_text ?? "—"}</dd>
              </div>
            </div>
          </dl>
        </Card>

        {appt.status !== "booked" ? (
          <EmptyState title="This appointment can no longer be changed." />
        ) : (
          <div className="space-y-6">
            <Card title="Move to" description={`Open slots with ${appt.doctor_name} on ${dayLabel}.`}>
              <form method="GET" className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 basis-44">
                  <label htmlFor="day" className={fieldLabel}>Day</label>
                  <input id="day" name="day" type="date" required min={today} defaultValue={day} className={field} />
                </div>
                <button className={btnSecondary}>Show open slots</button>
              </form>
              <form action={reschedule} className="mt-4">
                <input type="hidden" name="appointmentId" value={appt.id} />
                <input type="hidden" name="day" value={day} />
                {slots.length === 0 ? (
                  <EmptyState title={`No open slots with ${appt.doctor_name} on this day.`}>Try another day.</EmptyState>
                ) : (
                  <fieldset>
                    <legend className={fieldLabel}>Pick the new time</legend>
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

            <Card title="Cancel" description="It stays on the calendar, greyed out.">
              <form action={cancel}>
                <input type="hidden" name="appointmentId" value={appt.id} />
                <input type="hidden" name="apptDay" value={apptDay} />
                <button className={btnDanger}>Cancel appointment</button>
              </form>
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}
