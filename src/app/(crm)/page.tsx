import Link from "next/link";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { Badge, appointmentStatus } from "./_ui";

/** Read-only day view of the clinic's booked appointments (Phase 1, docs/07):
 *  it does not need to be pretty, it needs to be accurate. */
export default async function CalendarPage({
  searchParams,
}: { searchParams: Promise<{ day?: string }> }) {
  const staff = await currentStaff();
  requirePermission(staff.role, "appointments:read");

  // The clinic's timezone rides along on currentStaff() — see src/lib/session.ts.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(new Date());
  const day = (await searchParams).day ?? today;

  // The audit write doesn't depend on the appointments query (or vice versa) —
  // running them concurrently instead of one after the other saves a full
  // Neon round trip on every page load.
  const [rows] = await Promise.all([
    sql<{
      id: string; starts_at: Date; ends_at: Date; status: string;
      doctor_name: string; patient_name: string | null; patient_phone: string;
      reason_text: string | null; created_by: string;
    }[]>`
      select a.id, a.starts_at, a.ends_at, a.status,
             d.name as doctor_name, p.name as patient_name, p.phone as patient_phone,
             a.reason_text, a.created_by
        from appointments a
        join doctors d  on d.id = a.doctor_id
        join patients p on p.id = a.patient_id
       where a.clinic_id = ${staff.clinicId} and p.deleted_at is null
         and a.status in ('booked','completed','no_show')
         -- Half-open range on the raw column. The old form,
         -- (a.starts_at at time zone tz)::date = day, applied a function to the
         -- column, so no index on starts_at could ever be used. Adding the day
         -- in local time before converting keeps a 23- or 25-hour DST day
         -- exactly one day long.
         and a.starts_at >= (${day} || ' 00:00')::timestamp at time zone ${staff.timezone}
         and a.starts_at <  ((${day} || ' 00:00')::timestamp + interval '1 day')
                            at time zone ${staff.timezone}
       order by a.starts_at`,
    audit(sql, { kind: "staff", id: staff.id }, "read_calendar", "appointments", null),
  ]);

  const time = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
  const shift = (days: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  // The chosen day is a plain calendar date; format it at UTC noon so no
  // timezone can nudge the label onto the day before or after.
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));

  const step = "grid size-9 place-items-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:border-line-strong hover:text-ink";

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {staff.role === "doctor" ? "Clinic day" : "Appointments"}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span className="font-medium text-ink">{dayLabel}</span>
            {day === today && <Badge tone="accent">Today</Badge>}
            <span className="text-ink-3">
              {rows.length} {rows.length === 1 ? "appointment" : "appointments"}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Link href={`/?day=${shift(-1)}`} aria-label="Previous day" className={step}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 5.5 8 12l6.5 6.5" />
              </svg>
            </Link>
            <Link
              href="/"
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-line-strong"
            >
              Today
            </Link>
            <Link href={`/?day=${shift(1)}`} aria-label="Next day" className={step}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
              </svg>
            </Link>
          </div>

          {/* Native date field: jumping to a day next month should not be
              twenty clicks on "next". No picker library involved. */}
          <form method="GET" action="/" className="flex items-center gap-1">
            <label htmlFor="day" className="sr-only">Go to date</label>
            <input
              id="day"
              type="date"
              name="day"
              defaultValue={day}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
            <button className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
              Go
            </button>
          </form>
        </div>
      </header>

      {staff.role === "doctor" && (
        <p className="mt-3 rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink-2">
          Everyone&rsquo;s appointments, for context only — you can open and prescribe for your own
          patients from{" "}
          <Link
            href={`/queue?day=${day}`}
            className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            My day
          </Link>.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center text-sm text-ink-3">
          Nothing booked for this day.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-subtle text-left text-xs uppercase tracking-wide text-ink-3">
                <th scope="col" className="px-4 py-2.5 font-semibold">Time</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Patient</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Doctor</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Reason (as given)</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Booked by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(r => {
                const status = appointmentStatus(r.status);
                return (
                  <tr key={r.id} className="align-top transition-colors hover:bg-subtle">
                    <td className="whitespace-nowrap py-3 pl-4 pr-4">
                      {/* The time is the anchor of the row: it is the first
                          thing the receptionist looks for. */}
                      <span className="block text-base font-semibold tabular-nums leading-tight text-ink">
                        {time(r.starts_at)}
                      </span>
                      <span className="block text-xs tabular-nums text-ink-3">
                        to {time(r.ends_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-ink">{r.patient_name ?? "Unnamed"}</span>
                      <a
                        href={`tel:${r.patient_phone}`}
                        className="text-xs tabular-nums text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-accent"
                      >
                        {r.patient_phone}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-ink-2">{r.doctor_name}</td>
                    <td className="px-4 py-3 text-ink-2">{r.reason_text ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {r.created_by === "agent"
                        ? <Badge tone="accent">AI assistant</Badge>
                        : <Badge>Staff</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
