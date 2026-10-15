import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Phone, Stethoscope } from "lucide-react";
import { validDay } from "@/lib/valid-day";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { isId } from "@/lib/desk";
import { CountUp } from "@/components/lightswind/count-up";
import { Reveal } from "@/components/motion/reveal";
import { Alert, Avatar, Badge, Card, PageHeader, btnSecondary, btnSm } from "../_ui";
import { VisitActions } from "../appointments/_visit";

/** The day's visits as columns, booked → arrived → completed / no-show.
 *  Same data as the calendar, laid out for "where is everyone right now". */
export default async function BoardPage({
  searchParams,
}: { searchParams: Promise<{ day?: string; doctor?: string; error?: string }> }) {
  const staff = await currentStaff();
  requirePermission(staff.role, "appointments:read");

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(new Date());
  const params = await searchParams;
  const day = validDay(params.day, today);
  const isDesk = staff.role !== "doctor";
  if (!isDesk && !staff.doctorId) notFound();
  // A doctor sees only his own book; the desk may narrow to one doctor.
  const doctor = isDesk ? (params.doctor && isId(params.doctor) ? params.doctor : null) : staff.doctorId;

  const [all, doctors] = await Promise.all([
    sql<{
      id: string; starts_at: Date; ends_at: Date; status: string; arrived_at: Date | null;
      doctor_name: string; patient_id: string; patient_name: string | null; patient_phone: string;
      reason_text: string | null; created_by: string;
    }[]>`
      select a.id, a.starts_at, a.ends_at, a.status, a.arrived_at,
             d.name as doctor_name, p.id as patient_id, p.name as patient_name, p.phone as patient_phone,
             a.reason_text, a.created_by
        from appointments a
        join doctors d  on d.id = a.doctor_id
        join patients p on p.id = a.patient_id
       where a.clinic_id = ${staff.clinicId} and p.deleted_at is null
         and a.status in ('booked','completed','no_show','cancelled','rescheduled')
         ${doctor ? sql`and a.doctor_id = ${doctor}` : sql``}
         and a.starts_at >= (${day} || ' 00:00')::timestamp at time zone ${staff.timezone}
         and a.starts_at <  ((${day} || ' 00:00')::timestamp + interval '1 day')
                            at time zone ${staff.timezone}
       order by a.starts_at`,
    isDesk
      ? sql<{ id: string; name: string }[]>`
          select id, name from doctors where clinic_id = ${staff.clinicId} order by name`
      : Promise.resolve([]),
    audit(sql, { kind: "staff", id: staff.id }, "read_calendar", "appointments", null),
  ]);

  const columns = [
    { key: "booked", label: "Booked", dot: "bg-accent", rows: all.filter(r => r.status === "booked" && !r.arrived_at) },
    { key: "arrived", label: "Arrived", dot: "bg-warn", rows: all.filter(r => r.status === "booked" && r.arrived_at) },
    { key: "completed", label: "Completed", dot: "bg-ok", rows: all.filter(r => r.status === "completed") },
    { key: "no_show", label: "No-show", dot: "bg-danger", rows: all.filter(r => r.status === "no_show") },
  ];
  const offBoard = all.filter(r => r.status === "cancelled" || r.status === "rescheduled").length;
  const onBoard = all.length - offBoard;

  const time = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
  const shift = (days: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const withDoctor = isDesk && doctor ? `&doctor=${doctor}` : "";
  const now = new Date();
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));

  const step = "grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface text-ink-2 transition-colors hover:border-ink-3 hover:text-ink";
  const control = "h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-sm text-ink transition-colors hover:border-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

  return (
    <section className="space-y-6">
      <PageHeader
        title="Today's board"
        subtitle={<>
          <span className="font-medium text-ink">{dayLabel}</span>
          {day === today && <Badge tone="accent">Today</Badge>}
          <span className="text-ink-3">{onBoard} {onBoard === 1 ? "visit" : "visits"}</span>
        </>}
      />

      <Card bodyClassName="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:px-4">
        <nav aria-label="Day" className="flex items-center gap-1">
          <Link href={`/board?day=${shift(-1)}${withDoctor}`} aria-label="Previous day" className={step}>
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <Link href={withDoctor ? `/board?doctor=${doctor}` : "/board"} className={`${btnSecondary} h-9 !shadow-none`}>
            Today
          </Link>
          <Link href={`/board?day=${shift(1)}${withDoctor}`} aria-label="Next day" className={step}>
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </nav>

        <form method="GET" action="/board" className="flex items-center gap-1">
          {withDoctor && <input type="hidden" name="doctor" value={doctor!} />}
          <label htmlFor="day" className="sr-only">Go to date</label>
          <input id="day" type="date" name="day" required defaultValue={day} className={control} />
          <button className={`${btnSecondary} h-9 !shadow-none`}>Go</button>
        </form>

        {isDesk && (
          <form method="GET" action="/board" className="flex items-center gap-1">
            <input type="hidden" name="day" value={day} />
            <label htmlFor="doctor" className="sr-only">Doctor</label>
            <select id="doctor" name="doctor" defaultValue={doctor ?? ""} className={`${control} max-w-48`}>
              <option value="">All doctors</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className={`${btnSecondary} h-9 !shadow-none`}>Show</button>
          </form>
        )}

        {offBoard > 0 && (
          <p className="text-xs text-ink-3 sm:ml-auto">
            {offBoard} cancelled or rescheduled, not shown
          </p>
        )}
      </Card>

      {params.error && <Alert>{params.error}</Alert>}

      {/* Columns scroll sideways inside this box on phones; the page itself never does. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid snap-x snap-mandatory auto-cols-[min(18rem,82vw)] grid-flow-col gap-4 lg:auto-cols-auto lg:grid-flow-row lg:grid-cols-4">
          {columns.map(col => (
            <section
              key={col.key}
              aria-labelledby={`col-${col.key}`}
              className="flex min-w-0 snap-start flex-col rounded-xl border border-line bg-subtle/60 p-2.5"
            >
              <h2 id={`col-${col.key}`} className="flex items-center gap-2 px-1.5 pb-2.5 pt-1 text-sm font-semibold text-ink">
                <span aria-hidden="true" className={`size-2 rounded-full ${col.dot}`} />
                {col.label}
                <CountUp
                  value={col.rows.length}
                  className="ml-auto min-w-6 rounded-full bg-surface px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-ink-2 ring-1 ring-line"
                />
              </h2>

              {col.rows.length === 0 ? (
                <p className="grid min-h-24 place-items-center rounded-lg border border-dashed border-line-strong px-3 text-center text-xs text-ink-3">
                  No visits here
                </p>
              ) : (
                <Reveal as="ul" className="space-y-2.5">
                  {col.rows.map(r => (
                    <li key={r.id} className="rounded-xl border border-line bg-surface p-3.5 shadow-card">
                      <p className="text-xs font-semibold tabular-nums text-ink-2">
                        {time(r.starts_at)}–{time(r.ends_at)}
                      </p>
                      <div className="mt-2 flex min-w-0 items-start gap-2.5">
                        <Avatar name={r.patient_name} size="sm" />
                        <div className="min-w-0">
                          <Link
                            href={`/patients/${r.patient_id}`}
                            className="block font-medium break-words text-ink hover:text-accent hover:underline"
                          >
                            {r.patient_name ?? "Unnamed"}
                          </Link>
                          <a
                            href={`tel:${r.patient_phone}`}
                            className="inline-flex items-center gap-1 text-xs tabular-nums text-ink-3 hover:text-accent"
                          >
                            <Phone aria-hidden className="size-3" />{r.patient_phone}
                          </a>
                        </div>
                      </div>
                      <p className="mt-2 break-words text-sm text-ink-2">
                        <span className="text-ink-3">Reason (as given):</span> {r.reason_text ?? "—"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {isDesk && (
                          <span className="inline-flex items-center gap-1 text-ink-2">
                            <Stethoscope aria-hidden className="size-3.5 text-ink-3" />
                            <span className="sr-only">Doctor:</span>{r.doctor_name}
                          </span>
                        )}
                        <span className={r.created_by === "agent" ? "font-medium text-accent" : "text-ink-3"}>
                          <span className="sr-only">Booked by:</span>
                          {r.created_by === "agent" ? "AI assistant" : "Staff"}
                        </span>
                      </div>
                      {r.status === "booked" && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                          <VisitActions
                            a={r} from="board" day={day}
                            doctor={isDesk ? doctor : null} now={now}
                          />
                          {isDesk && (
                            <Link href={`/appointments/${r.id}`} className={`${btnSecondary} ${btnSm}`}>Move / cancel</Link>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </Reveal>
              )}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
