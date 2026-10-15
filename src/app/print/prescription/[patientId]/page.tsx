/** A prescription sheet to hand over or print: outside the CRM shell, so no
 *  sidebar, sized for A5. Shows the given prescriptions (?ids=a,b) or else the
 *  patient's active ones, exactly as stored. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { getPatient, patientScope } from "@/lib/patients";
import { listPrescriptions } from "@/lib/prescriptions";
import { isId } from "@/lib/desk";
import { PrintButton } from "./_print-button";

export const metadata: Metadata = { title: "Prescription" };

export default async function PrintPrescriptionPage({
  params, searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ ids?: string }>;
}) {
  const staff = await currentStaff();
  requirePermission(staff.role, "prescriptions:read");
  const { patientId } = await params;
  const { ids: idsRaw } = await searchParams;
  if (!isId(patientId)) notFound();
  const ids = typeof idsRaw === "string" ? idsRaw.split(",").map(s => s.trim()).filter(isId) : [];

  const actor = { kind: "staff" as const, id: staff.id };
  const [patient, all, [clinic]] = await Promise.all([
    getPatient(sql, actor, staff.role, staff.clinicId, patientId, patientScope(staff)),
    listPrescriptions(sql, actor, staff.role, staff.clinicId, patientId),
    sql<{ name: string; phone: string | null }[]>`
      select name, phone from clinics where id = ${staff.clinicId}`,
  ]);
  if (!patient) notFound();

  // Oldest first, the order they were written in.
  const rx = (ids.length ? all.filter(p => ids.includes(p.id)) : all.filter(p => p.status === "active"))
    .reverse();
  const doctors = [...new Set(rx.map(p => p.doctor_name))];
  const latest = rx.at(-1)?.created_at ?? new Date();
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: staff.timezone, dateStyle: "long" }).format(latest);

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 print:bg-surface print:p-0">
      <style>{"@page { size: A5; margin: 12mm; }"}</style>
      <div className="mx-auto mb-4 flex max-w-[148mm] items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-ink-3">Check the sheet, then print or save as PDF.</p>
        <PrintButton />
      </div>

      <article className="mx-auto flex min-h-[200mm] max-w-[148mm] flex-col rounded-2xl border border-line bg-surface p-8 text-ink shadow-pop print:min-h-0 print:rounded-none print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start gap-3 border-b-2 border-accent pb-3">
          <span aria-hidden="true" className="bg-brand grid size-10 shrink-0 place-items-center rounded-xl text-white print:[print-color-adjust:exact]">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5Z" /></svg>
          </span>
          <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-accent-ink">{clinic.name}</h1>
          {clinic.phone && <p className="text-sm tabular-nums text-ink-2">Phone {clinic.phone}</p>}
          {doctors.length > 0 && <p className="mt-1 text-sm font-medium">{doctors.join(", ")}</p>}
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-3">Patient</dt>
          <dd className="font-semibold">{patient.name ?? "Unnamed patient"}</dd>
          <dt className="text-ink-3">Phone</dt>
          <dd className="tabular-nums">{patient.phone}</dd>
          <dt className="text-ink-3">Date</dt>
          <dd className="tabular-nums">{date}</dd>
        </dl>

        <p aria-hidden="true" className="mt-6 font-serif text-4xl leading-none text-accent">&#8478;</p>
        {rx.length === 0 ? (
          <p className="mt-4 text-sm text-ink-3">No {ids.length ? "matching" : "active"} prescriptions on record.</p>
        ) : (
          <ol className="mt-3 space-y-4">
            {rx.map((p, i) => (
              <li key={p.id} className="flex gap-3 break-inside-avoid">
                <span className="w-5 shrink-0 font-semibold tabular-nums">{i + 1}.</span>
                <div className="min-w-0 break-words">
                  <p className="font-semibold">{p.drug_name}</p>
                  <p className="text-sm">
                    {p.dosage}
                    {p.duration_days !== null && ` · for ${p.duration_days} day${p.duration_days === 1 ? "" : "s"}`}
                  </p>
                  {p.notes && <p className="text-sm text-ink-2">{p.notes}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-auto pt-16">
          <div className="ml-auto w-48 border-t border-ink pt-1 text-center text-xs text-ink-2">
            Doctor&rsquo;s signature
          </div>
          <p className="mt-6 text-center text-[10px] text-ink-3">Generated from Doctor-CRM</p>
        </div>
      </article>
    </main>
  );
}
