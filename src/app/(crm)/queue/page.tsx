import Link from "next/link";
import { notFound } from "next/navigation";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { doctorQueue, nextInQueue } from "@/lib/doctor";

/** The screen a doctor works from: his own day, in order, with who is next.
 *  Everyone else's day is on the calendar at "/" — read-only, for context. */
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
  const heading = new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, weekday: "long", day: "numeric", month: "long",
  }).format(new Date(`${day}T12:00:00Z`));

  return (
    <section>
      <div className="flex items-baseline gap-4">
        <h1 className="text-lg font-semibold text-slate-900">My day</h1>
        <span className="text-sm text-slate-500">{heading}</span>
        <nav className="ml-auto flex gap-3 text-sm">
          <Link href={`/queue?day=${shift(-1)}`} className="text-slate-600 hover:text-slate-900">← Previous</Link>
          <Link href="/queue" className="text-slate-600 hover:text-slate-900">Today</Link>
          <Link href={`/queue?day=${shift(1)}`} className="text-slate-600 hover:text-slate-900">Next →</Link>
        </nav>
      </div>

      <p className="mt-1 text-sm text-slate-500">
        {rows.length === 0 ? "Your list for this day." : (
          <>
            {rows.length} appointment{rows.length === 1 ? "" : "s"} ·{" "}
            {next ? `next: ${next.patient_name ?? "Unnamed patient"} at ${time(next.starts_at)}` : "none still to come"}
          </>
        )}{" "}
        <Link href={`/?day=${day}`} className="text-slate-600 underline hover:text-slate-900">
          See the whole clinic&rsquo;s day
        </Link>
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Nothing booked with you for this day.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map(r => {
            const isNext = next?.id === r.id;
            return (
              <li key={r.id}
                className={`rounded-lg border bg-white p-4 ${
                  isNext ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-mono text-slate-900">
                    {time(r.starts_at)}–{time(r.ends_at)}
                  </span>
                  {isNext && (
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white">
                      NEXT
                    </span>
                  )}
                  <Link href={`/patients/${r.patient_id}`}
                    className="font-medium text-slate-900 hover:underline">
                    {r.patient_name ?? "Unnamed patient"}
                  </Link>
                  <span className="text-slate-500">{r.patient_phone}</span>
                  <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {r.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Reason (as given): {r.reason_text ?? "—"}
                </p>
                <Link href={`/patients/${r.patient_id}`}
                  className="mt-3 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                  Open record &amp; prescribe
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
