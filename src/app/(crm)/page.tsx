import Link from "next/link";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";

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

  return (
    <section>
      <div className="flex items-baseline gap-4">
        <h1 className="text-lg font-semibold text-slate-900">
          {staff.role === "doctor" ? "Clinic day" : "Appointments"}
        </h1>
        <span className="text-sm text-slate-500">{day}</span>
        <nav className="ml-auto flex gap-3 text-sm">
          <Link href={`/?day=${shift(-1)}`} className="text-slate-600 hover:text-slate-900">← Previous</Link>
          <Link href="/" className="text-slate-600 hover:text-slate-900">Today</Link>
          <Link href={`/?day=${shift(1)}`} className="text-slate-600 hover:text-slate-900">Next →</Link>
        </nav>
      </div>

      {staff.role === "doctor" && (
        <p className="mt-1 text-sm text-slate-500">
          Everyone&rsquo;s appointments, for context only — you can open and prescribe for your own
          patients from{" "}
          <Link href={`/queue?day=${day}`} className="text-slate-600 underline hover:text-slate-900">
            My day
          </Link>.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Nothing booked for this day.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Doctor</th>
                <th className="px-4 py-2 font-medium">Patient</th>
                <th className="px-4 py-2 font-medium">Reason (as given)</th>
                <th className="px-4 py-2 font-medium">Booked by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-slate-900">
                    {time(r.starts_at)}–{time(r.ends_at)}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{r.doctor_name}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {r.patient_name ?? "—"}
                    <span className="block text-xs text-slate-400">{r.patient_phone}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{r.reason_text ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {r.created_by === "agent" ? "AI assistant" : "Staff"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
