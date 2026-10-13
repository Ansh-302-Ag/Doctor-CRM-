import Link from "next/link";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { listEscalations, acknowledgeEscalation, resolveEscalation } from "@/lib/escalations";

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

  return (
    <section>
      <h1 className="text-lg font-semibold text-slate-900">Escalations</h1>
      <p className="mt-1 text-sm text-slate-500">
        Everything the assistant refused to answer. Reply to the patient directly, then close it here.
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Nothing waiting.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map(r => (
            <li key={r.id}
              className={`rounded-lg border bg-white p-4 ${
                r.priority === "emergency" && r.status !== "resolved"
                  ? "border-red-300 ring-1 ring-red-200" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {r.priority === "emergency" && (
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                    EMERGENCY
                  </span>
                )}
                <span className="font-medium text-slate-900">{r.patient_name ?? "Unknown patient"}</span>
                {r.consentWithdrawn && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    consent withdrawn
                  </span>
                )}
                <a href={`tel:${r.patient_phone}`} className="text-slate-500 underline">{r.patient_phone}</a>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{when(r.created_at)}</span>
                <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {r.status}{r.assigned_to_name ? ` · ${r.assigned_to_name}` : ""}
                </span>
              </div>

              {r.last_message && (
                <blockquote className="mt-3 border-l-2 border-slate-300 pl-3 text-slate-800">
                  {r.last_message}
                </blockquote>
              )}
              <p className="mt-2 text-xs text-slate-500">Escalated because: {r.reason}</p>

              {r.status !== "resolved" && (
                <div className="mt-3 flex gap-2">
                  {r.status === "open" && (
                    <form action={acknowledge}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                        I&rsquo;m handling this
                      </button>
                    </form>
                  )}
                  <form action={resolve}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                      Mark resolved
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
