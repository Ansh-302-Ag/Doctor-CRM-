import Link from "next/link";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/session";
import { sql, type Db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { CONSENT_NOTICE } from "@/lib/consent";
import { registerPatient, refusal } from "@/lib/desk";
import { btnPrimary } from "../../_ui";

const field = "mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink";
const fieldLabel = "block text-xs font-semibold uppercase tracking-wide text-ink-3";

/** Register a walk-in, then go straight to booking them. A number the clinic
 *  already knows opens that patient instead of making a second record. */
export default async function NewPatientPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const staff = await currentStaff();
  requirePermission(staff.role, "patients:write");
  const { error } = await searchParams;

  async function register(form: FormData) {
    "use server";
    const me = await currentStaff();
    const input = {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      consent: form.get("consent") === "yes",
    };
    const run = (db: Db) =>
      registerPatient(db, { kind: "staff", id: me.id }, me.role, me.clinicId, input);

    let result: { id: string; existing: boolean } | null = null;
    let error: string | null = null;
    try {
      try {
        result = await sql.begin(tx => run(tx)) as { id: string; existing: boolean };
      } catch (e) {
        // 23505: another desk registered the same number a moment ago. Running
        // again finds their record and opens it.
        if ((e as { code?: string }).code !== "23505") throw e;
        result = await run(sql);
      }
    } catch (e) {
      error = refusal(e);
      if (error === null) throw e;
    }
    if (!result) redirect(`/patients/new?${new URLSearchParams({ error: error ?? "" })}`);
    redirect(`/appointments/new?patient=${result.id}${result.existing ? "&existing=1" : ""}`);
  }

  return (
    <section className="max-w-xl">
      <Link href="/" className="text-sm text-ink-3 transition-colors hover:text-ink">
        &larr; Calendar
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Register walk-in</h1>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger-ink">
          {error}
        </p>
      )}

      <form action={register} className="mt-4 space-y-4 rounded-lg border border-line bg-surface p-4">
        <div>
          <label htmlFor="name" className={fieldLabel}>Name</label>
          <input id="name" name="name" required autoComplete="off" className={field} />
        </div>
        <div>
          <label htmlFor="phone" className={fieldLabel}>Phone</label>
          <input id="phone" name="phone" type="tel" required autoComplete="off" placeholder="98765 43210" className={field} />
        </div>
        <div className="rounded-md border border-line bg-subtle p-3 text-sm text-ink-2">
          <p className="font-medium text-ink">Read this to the patient:</p>
          {/* The WhatsApp notice ends "Reply YES"; at the desk they say it. */}
          <p className="mt-1">{CONSENT_NOTICE.replace(/ Reply YES to agree\.$/, "")}</p>
          <label className="mt-3 flex items-center gap-2 font-medium text-ink">
            <input type="checkbox" name="consent" value="yes" required />
            The patient agreed
          </label>
        </div>
        <button className={`${btnPrimary} w-full`}>Register and book</button>
      </form>
    </section>
  );
}
