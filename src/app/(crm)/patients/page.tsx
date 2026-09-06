import Link from "next/link";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { searchPatients, patientScope } from "@/lib/patients";
import { Badge, consentStatus, btnPrimary } from "../_ui";

export default async function PatientsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const staff = await currentStaff();
  const { q } = await searchParams;

  // A doctor's list is his own patients — scoped in the query, not just hidden
  // in the page (docs/08). Reception and admin see the whole clinic.
  const patients = await searchPatients(
    sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, q ?? "",
    patientScope(staff),
  );

  // Dates are shown in the clinic's own timezone — the front desk reads these
  // out loud to the patient on the phone.
  const when = (at: Date | null) => at === null ? "—" : new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, dateStyle: "medium", timeStyle: "short",
  }).format(at);

  return (
    <section>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {staff.role === "doctor" ? "My patients" : "Patients"}
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            {q
              ? `${patients.length} ${patients.length === 1 ? "match" : "matches"} for “${q}”`
              : staff.role === "doctor"
                ? `${patients.length} seen by you at this clinic`
                : `${patients.length} on file`}
          </p>
        </div>

        <form method="GET" className="flex w-full items-center gap-2 sm:w-auto">
          <label htmlFor="q" className="sr-only">Search patients by name or phone</label>
          <div className="relative flex-1 sm:w-72 sm:flex-none">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              id="q"
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Name or phone number"
              className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink"
            />
          </div>
          <button className={btnPrimary}>Search</button>
          {q && (
            <Link href="/patients" className="text-sm text-ink-3 underline underline-offset-2 hover:text-ink">
              Clear
            </Link>
          )}
        </form>
      </header>

      {patients.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center text-sm text-ink-3">
          {q ? "No patients match that search."
             : staff.role === "doctor" ? "No patients have been booked with you yet."
             : "No patients yet."}
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-subtle text-left text-xs uppercase tracking-wide text-ink-3">
                <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Phone</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Consent</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Next appointment</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Active prescriptions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {patients.map(p => {
                const consent = consentStatus(p.consent_status);
                return (
                  <tr key={p.id} className="transition-colors hover:bg-subtle">
                    <td className="px-4 py-3">
                      <Link
                        href={`/patients/${p.id}`}
                        className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:text-accent"
                      >
                        {p.name ?? "Unnamed"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`tel:${p.phone}`}
                        className="tabular-nums text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent"
                      >
                        {p.phone}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={consent.tone}>{consent.label}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-2">
                      {when(p.next_appointment)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-2">
                      {p.active_prescriptions}
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
