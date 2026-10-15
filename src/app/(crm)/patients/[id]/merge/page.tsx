import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getPatient, searchPatients, type PatientSummary } from "@/lib/patients";
import { previewMerge, mergePatients, type MergeCounts } from "@/lib/merge";
import { isId, refusal } from "@/lib/desk";
import {
  Alert, Avatar, Badge, Card, EmptyState, PageHeader, consentStatus, btnDanger, btnSecondary, field,
} from "../../../_ui";
import { Reveal } from "@/components/motion/reveal";
import { Search } from "lucide-react";


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
  // Merging is a desk judgement; a doctor never merges (src/lib/rbac.ts). Said
  // plainly here rather than thrown to the error page; the action re-checks.
  if (!can(staff.role, "patients:merge")) {
    return (
      <section>
        <PageHeader title="Merge duplicate records" back={{ href: "/patients", label: "Patients" }} />
        <EmptyState title="Not available for your role">
          The front desk or an admin merges duplicate records.
        </EmptyState>
      </section>
    );
  }
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

  const card = (p: PatientSummary, checked: boolean, role: string) => {
    const consent = consentStatus(p.consent_status);
    return (
      <label
        key={p.id}
        className="group flex min-w-0 cursor-pointer flex-col rounded-xl border-2 border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong has-[:checked]:border-accent has-[:checked]:bg-accent-soft/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold tracking-wide text-ink-3">{role}</span>
          <span className="flex items-center gap-2 text-xs font-semibold">
            <span className="hidden text-accent-ink group-has-[:checked]:inline">Keep</span>
            <span className="text-danger-ink group-has-[:checked]:hidden">Merge in &amp; delete</span>
            <input type="radio" name="keep" value={p.id} defaultChecked={checked} className="size-4 accent-accent" />
          </span>
        </span>
        <span className="mt-3 flex min-w-0 items-center gap-3">
          <Avatar name={p.name} />
          <span className="min-w-0">
            <span className="block font-semibold break-words text-ink">{p.name ?? "Unnamed patient"}</span>
            <span className="block tabular-nums text-sm text-ink-2">{p.phone}</span>
          </span>
        </span>
        <span className="mt-3 block"><Badge tone={consent.tone}>Consent: {consent.label}</Badge></span>
        <span className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line pt-3 text-sm">
          {(Object.keys(LABELS) as (keyof MergeCounts)[]).map(k => (
            <span key={k} className="flex justify-between gap-2">
              <span className="text-ink-3">{LABELS[k]}</span>
              <span className="font-semibold tabular-nums text-ink">{held[p.id][k]}</span>
            </span>
          ))}
        </span>
      </label>
    );
  };

  return (
    <section className="max-w-4xl">
      <PageHeader
        back={{ href: `/patients/${id}`, label: patient.name ?? "Patient record" }}
        title="Merge with another record"
        subtitle={<>
          Find the duplicate of {patient.name ?? patient.phone}. Everything on it moves to the record you keep,
          and the other record is deleted.
        </>}
      />

      <div className="space-y-6">
        {error && <Alert tone="danger">{error}</Alert>}

        <Card title="Find the duplicate">
          <form method="GET" className="flex flex-wrap items-center gap-2">
            <label htmlFor="merge-q" className="sr-only">Search by name or phone</label>
            <input
              id="merge-q" type="search" name="q" defaultValue={q ?? ""} placeholder="Name or phone number"
              className={`${field} !mt-0 min-w-0 flex-1 sm:max-w-sm`}
            />
            <button className={btnSecondary}><Search aria-hidden className="size-4" /> Search</button>
          </form>

          {q && (candidates.length === 0 ? (
            <div className="mt-4"><EmptyState title="No other records match that search." /></div>
          ) : (
            <Reveal as="ul" className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
              {candidates.map(p => (
                <li key={p.id}>
                  <Link
                    href={`/patients/${id}/merge?${new URLSearchParams({ q, with: p.id })}`}
                    aria-current={p.id === otherId ? "true" : undefined}
                    className="flex min-w-0 items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-subtle aria-[current]:bg-accent-soft"
                  >
                    <Avatar name={p.name} size="sm" />
                    <span className="min-w-0 truncate font-medium text-ink">{p.name ?? "Unnamed"}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-ink-2">{p.phone}</span>
                  </Link>
                </li>
              ))}
            </Reveal>
          ))}
        </Card>

        {other && (
          <form action={merge}>
            <input type="hidden" name="a" value={patient.id} />
            <input type="hidden" name="b" value={other.id} />
            <Card title="Which record do you keep?" description="Pick one. The other is merged into it.">
              <fieldset>
                <legend className="sr-only">Which record do you keep?</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {card(patient, true, "This record")}
                  {card(other, false, "Duplicate")}
                </div>
              </fieldset>
              <div className="mt-5 rounded-lg border border-danger-line bg-danger-soft/50 px-4 py-3 text-sm leading-relaxed text-ink-2">
                Everything on the record not kept moves to the one kept, and that record is deleted.
                Consent follows the most recent consent decision on either record.
                A later message from the deleted record&rsquo;s number starts as a new contact.{" "}
                <strong className="font-semibold text-danger-ink">This cannot be undone.</strong>
              </div>
              <div className="mt-4 flex justify-end">
                <button className={btnDanger}>Merge records</button>
              </div>
            </Card>
          </form>
        )}
      </div>
    </section>
  );
}
