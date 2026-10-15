import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Plus, Stethoscope, UserPlus } from "lucide-react";
import { validDay } from "@/lib/valid-day";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { isId } from "@/lib/desk";
import { CountUp } from "@/components/lightswind/count-up";
import { Reveal } from "@/components/motion/reveal";
import {
  Alert, Avatar, Badge, Card, EmptyState, PageHeader, appointmentStatus,
  btnPrimary, btnSecondary, btnSm, field, fieldLabel,
} from "./_ui";
import { VisitActions } from "./appointments/_visit";

const iconProps = {
  viewBox: "0 0 24 24", "aria-hidden": true as const, className: "size-4 shrink-0",
  fill: "none", stroke: "currentColor", strokeWidth: "1.7",
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

/** Who put the appointment in the book. Shape as well as colour, because the
 *  status column right next to it is already a coloured pill. */
const AgentIcon = () => (
  <svg {...iconProps}><path d="M12 3.5 13.7 8l4.5 1.7-4.5 1.7L12 16l-1.7-4.6L5.8 9.7 10.3 8 12 3.5ZM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" /></svg>
);
const StaffIcon = () => (
  <svg {...iconProps}><path d="M19 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-7A3.5 3.5 0 0 0 5 18.5V20M12 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" /></svg>
);

const BookedBy = ({ by }: { by: string }) =>
  by === "agent" ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-accent">
      <AgentIcon />AI assistant
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-ink-3">
      <StaffIcon />Staff
    </span>
  );

/** Day view of the clinic's appointments, where the desk books, moves and
 *  closes them. Accuracy first; the time stays the anchor of every row. */
