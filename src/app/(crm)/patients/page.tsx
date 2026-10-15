import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Download, Phone, Pill, Search, UserPlus } from "lucide-react";
import { currentStaff } from "@/lib/session";
import { can } from "@/lib/rbac";
import { sql } from "@/lib/db";
import { searchPatients, patientScope } from "@/lib/patients";
import { Reveal } from "@/components/motion/reveal";
import {
  Avatar, Badge, EmptyState, PageHeader, consentStatus,
  btnGhost, btnPrimary, btnSecondary, btnSm, field, tableWrap, td, th, tr,
} from "../_ui";

export default async function PatientsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; jump?: string }> }) {
  const staff = await currentStaff();
  const { q, jump } = await searchParams;

  // A doctor's list is his own patients — scoped in the query, not just hidden
  // in the page (docs/08). Reception and admin see the whole clinic.
  const patients = await searchPatients(
    sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, q ?? "",
    patientScope(staff),
  );

  // Quick find (Ctrl+K) asks to jump: one match goes straight to the record.
  if (jump === "1" && patients.length === 1) redirect(`/patients/${patients[0].id}`);

  // Dates are shown in the clinic's own timezone — the front desk reads these
  // out loud to the patient on the phone.
  const when = (at: Date | null) => at === null ? "—" : new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, dateStyle: "medium", timeStyle: "short",
  }).format(at);

  const link = "font-medium break-words text-ink transition-colors hover:text-accent";

  return (
    <section className="space-y-6">
      <PageHeader
        title={staff.role === "doctor" ? "My patients" : "Patients"}
        subtitle={
          <>
            <Badge tone="accent">{patients.length === 100 ? "100+" : patients.length}</Badge>
            <span>
              {patients.length === 100
                ? "Showing the first 100 — search to narrow"
                : q
                ? `${patients.length === 1 ? "match" : "matches"} for “${q}”`
                : staff.role === "doctor"
                  ? "seen by you at this clinic"
                  : "on file"}
            </span>
          </>
        }
        actions={
          <>
            {/* Every patient in scope, not just the current search. */}
            <a href="/export/patients" className={btnSecondary}>
              <Download className="size-4" aria-hidden="true" /> Download CSV
            </a>
            {can(staff.role, "patients:write") && (
              <Link href="/patients/new" className={btnPrimary}>
                <UserPlus className="size-4" aria-hidden="true" /> Register walk-in
              </Link>
            )}
          </>
        }
      />

      <form method="GET" className="flex items-center gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search patients by name or phone</label>
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-ink-3" />
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by name or phone number"
            className={`${field} !py-2.5 pl-10`}
          />
        </div>
        <button className={`${btnPrimary} mt-1.5 !py-2.5`}>Search</button>
        {q && (
          <Link href="/patients" className={`${btnGhost} mt-1.5`}>Clear</Link>
        )}
      </form>

      {patients.length === 0 ? (
        <EmptyState
          title={q ? "No patients match that search"
            : staff.role === "doctor" ? "No patients have been booked with you yet"
            : "No patients yet"}
          action={q ? <Link href="/patients" className={`${btnSecondary} ${btnSm}`}>Clear search</Link> : undefined}
        >
          {q ? "Check the spelling, or try the last few digits of the phone number." : undefined}
        </EmptyState>
      ) : (
        <>
        {/* Below md the same rows render as cards. */}
        <Reveal as="ul" className="space-y-3 md:hidden">
          {patients.map(p => {
            const consent = consentStatus(p.consent_status);
            return (
              <li key={p.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/patients/${p.id}`} className={`${link} min-w-0 text-base leading-tight`}>
                        {p.name ?? "Unnamed"}
                      </Link>
                      <Badge tone={consent.tone}>{consent.label}</Badge>
                    </div>
                    <a
                      href={`tel:${p.phone}`}
                      className="mt-1 inline-flex items-center gap-1.5 text-sm tabular-nums text-ink-2 hover:text-accent"
                    >
                      <Phone className="size-3.5 text-ink-3" aria-hidden="true" />
                      {p.phone}
                    </a>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Next appointment</dt>
                    <dd className="mt-0.5 tabular-nums text-ink-2">{when(p.next_appointment)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Active prescriptions</dt>
                    <dd className="mt-0.5 tabular-nums text-ink-2">{p.active_prescriptions}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </Reveal>

        <div className={`hidden md:block ${tableWrap}`}>
          <table className="w-full min-w-[700px] border-collapse">
            <thead>
              <tr className="whitespace-nowrap">
                <th scope="col" className={th}>Name</th>
                <th scope="col" className={th}>Phone</th>
                <th scope="col" className={th}>Consent</th>
                <th scope="col" className={th}>Next appointment</th>
                <th scope="col" className={`${th} text-right`}>Active prescriptions</th>
              </tr>
            </thead>
            <Reveal as="tbody">
              {patients.map(p => {
                const consent = consentStatus(p.consent_status);
                return (
                  <tr key={p.id} className={tr}>
                    <td className={td}>
                      <div className="flex items-center gap-3">
                        <Avatar name={p.name} size="sm" />
                        <Link href={`/patients/${p.id}`} className={link}>
                          {p.name ?? "Unnamed"}
                        </Link>
                      </div>
                    </td>
                    <td className={td}>
                      <a href={`tel:${p.phone}`} className="whitespace-nowrap tabular-nums hover:text-accent">
                        {p.phone}
                      </a>
                    </td>
                    <td className={td}>
                      <Badge tone={consent.tone}>{consent.label}</Badge>
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>
                      {p.next_appointment ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="size-3.5 text-ink-3" aria-hidden="true" />
                          {when(p.next_appointment)}
                        </span>
                      ) : <span className="text-ink-3">—</span>}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {p.active_prescriptions > 0 ? (
                        <span className="inline-flex items-center gap-1 font-medium text-ok-ink">
                          <Pill className="size-3.5" aria-hidden="true" />
                          {p.active_prescriptions}
                        </span>
                      ) : <span className="text-ink-3">{p.active_prescriptions}</span>}
                    </td>
                  </tr>
                );
              })}
            </Reveal>
          </table>
        </div>
        </>
      )}
    </section>
  );
}
