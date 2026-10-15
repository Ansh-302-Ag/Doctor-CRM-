import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { getPatient, searchPatients, type PatientSummary } from "@/lib/patients";
import { previewMerge, mergePatients, type MergeCounts } from "@/lib/merge";
import { isId, refusal } from "@/lib/desk";
import { Badge, consentStatus, btnPrimary, btnSecondary } from "../../../_ui";

const notice = "mt-4 rounded-md border px-3.5 py-2.5 text-sm";

const LABELS: Record<keyof MergeCounts, string> = {
  appointments: "Appointments", conversations: "Conversations", messages: "Messages",
  prescriptions: "Prescriptions", reminders: "Reminders", escalations: "Escalations",
  consents: "Consent records", notes: "Notes", tasks: "Tasks",
};

/** Merge a duplicate into this record: find the other one, see what moves, confirm. */
export default async function MergePatientPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; with?: string; error?: string }>;
}) {
  const staff = await currentStaff();
  // Merging is a desk judgement; a doctor never merges (src/lib/rbac.ts).
  requirePermission(staff.role, "patients:merge");
  const { id } = await params;
  const { q, with: otherId, error: errorParam } = await searchParams;
  if (!isId(id)) notFound();
  const actor = { kind: "staff" as const, id: staff.id };

  const [patient, found] = await Promise.all([
    getPatient(sql, actor, staff.role, staff.clinicId, id),
    q ? searchPatients(sql, actor, staff.role, staff.clinicId, q) : [],
  ]);
  if (!patient) notFound();
  const candidates = found.filter(p => p.id !== id);

  let error = errorParam;
  let other: PatientSummary | null = null;
  // What each record holds — whichever is not kept brings all of it across.
  let held: Record<string, MergeCounts> = {};
  if (otherId && !isId(otherId)) error = "patient not found";
  else if (otherId) {
    try {
      const [p, mine, theirs] = await Promise.all([
        getPatient(sql, actor, staff.role, staff.clinicId, otherId),
        previewMerge(sql, actor, staff.role, staff.clinicId, otherId, id),
        previewMerge(sql, actor, staff.role, staff.clinicId, id, otherId),
      ]);
      other = p;
      held = { [id]: mine, [otherId]: theirs };
    } catch (e) {
      const refused = refusal(e);
      if (refused === null) throw e;
      error = refused;
    }
  }

  async function merge(form: FormData) {
    "use server";
    const me = await currentStaff();
    const a = String(form.get("a")), b = String(form.get("b"));
    const keep = String(form.get("keep"));
    if (keep !== a && keep !== b) notFound();
    const drop = keep === a ? b : a;
    try {
      await mergePatients(sql, { kind: "staff", id: me.id }, me.role, me.clinicId, keep, drop);
    } catch (e) {
      const error = refusal(e);
      if (error === null) throw e;
      redirect(`/patients/${a}/merge?${new URLSearchParams({ error })}`);
    }
    revalidatePath(`/patients/${keep}`);
    revalidatePath(`/patients/${drop}`);
    revalidatePath("/patients");
    redirect(`/patients/${keep}`);
  }

  const card = (p: PatientSummary, checked: boolean) => {
    const consent = consentStatus(p.consent_status);
    return (
      <label key={p.id} className="flex cursor-pointer gap-3 rounded-lg border border-line bg-surface p-4 has-[:checked]:border-accent">
        <input type="radio" name="keep" value={p.id} defaultChecked={checked} className="mt-1" />
        <span className="min-w-0">
          <span className="block font-semibold break-words text-ink">{p.name ?? "Unnamed patient"}</span>
          <span className="block tabular-nums text-sm text-ink-2">{p.phone}</span>
          <span className="mt-1.5 block"><Badge tone={consent.tone}>{consent.label}</Badge></span>
          <span className="mt-2 block text-xs text-ink-3">
            {(Object.keys(LABELS) as (keyof MergeCounts)[])
              .map(k => `${LABELS[k]} ${held[p.id][k]}`).join(" · ")}
          </span>
        </span>
      </label>
    );
  };

  return (
    <section className="max-w-3xl">
      <Link href={`/patients/${id}`} className="text-sm text-ink-3 transition-colors hover:text-ink">
        &larr; {patient.name ?? "Patient record"}
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Merge with another record</h1>
      <p className="mt-1 text-sm text-ink-2">
        Find the duplicate of {patient.name ?? patient.phone}. Everything on it moves to the record you keep,
        and the other record is deleted.
      </p>

      {error && (
        <p role="alert" className={`${notice} border-danger-line bg-danger-soft font-medium text-danger-ink`}>
          {error}
        </p>
      )}

      <form method="GET" className="mt-5 flex items-center gap-2">
        <label htmlFor="merge-q" className="sr-only">Search by name or phone</label>
        <input
          id="merge-q" type="search" name="q" defaultValue={q ?? ""} placeholder="Name or phone number"
          className="w-full max-w-sm rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
        <button className={btnSecondary}>Search</button>
      </form>

      {q && (candidates.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">No other records match that search.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
          {candidates.map(p => (
            <li key={p.id}>
              <Link
                href={`/patients/${id}/merge?${new URLSearchParams({ q, with: p.id })}`}
                className="flex flex-wrap items-center gap-x-3 px-4 py-2.5 text-sm hover:bg-subtle"
              >
                <span className="font-medium text-ink">{p.name ?? "Unnamed"}</span>
                <span className="tabular-nums text-ink-2">{p.phone}</span>
              </Link>
            </li>
          ))}
        </ul>
      ))}

      {other && (
        <form action={merge} className="mt-6 rounded-lg border border-line bg-surface p-4">
          <input type="hidden" name="a" value={patient.id} />
          <input type="hidden" name="b" value={other.id} />
          <fieldset>
            <legend className="text-sm font-semibold text-ink">Which record do you keep?</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {card(patient, true)}
              {card(other, false)}
            </div>
          </fieldset>
          <p className="mt-4 text-xs leading-relaxed text-ink-3">
            Everything on the record not kept moves to the one kept, and that record is deleted.
            Consent follows the most recent consent decision on either record.
            A later message from the deleted record&rsquo;s number starts as a new contact. This cannot be undone.
          </p>
          <button className={`${btnPrimary} mt-4`}>Merge records</button>
        </form>
      )}
    </section>
  );
}