export default async function CalendarPage({
  searchParams,
}: { searchParams: Promise<{ day?: string; doctor?: string; error?: string }> }) {
  const staff = await currentStaff();
  requirePermission(staff.role, "appointments:read");

  // The clinic's timezone rides along on currentStaff() — see src/lib/session.ts.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(new Date());
  const params = await searchParams;
  const day = validDay(params.day, today);
  const doctor = params.doctor && isId(params.doctor) ? params.doctor : null;
  // The desk acts from here; a doctor acts on his own patients from My day.
  const isDesk = staff.role !== "doctor";

  // The audit write doesn't depend on the appointments query (or vice versa) —
  // running them concurrently instead of one after the other saves a full
  // Neon round trip on every page load.
  const [all, doctors] = await Promise.all([
    sql<{
      id: string; starts_at: Date; ends_at: Date; status: string; arrived_at: Date | null;
      doctor_name: string; patient_name: string | null; patient_phone: string;
      reason_text: string | null; created_by: string;
    }[]>`
      select a.id, a.starts_at, a.ends_at, a.status, a.arrived_at,
             d.name as doctor_name, p.name as patient_name, p.phone as patient_phone,
             a.reason_text, a.created_by
        from appointments a
        join doctors d  on d.id = a.doctor_id
        join patients p on p.id = a.patient_id
       where a.clinic_id = ${staff.clinicId} and p.deleted_at is null
         and a.status in ('booked','completed','no_show','cancelled')
         ${doctor ? sql`and a.doctor_id = ${doctor}` : sql``}
         -- Half-open range on the raw column. The old form,
         -- (a.starts_at at time zone tz)::date = day, applied a function to the
         -- column, so no index on starts_at could ever be used. Adding the day
         -- in local time before converting keeps a 23- or 25-hour DST day
         -- exactly one day long.
         and a.starts_at >= (${day} || ' 00:00')::timestamp at time zone ${staff.timezone}
         and a.starts_at <  ((${day} || ' 00:00')::timestamp + interval '1 day')
                            at time zone ${staff.timezone}
       order by a.starts_at`,
    sql<{ id: string; name: string }[]>`
      select id, name from doctors where clinic_id = ${staff.clinicId} order by name`,
    audit(sql, { kind: "staff", id: staff.id }, "read_calendar", "appointments", null),
  ]);

  // Cancelled rows stay in the list, greyed; the headline counts what is
  // still on the book.
  const rows = all;
  const onBook = all.filter(r => r.status !== "cancelled").length;
  const stats = [
    { label: "Booked", status: "booked", dot: "bg-accent" },
    { label: "Completed", status: "completed", dot: "bg-ok" },
    { label: "Cancelled", status: "cancelled", dot: "bg-ink-3" },
    { label: "No-show", status: "no_show", dot: "bg-warn" },
  ].map(x => ({ ...x, n: all.filter(r => r.status === x.status).length }));

  const time = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
  const minutes = (r: { starts_at: Date; ends_at: Date }) =>
    Math.round((r.ends_at.getTime() - r.starts_at.getTime()) / 60_000);
  const shift = (days: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const withDoctor = doctor ? `&doctor=${doctor}` : "";
  const now = new Date();

  // The chosen day is a plain calendar date; format it at UTC noon so no
  // timezone can nudge the label onto the day before or after.
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));

  const step = "grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface text-ink-2 transition-colors hover:border-ink-3 hover:text-ink";
  const control = "h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-sm text-ink transition-colors hover:border-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

  return (
    <section className="space-y-6">
      <PageHeader
        title={staff.role === "doctor" ? "Clinic day" : "Appointments"}
        subtitle={<>
          <span className="font-medium text-ink">{dayLabel}</span>
          {day === today && <Badge tone="accent">Today</Badge>}
          <span className="text-ink-3">
            {onBook} {onBook === 1 ? "appointment" : "appointments"}
          </span>
        </>}
        actions={<>
          <Link href={`/appointments/new?day=${day}${withDoctor}`} className={btnPrimary}>
            <Plus aria-hidden className="size-4" />Book appointment
          </Link>
          <Link href="/patients/new" className={btnSecondary}>
            <UserPlus aria-hidden className="size-4" />Register walk-in
          </Link>
        </>}
      />

      <Card bodyClassName="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:px-4">
        <nav aria-label="Day" className="flex items-center gap-1">
          <Link href={`/?day=${shift(-1)}${withDoctor}`} aria-label="Previous day" className={step}>
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <Link href={doctor ? `/?doctor=${doctor}` : "/"} className={`${btnSecondary} h-9 !shadow-none`}>
            Today
          </Link>
          <Link href={`/?day=${shift(1)}${withDoctor}`} aria-label="Next day" className={step}>
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </nav>

        {/* Native date field: jumping to a day next month should not be
            twenty clicks on "next". No picker library involved. */}
        <form method="GET" action="/" className="flex items-center gap-1">
          {doctor && <input type="hidden" name="doctor" value={doctor} />}
          <label htmlFor="day" className="sr-only">Go to date</label>
          <input id="day" type="date" name="day" required defaultValue={day} className={control} />
          <button className={`${btnSecondary} h-9 !shadow-none`}>Go</button>
        </form>

        <form method="GET" action="/" className="flex items-center gap-1">
          <input type="hidden" name="day" value={day} />
          <label htmlFor="doctor" className="sr-only">Doctor</label>
          <select id="doctor" name="doctor" defaultValue={doctor ?? ""} className={`${control} max-w-48`}>
            <option value="">All doctors</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className={`${btnSecondary} h-9 !shadow-none`}>Show</button>
        </form>

        {/* A native disclosure, no JS. Inside, a plain GET form: a download,
            not a page to navigate to. Defaults to the day on screen; widen the
            range for a month's report. */}
        <details className="group relative ml-auto">
          <summary className={`${btnSecondary} h-9 cursor-pointer list-none !shadow-none [&::-webkit-details-marker]:hidden`}>
            <Download aria-hidden className="size-4" />Export
            <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <form
            method="GET"
            action="/export/appointments"
            className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-line bg-surface p-4 shadow-pop"
          >
            {doctor && <input type="hidden" name="doctor" value={doctor} />}
            <p className="text-sm font-semibold text-ink">Appointments as CSV</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="export-from" className={fieldLabel}>From</label>
                <input id="export-from" type="date" name="from" required defaultValue={day} className={field} />
              </div>
              <div>
                <label htmlFor="export-to" className={fieldLabel}>To</label>
                <input id="export-to" type="date" name="to" required defaultValue={day} className={field} />
              </div>
            </div>
            <button className={`${btnPrimary} w-full`}>Download CSV</button>
          </form>
        </details>
      </Card>

      {params.error && <Alert>{params.error}</Alert>}

      {staff.role === "doctor" && (
        <Alert tone="info" className="!font-normal">
          Everyone&rsquo;s appointments, for context only — you can open and prescribe for your own
          patients from{" "}
          <Link href={`/queue?day=${day}`} className="font-semibold underline underline-offset-2 hover:text-accent-hover">
            My day
          </Link>.
        </Alert>
      )}

      <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(x => (
          <div key={x.label} className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-3">
              <span aria-hidden="true" className={`size-2 rounded-full ${x.dot}`} />{x.label}
            </p>
            <CountUp value={x.n} className="mt-2 block text-2xl font-semibold leading-none text-ink" />
          </div>
        ))}
      </Reveal>

      {rows.length === 0 ? (
        <EmptyState
          title="No appointments on this day."
          action={isDesk ? (
            <Link href={`/appointments/new?day=${day}${withDoctor}`} className={btnSecondary}>
              <Plus aria-hidden className="size-4" />Book appointment
            </Link>
          ) : undefined}
        >
          {day === today ? "Patients can book on WhatsApp at any time." : undefined}
        </EmptyState>
      ) : (
        <Card title="Schedule" description="Cancelled appointments stay listed, greyed out." bodyClassName="">
          <Reveal as="ul" className="divide-y divide-line">
            {rows.map(r => {
              const status = appointmentStatus(r.status);
              const cancelled = r.status === "cancelled";
              return (
                <li
                  key={r.id}
                  className={`flex gap-3 px-4 py-4 transition-colors hover:bg-subtle/70 sm:gap-5 sm:px-5 ${cancelled ? "opacity-60" : ""}`}
                >
                  {/* The time is the anchor of the row: it is the first thing
                      the receptionist looks for. */}
                  <div className="w-14 shrink-0 border-r border-line pr-3 sm:w-16">
                    <span className="block text-base font-semibold tabular-nums leading-tight text-ink">
                      {time(r.starts_at)}
                    </span>
                    <span className="mt-0.5 block text-xs tabular-nums text-ink-3">{minutes(r)} min</span>
                    <span className="sr-only">until {time(r.ends_at)}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-start">
                      <div className="flex min-w-0 items-start gap-3">
                        <Avatar name={r.patient_name} />
                        <div className="min-w-0">
                          <p className="font-medium break-words text-ink">{r.patient_name ?? "Unnamed"}</p>
                          <a
                            href={`tel:${r.patient_phone}`}
                            className="text-xs tabular-nums text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-accent"
                          >
                            {r.patient_phone}
                          </a>
                          <p className="mt-1 break-words text-sm text-ink-2">
                            <span className="text-ink-3">Reason (as given):</span> {r.reason_text ?? "—"}
                          </p>
                        </div>
                      </div>
                      <div className="text-sm">
                        <p className="flex items-center gap-1.5 text-ink-2">
                          <Stethoscope aria-hidden className="size-4 shrink-0 text-ink-3" />
                          <span className="sr-only">Doctor:</span>{r.doctor_name}
                        </p>
                        <p className="mt-1 text-xs"><span className="sr-only">Booked by:</span><BookedBy by={r.created_by} /></p>
                      </div>
                      <span className="flex flex-wrap gap-1 md:justify-end">
                        {r.arrived_at && r.status === "booked" && <Badge tone="ok">Arrived</Badge>}
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </span>
                    </div>

                    {isDesk && r.status === "booked" && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <VisitActions a={r} from="calendar" day={day} doctor={doctor} now={now} />
                        <Link href={`/appointments/${r.id}`} className={`${btnSecondary} ${btnSm}`}>Move / cancel</Link>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </Reveal>
        </Card>
      )}
    </section>
  );
}
