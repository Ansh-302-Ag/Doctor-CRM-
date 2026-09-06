import Link from "next/link";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { listEscalations, acknowledgeEscalation, resolveEscalation } from "@/lib/escalations";
import { Badge, btnPrimary, btnSecondary } from "../_ui";

type Row = Awaited<ReturnType<typeof listEscalations>>[number];

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.2 3.5h2.6l1.3 3.4-1.7 1.3a11 11 0 0 0 5.4 5.4l1.3-1.7 3.4 1.3v2.6a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 4.2 5.7a2 2 0 0 1 2-2.2Z" />
  </svg>
);

export default async function EscalationsPage() {
  const staff = await currentStaff();

  // The inbox is reception's desk, not the doctor's (docs/08). listEscalations
  // refuses him too — this is only so a doctor who follows an old bookmark gets
  // a sentence instead of a crash.
  if (!can(staff.role, "escalations:read")) {
    return (
      <section>
        <h1 className="text-lg font-semibold text-slate-900">Escalations</h1>
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Not available for your role. The front desk handles escalations; your day is under{" "}
          <Link href="/queue" className="text-slate-600 underline hover:text-slate-900">My day</Link>.
        </p>
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
    dateStyle: "medium", timeStyle: "short",
  }).format(at);

  // Urgency, not arrival order, decides what the eye lands on first.
  const emergencies = rows.filter(r => r.priority === "emergency" && r.status !== "resolved");
  const waiting = rows.filter(r => r.priority !== "emergency" && r.status !== "resolved");
  const resolved = rows.filter(r => r.status === "resolved");

  const actions = (r: Row) => (
    <div className="mt-4 flex flex-wrap gap-2">
      {r.status === "open" && (
        <form action={acknowledge}>
          <input type="hidden" name="id" value={r.id} />
          <button className={btnSecondary}>I&rsquo;m handling this</button>
        </form>
      )}
      <form action={resolve}>
        <input type="hidden" name="id" value={r.id} />
        <button className={btnPrimary}>Mark resolved</button>
      </form>
    </div>
  );

  const body = (r: Row) => (
    <>
      {r.last_message && (
        <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-sm text-ink">
          {r.last_message}
        </blockquote>
      )}
      <p className="mt-3 text-xs text-ink-3">
        <span className="font-semibold text-ink-2">Escalated because:</span> {r.reason}
      </p>
    </>
  );

  return (
    <section>
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Escalations</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Everything the assistant refused to answer. Reply to the patient directly, then close it here.
        </p>
      </header>

      {rows.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center text-sm text-ink-3">
          Nothing waiting.
        </p>
      )}

      {emergencies.length > 0 && (
        <div className="mt-6">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-danger">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.6 4.1 2.9 17.4A1.6 1.6 0 0 0 4.3 19.8h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.1a1.6 1.6 0 0 0-2.8 0ZM12 9.2v4.1M12 16.6h.01" />
            </svg>
            Medical emergency — call now ({emergencies.length})
          </h2>

          <ul className="mt-3 space-y-4">
            {emergencies.map(r => (
              <li key={r.id} className="overflow-hidden rounded-lg border-2 border-danger bg-surface shadow-sm">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-danger px-4 py-2 text-xs font-bold uppercase tracking-widest text-white">
                  Emergency
                  <span className="font-medium normal-case tracking-normal opacity-90">
                    raised {when(r.created_at)}
                  </span>
                  <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 font-semibold normal-case tracking-normal">
                    {r.status === "acknowledged" && r.assigned_to_name
                      ? `${r.assigned_to_name} is handling this`
                      : "Nobody has picked this up"}
                  </span>
                </p>

                <div className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-lg font-semibold text-ink">
                      {r.patient_name ?? "Unknown patient"}
                    </p>
                    <a
                      href={`tel:${r.patient_phone}`}
                      className="inline-flex items-center gap-2 rounded-md bg-danger px-4 py-2.5 text-base font-semibold tabular-nums text-white transition-colors hover:bg-danger-hover"
                    >
                      <PhoneIcon />
                      Call {r.patient_phone}
                    </a>
                  </div>
                  {body(r)}
                  {actions(r)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            Waiting ({waiting.length})
          </h2>
          <ul className="mt-3 space-y-3">
            {waiting.map(r => (
              <li key={r.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{r.patient_name ?? "Unknown patient"}</span>
                    <Badge tone={r.status === "open" ? "warn" : "neutral"}>
                      {r.status === "open"
                        ? "Open"
                        : `Handled by ${r.assigned_to_name ?? "staff"}`}
                    </Badge>
                    <span className="text-xs text-ink-3">{when(r.created_at)}</span>
                  </div>
                  <a
                    href={`tel:${r.patient_phone}`}
                    className="inline-flex items-center gap-2 rounded-md border border-accent-line bg-accent-soft px-3 py-1.5 text-sm font-semibold tabular-nums text-accent-ink transition-colors hover:bg-accent hover:text-white"
                  >
                    <PhoneIcon />
                    Call {r.patient_phone}
                  </a>
                </div>
                {body(r)}
                {actions(r)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {resolved.length > 0 && (
        // Closed items stay reachable but out of the way — native <details>,
        // no script.
        <details className="mt-8 rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-2 hover:text-ink">
            Resolved ({resolved.length})
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {resolved.map(r => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="font-medium text-ink-2">{r.patient_name ?? "Unknown patient"}</span>
                <a href={`tel:${r.patient_phone}`} className="tabular-nums text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-accent">
                  {r.patient_phone}
                </a>
                <span className="text-xs text-ink-3">Escalated because: {r.reason}</span>
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
