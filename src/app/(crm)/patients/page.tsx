import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Download, Phone, Pill, Search, UserPlus, Users } from "lucide-react";
import { currentStaff } from "@/lib/session";
import { can } from "@/lib/rbac";
import { sql } from "@/lib/db";
import {
  searchPatients, patientScope, isPatientList, RECALL_AFTER_DAYS, type PatientList,
} from "@/lib/patients";
import { Reveal } from "@/components/motion/reveal";
import {
  Avatar, Badge, EmptyState, PageHeader, consentStatus,
  btnGhost, btnPrimary, btnSecondary, btnSm, field, tableWrap, td, th, tr,
} from "../_ui";

/** Saved lists, in the order the desk reaches for them. `empty` says what the
 *  list means, so an empty one reads as "nobody", not as "broken". */
const LISTS: { list: PatientList; label: string; empty: [string, string] }[] = [
  { list: "consent-pending", label: "Consent pending",
    empty: ["Nobody is waiting on consent", "Patients appear here until they have given consent."] },
  { list: "upcoming", label: "Upcoming visit",
    empty: ["No patients have a visit booked", "Patients appear here once they have an appointment booked ahead."] },
  { list: "recall", label: "Due for recall",
    empty: ["No patients are due for recall",
      `Nobody has been away for more than ${Math.round(RECALL_AFTER_DAYS / 30)} months.`] },
  { list: "on-medication", label: "On medication",
    empty: ["No patients are on medication", "Patients appear here while they have an active prescription."] },
  { list: "ai-booked", label: "Booked by assistant",
    empty: ["The assistant has not booked anyone yet", "Patients appear here once the assistant has booked an appointment for them."] },
];

export default async function PatientsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; jump?: string; list?: string }> }) {
  const staff = await currentStaff();
  const { q, jump, list: rawList } = await searchParams;
  const list = isPatientList(rawList) ? rawList : null;
  const view = LISTS.find(v => v.list === list);
  // Links keep whichever of the search and the list they do not change.
  const href = (l: string | null, query = q) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (l) p.set("list", l);
    const s = p.toString();
    return s ? `/patients?${s}` : "/patients";
  };

  // A doctor's list is his own patients — scoped in the query, not just hidden
  // in the page (docs/08). Reception and admin see the whole clinic.
  const patients = await searchPatients(
    sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, q ?? "",
    patientScope(staff), list,
  );

  // Quick find (Ctrl+K) asks to jump: one match goes straight to the record.
  // An empty query lists everyone; with one patient on file that is no jump.
  if (jump === "1" && q?.trim() && patients.length === 1) redirect(`/patients/${patients[0].id}`);

  // Dates are shown in the clinic's own timezone — the front desk reads these
  // out loud to the patient on the phone.
  const when = (at: Date | null) => at === null ? "—" : new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, dateStyle: "medium", timeStyle: "short",
  }).format(at);

  const link = "font-medium break-words text-ink transition-colors hover:text-accent";

  return (
    <section className="space-y-6">
      <PageHeader
        icon={Users}
        title={staff.role === "doctor" ? "My patients" : "Patients"}
        subtitle={
          <>
            <Badge tone="accent">{patients.length === 100 ? "100+" : patients.length}</Badge>
            <span>
              {patients.length === 100
                ? "Showing the first 100 — search to narrow"
                : q
                ? `${patients.length === 1 ? "match" : "matches"} for “${q}”`
                : view
                ? "in this list"
                : staff.role === "doctor"
                  ? "seen by you at this clinic"
                  : "on file"}
            </span>
          </>
        }
        actions={
          <>
            {/* Every patient in scope on the current list, ignoring the search. */}
            <a href={list ? `/export/patients?list=${list}` : "/export/patients"} className={btnSecondary}>
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

      <nav aria-label="Patient lists" className="-mt-2 sm:border-b sm:border-line">
        <ul className="flex flex-wrap gap-x-1 whitespace-nowrap">
          {[{ list: null, label: "All patients" }, ...LISTS].map(v => (
            <li key={v.label}>
              <Link
                href={href(v.list)}
                aria-current={v.list === list ? "page" : undefined}
                className={`-mb-px inline-block border-b-2 px-2.5 py-2 sm:px-3 sm:py-2.5 text-sm font-medium outline-offset-[-2px] transition-colors ${
                  v.list === list ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
              >
                {v.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form method="GET" className="flex items-center gap-2" role="search">
        {list && <input type="hidden" name="list" value={list} />}
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
          <Link href={href(list, "")} className={`${btnGhost} mt-1.5`}>Clear</Link>
        )}
      </form>

      {patients.length === 0 ? (
        <EmptyState
          title={q ? (view ? `No one in “${view.label}” matches that search` : "No patients match that search")
            : view ? view.empty[0]
            : staff.role === "doctor" ? "No patients have been booked with you yet"
            : "No patients yet"}
          action={q ? <Link href={href(list, "")} className={`${btnSecondary} ${btnSm}`}>Clear search</Link> : undefined}
        >
          {q ? "Check the spelling, or try the last few digits of the phone number."
            : view ? view.empty[1] : undefined}
        </EmptyState>
      ) : (
        <>
        {/* Below md the same rows render as cards. */}
        <Reveal as="ul" className="space-y-3 md:hidden">
          {patients.map(p => {
            const consent = consentStatus(p.consent_status);
            return (
              <li key={p.id} className="lift rounded-2xl border border-line bg-surface p-4 shadow-card">
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
                    <dt className="text-xs font-semibold tracking-wide text-ink-3">Next appointment</dt>
                    <dd className="mt-0.5 tabular-nums text-ink-2">{when(p.next_appointment)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-ink-3">Active prescriptions</dt>
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
