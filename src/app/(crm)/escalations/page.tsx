import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Phone, TriangleAlert, Clock, CircleCheck, ChevronDown } from "lucide-react";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { listEscalations, acknowledgeEscalation, resolveEscalation, describeReason } from "@/lib/escalations";
import { Reveal } from "@/components/motion/reveal";
import { Avatar, Badge, Card, EmptyState, PageHeader, btnPrimary, btnSecondary, btnSm } from "../_ui";

type Row = Awaited<ReturnType<typeof listEscalations>>[number];

export default async function EscalationsPage() {
  const staff = await currentStaff();

  // The inbox is reception's desk, not the doctor's (docs/08). listEscalations
  // refuses him too — this is only so a doctor who follows an old bookmark gets
  // a sentence instead of a crash.
  if (!can(staff.role, "escalations:read")) {
    return (
      <section>
        <PageHeader title="Escalations" />
        <EmptyState title="Not available for your role">
          The front desk handles escalations; your day is under{" "}
          <Link href="/queue" className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
            My day
          </Link>.
        </EmptyState>
      </section>
    );
  }

  const rows = await listEscalations(
    sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId);

  async function acknowledge(form: FormData) {
    "use server";
    const me = await currentStaff();
    await acknowledgeEscalation(sql, { kind: "staff", id: me.id }, me.role,
      me.clinicId, String(form.get("id")), me.id);
    revalidatePath("/escalations");
  }

  async function resolve(form: FormData) {
    "use server";
    const me = await currentStaff();
    await resolveEscalation(sql, { kind: "staff", id: me.id }, me.role,
      me.clinicId, String(form.get("id")));
    revalidatePath("/escalations");
  }

  const when = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, dateStyle: "medium", timeStyle: "short",
  }).format(at);

  /** How long it has been sitting. On this screen that is the number the
   *  receptionist actually acts on; the clock time is the supporting detail. */
  // One clock reading per request (a server render), as the calendar does.
  const now = new Date();
  const ago = (at: Date) => {
    const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
    if (mins < 60) return `${mins} min`;
    const hours = Math.round(mins / 60);
    return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
  };

  // Urgency, not arrival order, decides what the eye lands on first.
  const emergencies = rows.filter(r => r.priority === "emergency" && r.status !== "resolved");
  const waiting = rows.filter(r => r.priority !== "emergency" && r.status !== "resolved");
  const resolved = rows.filter(r => r.status === "resolved");
  const open = emergencies.length + waiting.length;

  const actions = (r: Row) => (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
      {r.status === "open" && (
        <form action={acknowledge}>
          <input type="hidden" name="id" value={r.id} />
          <button className={`${btnPrimary} ${btnSm}`}>I&rsquo;m handling this</button>
        </form>
      )}
      <form action={resolve}>
        <input type="hidden" name="id" value={r.id} />
        <button className={`${r.status === "open" ? btnSecondary : btnPrimary} ${btnSm}`}>
          <CircleCheck aria-hidden="true" className="size-3.5" />
          Mark resolved
        </button>
      </form>
    </div>
  );

  const body = (r: Row) => {
    const why = describeReason(r.reason);
    return (
      <>
        {r.trigger_message && (
          <blockquote className="mt-4 max-w-3xl break-words rounded-r-lg border-l-2 border-line-strong bg-subtle px-3 py-2 text-sm text-ink">
            {r.trigger_message}
          </blockquote>
        )}
        <div className="mt-3 max-w-3xl text-xs text-ink-2">
          <Badge tone={why.tone}>{why.label}</Badge>
          <details className="group mt-2">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-ink-3 hover:text-ink">
              <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180" />
              Details
            </summary>
            <p className="mt-1 break-words">{why.detail}</p>
          </details>
        </div>
      </>
    );
  };

  return (
    <section className="space-y-6">
      <PageHeader
        title="Escalations"
        subtitle="Messages the assistant handed to a person. Contact the patient directly, then close it here."
        actions={
          <>
            <Badge tone={open > 0 ? "warn" : "ok"}>{open} waiting</Badge>
            <Badge tone={emergencies.length > 0 ? "danger" : "neutral"}>{emergencies.length} emergency</Badge>
          </>
        }
      />

      {open === 0 && (
        <EmptyState title="All caught up">
          Nothing waiting. When the assistant hands a conversation to a person, it appears here.
        </EmptyState>
      )}

      {emergencies.length > 0 && (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-danger">
            <TriangleAlert aria-hidden="true" className="size-5" />
            Medical emergency — call now ({emergencies.length})
          </h2>

          <Reveal as="ul" className="mt-3 space-y-4">
            {emergencies.map(r => (
              <li key={r.id} className="overflow-hidden rounded-xl border-2 border-danger bg-surface shadow-card">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-danger px-4 py-2 text-xs font-bold uppercase tracking-widest text-white">
                  Emergency
                  <span className="font-semibold normal-case tracking-normal">
                    waiting {ago(r.created_at)}
                  </span>
                  <span className="font-medium normal-case tracking-normal opacity-90">
                    raised {when(r.created_at)}
                  </span>
                  <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 font-semibold normal-case tracking-normal">
                    {r.status === "acknowledged" && r.assigned_to_name
                      ? `${r.assigned_to_name} is handling this`
                      : "Nobody has picked this up"}
                  </span>
                </p>

                <div className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={r.patient_name} size="lg" />
                      <p className="flex min-w-0 flex-wrap items-center gap-2 break-words text-lg font-semibold text-ink">
                        {r.patient_name ?? "Unknown patient"}
                        {r.consentWithdrawn && <Badge tone="warn">Consent withdrawn</Badge>}
                      </p>
                    </div>
                    <a
                      href={`tel:${r.patient_phone}`}
                      className="inline-flex items-center gap-2 rounded-lg bg-danger px-4 py-2.5 text-base font-semibold tabular-nums text-white shadow-card transition-colors hover:bg-danger-hover"
                    >
                      <Phone aria-hidden="true" className="size-4 shrink-0" />
                      Call {r.patient_phone}
                    </a>
                  </div>
                  {body(r)}
                  {actions(r)}
                </div>
              </li>
            ))}
          </Reveal>
        </div>
      )}

      {waiting.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Waiting ({waiting.length})
          </h2>
          <Reveal as="ul" className="mt-3 space-y-3">
            {waiting.map(r => (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={r.patient_name} />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 break-words font-semibold text-ink">
                          {r.patient_name ?? "Unknown patient"}
                          {r.consentWithdrawn && <Badge tone="warn">Consent withdrawn</Badge>}
                          <Badge tone={r.status === "open" ? "warn" : "neutral"}>
                            {r.status === "open"
                              ? "Open"
                              : `${r.assigned_to_name ?? "Staff"} is handling this`}
                          </Badge>
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                          <Clock aria-hidden="true" className="size-3.5" />
                          waiting {ago(r.created_at)} · {when(r.created_at)}
                        </p>
                      </div>
                    </div>
                    <a
                      href={`tel:${r.patient_phone}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-1.5 text-sm font-semibold tabular-nums text-accent-ink transition-colors hover:bg-accent hover:text-white"
                    >
                      <Phone aria-hidden="true" className="size-4 shrink-0" />
                      Call {r.patient_phone}
                    </a>
                  </div>
                  {body(r)}
                  {actions(r)}
                </Card>
              </li>
            ))}
          </Reveal>
        </div>
      )}

      {resolved.length > 0 && (
        // Closed items stay reachable but out of the way — native <details>,
        // no script.
        <details className="group rounded-xl border border-line bg-surface shadow-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink-2 hover:text-ink sm:px-5">
            <CircleCheck aria-hidden="true" className="size-4 text-ok" />
            Resolved ({resolved.length})
            <ChevronDown aria-hidden="true" className="ml-auto size-4 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {resolved.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-5">
                <Avatar name={r.patient_name} size="sm" />
                <span className="font-medium text-ink-2">{r.patient_name ?? "Unknown patient"}</span>
                <a href={`tel:${r.patient_phone}`} className="tabular-nums text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-accent">
                  {r.patient_phone}
                </a>
                <span className="min-w-0 break-words text-xs text-ink-3" title={r.reason}>{describeReason(r.reason).label}</span>
                <span className="ml-auto text-xs text-ink-3">
                  {r.resolved_at ? `Resolved ${when(r.resolved_at)}` : "Resolved"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
