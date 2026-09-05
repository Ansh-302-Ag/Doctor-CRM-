import Link from "next/link";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { searchPatients } from "@/lib/patients";

export default async function PatientsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const staff = await currentStaff();
  const { q } = await searchParams;

  const patients = await searchPatients(
    sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, q ?? "",
  );

  const when = (at: Date | null) => at === null ? "—" : new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "short",
  }).format(at);

  return (
    <section>
      <h1 className="text-lg font-semibold text-slate-900">Patients</h1>

      <form method="GET" className="mt-4 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          aria-label="Search patients"
          placeholder="Search by name or phone"
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
          Search
        </button>
      </form>

      {patients.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {q ? "No patients match that search." : "No patients yet."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Consent</th>
                <th className="px-4 py-2 font-medium">Next appointment</th>
                <th className="px-4 py-2 font-medium">Active prescriptions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patients.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <Link href={`/patients/${p.id}`} className="text-slate-900 hover:underline">
                      {p.name ?? "Unnamed"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{p.phone}</td>
                  <td className="px-4 py-2 text-slate-600">{p.consent_status}</td>
                  <td className="px-4 py-2 text-slate-600">{when(p.next_appointment)}</td>
                  <td className="px-4 py-2 text-slate-600">{p.active_prescriptions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
