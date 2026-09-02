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

  const [clinic] = await sql<{ timezone: string }[]>`
    select timezone from clinics where id = ${staff.clinicId}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: clinic.timezone }).format(new Date());
  const day = (await searchParams).day ?? today;

  const rows = await sql<{
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
     where a.clinic_id = ${staff.clinicId}
       and a.status in ('booked','completed','no_show')
       and (a.starts_at at time zone ${clinic.timezone})::date = ${day}::date
     order by a.starts_at`;

  await audit(sql, { kind: "staff", id: staff.id }, "read_calendar", "appointments", null);

  const time = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: clinic.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
  const shift = (days: number) =>
    new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  return (
    <section>
      <div className="flex items-baseline gap-4">
        <h1 className="text-lg font-semibold text-slate-900">Appointments</h1>
        <span className="text-sm text-slate-500">{day}</span>
        <nav className="ml-auto flex gap-3 text-sm">
          <a href={`/?day=${shift(-1)}`} className="text-slate-600 hover:text-slate-900">← Previous</a>
          <a href="/" className="text-slate-600 hover:text-slate-900">Today</a>
          <a href={`/?day=${shift(1)}`} className="text-slate-600 hover:text-slate-900">Next →</a>
        </nav>
      </div>

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
