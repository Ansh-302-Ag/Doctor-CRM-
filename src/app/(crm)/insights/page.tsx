import Link from "next/link";
import { CalendarCheck, CalendarDays, Sparkles, UserPlus, UserX } from "lucide-react";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { isId } from "@/lib/desk";
import { patientScope } from "@/lib/patients";
import { requirePermission } from "@/lib/rbac";
import { OPEN_DAYS } from "@/lib/booking";
import { getInsights, RANGES, type RangeDays } from "@/lib/insights";
import { CountUp } from "@/components/lightswind/count-up";
import { Reveal } from "@/components/motion/reveal";
import { Card, PageHeader, btnSecondary, th, td, tr } from "../_ui";
import { ColumnChart, SplitBar } from "./_charts";

const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${day}T12:00:00Z`));
const pct = (r: number | null) => (r === null ? null : Math.round(r * 100));
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** How the clinic is running: volume, attendance, and how much booking the AI
 *  assistant handles. Counts only — no patient names, nothing clinical. */
export default async function InsightsPage({
  searchParams,
}: { searchParams: Promise<{ days?: string; doctor?: string }> }) {
  const staff = await currentStaff();
  requirePermission(staff.role, "appointments:read");
  const params = await searchParams;
  const days = (RANGES as readonly number[]).includes(Number(params.days)) ? Number(params.days) as RangeDays : 7;
  const isDesk = staff.role !== "doctor";
  // A doctor always sees his own numbers; the desk may narrow to one doctor.
  const doctor = isDesk ? (params.doctor && isId(params.doctor) ? params.doctor : null) : patientScope(staff);

  const [ins, doctors] = await Promise.all([
    getInsights(sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, staff.timezone, { days }, doctor),
    isDesk
      ? sql<{ id: string; name: string }[]>`select id, name from doctors where clinic_id = ${staff.clinicId} order by name`
      : Promise.resolve([]),
  ]);

  const t = ins.totals;
  const onBook = t.booked + t.completed + t.no_show;
  const made = ins.sources.agent + ins.sources.staff;
  const aiShare = made ? Math.round((ins.sources.agent / made) * 100) : null;
  const noShow = pct(ins.noShowRate);
  const doctorName = doctor ? ins.doctors[0]?.name : null;

  const tiles = [
    { label: "Appointments", value: onBook, icon: CalendarDays, tone: "text-accent", hint: `${t.booked} still booked` },
    { label: "Completed", value: t.completed, icon: CalendarCheck, tone: "text-ok", hint: `${t.cancelled} cancelled` },
    { label: "No-show rate", value: noShow, unit: "%", icon: UserX, tone: "text-warn",
      hint: `${t.no_show} of ${t.completed + t.no_show} with an outcome` },
    { label: "New patients", value: ins.newPatients, icon: UserPlus, tone: "text-accent", hint: "registered" },
    { label: "AI-booked", value: aiShare, unit: "%", icon: Sparkles, tone: "text-accent",
      hint: `${ins.sources.agent} of ${made} bookings made` },
  ];

  const href = (d: number) => `/insights?days=${d}${isDesk && doctor ? `&doctor=${doctor}` : ""}`;
  const period = `${dayLabel(ins.from, { day: "numeric", month: "short" })} – ${dayLabel(ins.to, { day: "numeric", month: "short", year: "numeric" })}`;

  const daily = ins.daily.map(d => ({
    key: d.day, value: d.count,
    label: dayLabel(d.day, { day: "numeric", month: "short" }),
    tip: dayLabel(d.day, { weekday: "short", day: "numeric", month: "short" }),
  }));
  const busiestDay = daily.reduce((a, b) => (b.value > a.value ? b : a), daily[0]);
  const workDays = ins.daily.filter(d => OPEN_DAYS.has(dayLabel(d.day, { weekday: "short" }))).length;
  const hourly = ins.hourly.map(h => ({
    key: String(h.hour), value: h.count, label: String(h.hour).padStart(2, "0"),
    tip: `${hh(h.hour)}–${hh(h.hour + 1)}`,
  }));
  const busiestHour = hourly.reduce((a, b) => (b.value > a.value ? b : a), hourly[0]);
  const control = "h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-sm text-ink transition-colors hover:border-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

  return (
    <section className="space-y-6">
      <PageHeader
        title="Insights"
        subtitle={<>
          <span className="font-medium text-ink">{period}</span>
          <span className="text-ink-3">{doctorName ? doctorName : "Whole clinic"}</span>
        </>}
        actions={
          <nav aria-label="Period" className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
            {RANGES.map(d => (
              <Link
                key={d}
                href={href(d)}
                aria-current={d === days ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${d === days ? "bg-accent text-white" : "text-ink-2 hover:bg-subtle hover:text-ink"}`}
              >
                {d} days
              </Link>
            ))}
          </nav>
        }
      />

      {isDesk && (
        <Card bodyClassName="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:px-4">
          <form method="GET" action="/insights" className="flex items-center gap-1">
            <input type="hidden" name="days" value={days} />
            <label htmlFor="doctor" className="sr-only">Doctor</label>
            <select id="doctor" name="doctor" defaultValue={doctor ?? ""} className={`${control} max-w-48`}>
              <option value="">All doctors</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className={`${btnSecondary} h-9 !shadow-none`}>Show</button>
          </form>
        </Card>
      )}

      <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(x => (
          <div key={x.label} className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink-3">
              <x.icon aria-hidden className={`size-3.5 ${x.tone}`} />{x.label}
            </p>
            <p className="mt-2 text-2xl font-semibold leading-none text-ink">
              {x.value === null ? <span title="Nothing to measure yet">—</span> : <>
                <CountUp value={x.value} />{x.unit && <span className="text-lg">{x.unit}</span>}
              </>}
            </p>
            <p className="mt-1.5 text-xs text-ink-3">{x.hint}</p>
          </div>
        ))}
      </Reveal>

      <Card title="Appointments per day" description="Booked, completed and no-show visits by start date. Cancelled and moved ones are left out.">
        <ColumnChart
          bars={daily}
          head={["Day", "Appointments"]}
          ticks={[0, Math.floor((daily.length - 1) / 2), daily.length - 1]}
          summary={onBook === 0 ? "No appointments in this period." : <>
            {onBook} {onBook === 1 ? "appointment" : "appointments"} over {days} days, about {(onBook / Math.max(workDays, 1)).toFixed(1)} per open day.
            Busiest: <span className="font-medium text-ink">{busiestDay.tip}</span> with {busiestDay.value}.
          </>}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Busiest hours" description="Appointments by start hour, clinic time.">
          <ColumnChart
            bars={hourly}
            head={["Hour", "Appointments"]}
            ticks={hourly.map((_, i) => i)}
            peakLabel
            summary={onBook === 0 ? "No appointments in this period." : <>
              Busiest hour: <span className="font-medium text-ink">{busiestHour.tip}</span> with {busiestHour.value} {busiestHour.value === 1 ? "appointment" : "appointments"}.
            </>}
          />
        </Card>
        <Card title="Who booked" description="Appointments made in this period, by who made them.">
          <SplitBar ai={ins.sources.agent} staff={ins.sources.staff} />
        </Card>
      </div>

      {isDesk && (
        <Card title="By doctor" description="No-show rate = no-shows ÷ (completed + no-shows)." bodyClassName="">
          <div className="hidden md:block">
            <table className="w-full">
              <thead className="bg-subtle">
                <tr>
                  <th scope="col" className={th}>Doctor</th>
                  <th scope="col" className={`${th} text-right`}>Appointments</th>
                  <th scope="col" className={`${th} text-right`}>Completed</th>
                  <th scope="col" className={`${th} text-right`}>No-show</th>
                  <th scope="col" className={`${th} text-right`}>No-show rate</th>
                </tr>
              </thead>
              <tbody>
                {ins.doctors.map(d => (
                  <tr key={d.id} className={tr}>
                    <th scope="row" className={`${td} text-left font-medium text-ink`}>{d.name}</th>
                    <td className={`${td} text-right tabular-nums`}>{d.total}</td>
                    <td className={`${td} text-right tabular-nums`}>{d.completed}</td>
                    <td className={`${td} text-right tabular-nums`}>{d.noShow}</td>
                    <td className={`${td} text-right tabular-nums`}>{d.noShowRate === null ? "—" : `${pct(d.noShowRate)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {ins.doctors.map(d => (
              <li key={d.id} className="px-4 py-3">
                <p className="font-medium text-ink">{d.name}</p>
                <dl className="mt-1.5 grid grid-cols-4 gap-2 text-xs">
                  {[["Appts", d.total], ["Done", d.completed], ["No-show", d.noShow],
                    ["Rate", d.noShowRate === null ? "—" : `${pct(d.noShowRate)}%`]].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
