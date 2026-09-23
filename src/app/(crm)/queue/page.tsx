import Link from "next/link";
import { notFound } from "next/navigation";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { doctorQueue, nextInQueue } from "@/lib/doctor";
import { Badge, appointmentStatus, btnPrimary, btnSecondary } from "../_ui";

/** The screen a doctor works from: his own day, in order, with who is next.
 *  Everyone else's day is on the calendar at "/" — read-only, for context.
 *
 *  Sized to be read from across the desk: the time and the patient's name are
 *  the two things he glances at between consultations, so they are the two
 *  largest things on the row. */
export default async function QueuePage({
  searchParams,
}: { searchParams: Promise<{ day?: string }> }) {
  const staff = await currentStaff();
  // Only a doctor has a queue. A receptionist reaching this URL gets a 404
  // rather than a hint that there is something here to find.
  if (staff.role !== "doctor" || !staff.doctorId) notFound();

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(new Date());
  const day = (await searchParams).day ?? today;

  const rows = await doctorQueue(
    sql, { kind: "staff", id: staff.id }, staff.clinicId, staff.doctorId, day, staff.timezone);

  const now = new Date();
  const next = nextInQueue(rows, now);
  const time = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
  const shift = (days: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  // Format at UTC noon so no timezone can nudge the label onto the day before.
  const dayLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));

  const step = "grid size-9 place-items-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:border-line-strong hover:text-ink";

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">My day</h1>
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
            <Link href={`/queue?day=${shift(-1)}`} aria-label="Previous day" className={step}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 5.5 8 12l6.5 6.5" />
              </svg>
            </Link>
            <Link
              href="/queue"
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-line-strong"
            >
              Today
            </Link>
            <Link href={`/queue?day=${shift(1)}`} aria-label="Next day" className={step}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
              </svg>
            </Link>
          </div>
          <form method="GET" action="/queue" className="flex items-center gap-1">
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

      <p className="mt-3 text-sm text-ink-2">
        {next
          ? <>Up next: <span className="font-semibold text-ink">{next.patient_name ?? "Unnamed patient"}</span> at{" "}
              <span className="font-semibold tabular-nums text-ink">{time(next.starts_at)}</span>.</>
          : rows.length > 0 ? "Nothing still to come today." : null}{" "}
        <Link
          href={`/?day=${day}`}
          className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          See the whole clinic&rsquo;s day
        </Link>
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center text-sm text-ink-3">
          Nothing booked with you for this day.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map(r => {
            const isNext = next?.id === r.id;
            const status = appointmentStatus(r.status);
            return (
              <li
                key={r.id}
                className={`rounded-lg border bg-surface p-4 sm:p-5 ${
                  isNext ? "border-accent border-l-4 shadow-sm" : "border-line"}`}
              >
                <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                  {/* The clock reading is the anchor: biggest thing on the row. */}
                  <div className="w-24 shrink-0">
                    <span className="block text-2xl font-semibold leading-none tabular-nums text-ink">
                      {time(r.starts_at)}
                    </span>
                    <span className="mt-1 block text-xs tabular-nums text-ink-3">
                      to {time(r.ends_at)}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {isNext && (
                        <span className="rounded bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-white">
                          Next
                        </span>
                      )}
                      <Link
                        href={`/patients/${r.patient_id}`}
                        className="min-w-0 break-words text-lg font-semibold text-ink underline decoration-line-strong underline-offset-2 hover:text-accent"
                      >
                        {r.patient_name ?? "Unnamed patient"}
                      </Link>
                      <a
                        href={`tel:${r.patient_phone}`}
                        className="tabular-nums text-sm text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent"
                      >
                        {r.patient_phone}
                      </a>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="mt-2 break-words text-sm text-ink-2">
                      <span className="text-ink-3">Reason (as given):</span>{" "}
                      {r.reason_text ?? "—"}
                    </p>
                  </div>

                  <Link href={`/patients/${r.patient_id}`} className={isNext ? btnPrimary : btnSecondary}>
                    Open record &amp; prescribe
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
