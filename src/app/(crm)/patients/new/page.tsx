import { MessageSquareQuote, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/session";
import { sql, type Db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { CONSENT_NOTICE } from "@/lib/consent";
import { registerPatient, refusal } from "@/lib/desk";
import { patientScope } from "@/lib/patients";
import { Alert, Card, PageHeader, btnPrimary, field, fieldLabel } from "../../_ui";

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
      // A doctor's known-number lookup stays inside his own patients (desk.ts).
      registerPatient(db, { kind: "staff", id: me.id }, me.role, me.clinicId, input, patientScope(me));

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
    <section className="mx-auto max-w-xl">
      <PageHeader
        icon={UserPlus}
        back={{ href: "/", label: "Calendar" }}
        title="Register walk-in"
        subtitle="New patients get a record, then go straight to booking. A number the clinic already knows opens that patient instead."
      />

      {error && <Alert className="mb-4">{error}</Alert>}

      <Card icon={UserPlus} title="Patient details" description="Name and phone as the patient gives them.">
        <form action={register} className="space-y-5">
          <div>
            <label htmlFor="name" className={fieldLabel}>Name</label>
            <input id="name" name="name" required autoComplete="off" className={field} />
          </div>
          <div>
            <label htmlFor="phone" className={fieldLabel}>Phone</label>
            <input id="phone" name="phone" type="tel" required autoComplete="off" placeholder="98765 43210" className={`${field} tabular-nums`} />
          </div>

          <fieldset className="rounded-xl border border-accent-line bg-accent-soft/60 p-4">
            <legend className="sr-only">Consent</legend>
            <p className="flex items-center gap-2 text-sm font-semibold text-accent-ink">
              <MessageSquareQuote className="size-4" aria-hidden="true" />
              Read this to the patient
            </p>
            {/* The WhatsApp notice ends "Reply YES"; at the desk they say it. */}
            <p id="consent-notice" className="mt-2 text-sm leading-relaxed text-ink">
              {CONSENT_NOTICE.replace(/ Reply YES to agree\.$/, "")}
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-accent-line bg-surface px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent">
              <input
                type="checkbox" name="consent" value="yes" required
                aria-describedby="consent-notice"
                className="size-4 accent-accent"
              />
              The patient agreed
            </label>
          </fieldset>

          <button className={`${btnPrimary} w-full`}>Register and book</button>
        </form>
      </Card>
    </section>
  );
}
