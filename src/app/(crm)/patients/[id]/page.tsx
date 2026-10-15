import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { getPatient, patientScope } from "@/lib/patients";
import { getTimeline, type TimelineItem } from "@/lib/timeline";
import { listPrescriptions, discontinuePrescription, InvalidPrescription } from "@/lib/prescriptions";
import { prescribeAndNotify, NotYourPatient } from "@/lib/doctor";
import {
  Badge, consentStatus, prescriptionStatus, btnPrimary, btnSecondary, type Tone,
} from "../../_ui";

const field = "mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink";
const fieldLabel = "block text-xs font-semibold uppercase tracking-wide text-ink-3";
const notice = "mt-4 rounded-md border px-3.5 py-2.5 text-sm";
const PAGE = 50;

const KIND: Record<TimelineItem["kind"], { label: string; tone: Tone }> = {
  appointment: { label: "Appointment", tone: "accent" },
  message: { label: "WhatsApp", tone: "neutral" },
  escalation: { label: "Escalation", tone: "warn" },
  prescription: { label: "Prescription", tone: "ok" },
  consent: { label: "Consent", tone: "neutral" },
  note: { label: "Note", tone: "neutral" },
  task: { label: "Task", tone: "neutral" },
};

const BY = { agent: "AI assistant", patient: "Patient", staff: "Staff" } as const;

export default async function PatientRecordPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; sent?: string; nudged?: string; before?: string }>;
}) {
  const staff = await currentStaff();
  const { id } = await params;
  const { error, sent, nudged, before: beforeRaw } = await searchParams;
  // "Show older" carries the oldest instant shown; anything unparseable is ignored.
  const beforeAt = typeof beforeRaw === "string" ? new Date(beforeRaw) : null;
  const before = beforeAt && !isNaN(beforeAt.getTime()) ? beforeAt : undefined;
  const actor = { kind: "staff" as const, id: staff.id };
  const isDoctor = staff.role === "doctor";
  // A doctor may only open one of his own patients (docs/08).
  const scope = patientScope(staff);

  // One round trip for the whole record. Every query below is scoped to this
  // clinic on its own — the timeline and the doctors list by clinic_id, the
  // prescriptions by a join back to patients — so none of them depends on the
  // existence check to stay safe, and the check can move after them. Neon is a
  // continent away; three sequential hops here were most of the page's latency.
  const [patient, timeline, prescriptions, doctors] = await Promise.all([
    getPatient(sql, actor, staff.role, staff.clinicId, id, scope),
    getTimeline(sql, actor, staff.role, staff.clinicId, id, { before, limit: PAGE, doctorId: scope }),
    listPrescriptions(sql, actor, staff.role, staff.clinicId, id),
    // Only an admin has to say who prescribed: a doctor is the prescriber, and
    // currentStaff() now carries his doctor_id.
    isDoctor ? [] : sql<{ id: string; name: string }[]>`
      select id, name from doctors where clinic_id = ${staff.clinicId} order by name`,
  ]);
  if (!patient) notFound();

  async function addPrescription(form: FormData) {
    "use server";
    const me = await currentStaff();
    const patientId = String(form.get("patientId"));
    const durationRaw = String(form.get("durationDays") ?? "").trim();

    // prescribeAndNotify re-resolves the patient under this staff member's own
    // scope before writing: the hidden field is not proof of anything (docs/08).
    let delivery;
    try {
      ({ delivery } = await prescribeAndNotify(sql, me, {
        patientId,
        doctorId: String(form.get("doctorId") ?? ""),
        drugName: String(form.get("drugName") ?? ""),
        dosage: String(form.get("dosage") ?? ""),
        durationDays: durationRaw ? Number(durationRaw) : undefined,
        notes: String(form.get("notes") ?? "") || undefined,
      }));
    } catch (e) {
      if (e instanceof NotYourPatient) notFound();
      if (e instanceof InvalidPrescription) {
        redirect(`/patients/${patientId}?error=${encodeURIComponent(e.message)}`);
      }
      throw e;
    }
    // The record is saved either way; the redirect only says what reached the
    // patient, so an undelivered message is never silent.
    revalidatePath(`/patients/${patientId}`);
    redirect(`/patients/${patientId}?sent=${delivery.delivered ? "1" : delivery.reason}` +
             (delivery.nudged ? "&nudged=1" : ""));
  }

  async function discontinue(form: FormData) {
    "use server";
    const me = await currentStaff();
    const meActor = { kind: "staff" as const, id: me.id };
    const patientId = String(form.get("patientId"));
    const prescriptionId = String(form.get("prescriptionId"));

    // Ownership check: discontinuePrescription trusts the id it's given, so we
    // must confirm both that the patient belongs to this clinic and that the
    // prescription actually belongs to that patient, before calling it (docs/08).
    const patient = await getPatient(
      sql, meActor, me.role, me.clinicId, patientId, patientScope(me));
    if (!patient) notFound();
    const existing = await listPrescriptions(sql, meActor, me.role, me.clinicId, patientId);
    if (!existing.some(p => p.id === prescriptionId)) notFound();

    await discontinuePrescription(sql, meActor, me.role, me.clinicId, prescriptionId);
    revalidatePath(`/patients/${patientId}`);
  }

  // The clinic's own clock, not the server's — an appointment time read an hour
  // out is worse than useless to the doctor reading it.
  const when = (at: Date) => new Intl.DateTimeFormat("en-GB", {
    timeZone: staff.timezone, dateStyle: "medium", timeStyle: "short",
  }).format(at);

  // Active first. "What is this patient on right now" is the question this list
  // is opened to answer, and a long record buries it under closed rows. Stable,
  // so each group keeps the query's newest-first order.
  const rx = [...prescriptions].sort(
    (a, b) => Number(b.status === "active") - Number(a.status === "active"));

  const consent = consentStatus(patient.consent_status);
  const canPrescribe = can(staff.role, "prescriptions:write");

  return (
    <section>
      <Link
        href="/patients"
        className="inline-flex items-center gap-1.5 text-sm text-ink-3 transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 5.5 8 12l6.5 6.5" />
        </svg>
        {isDoctor ? "My patients" : "All patients"}
      </Link>

      <header className="mt-3 rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight break-words text-ink">
              {patient.name ?? "Unnamed patient"}
            </h1>
            <a
              href={`tel:${patient.phone}`}
              className="mt-1 inline-block tabular-nums text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent"
            >
              {patient.phone}
            </a>
          </div>

          <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className={fieldLabel}>Consent</dt>
              <dd className="mt-1.5"><Badge tone={consent.tone}>{consent.label}</Badge></dd>
            </div>
            <div>
              <dt className={fieldLabel}>Next appointment</dt>
              <dd className="mt-1.5 tabular-nums text-ink">
                {patient.next_appointment ? when(patient.next_appointment) : "None booked"}
              </dd>
            </div>
            <div>
              <dt className={fieldLabel}>Active prescriptions</dt>
              <dd className="mt-1.5 tabular-nums text-ink">{patient.active_prescriptions}</dd>
            </div>
          </dl>
        </div>
      </header>

      {error && (
        <p role="alert" className={`${notice} border-danger-line bg-danger-soft font-medium text-danger-ink`}>
          {error}
        </p>
      )}

      {sent === "1" && (
        <p role="status" className={`${notice} border-ok-line bg-ok-soft text-ok-ink`}>
          Prescription saved and sent to the patient on WhatsApp.
        </p>
      )}
      {sent === "outside_window" && (
        <p role="status" className={`${notice} border-warn-line bg-warn-soft text-warn-ink`}>
          <span className="font-semibold">Saved, but not delivered.</span>{" "}
          WhatsApp only allows us to message a patient within 24 hours of their own last message.{" "}
          {nudged
            ? "They have been sent a note asking them to reply, and the assistant will read this " +
              "record back to them when they do. Call them if it cannot wait."
            : "We could not reach them at all — please call them."}
        </p>
      )}
      {sent === "send_failed" && (
        <p role="status" className={`${notice} border-warn-line bg-warn-soft text-warn-ink`}>
          <span className="font-semibold">Saved, but not delivered.</span>{" "}
          WhatsApp would not accept the message. Nothing was lost — the record below is on file.
          Please tell the patient another way.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Timeline</h2>
            {timeline.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-3">
                {before ? "Nothing older on record." : "Nothing on record yet."}
              </p>
            ) : (
              <ol className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
                {timeline.map((t, i) => {
                  const kind = KIND[t.kind];
                  const by = t.byName ?? (t.by ? BY[t.by] : null);
                  return (
                    <li key={`${t.refId}-${i}`} className="p-4">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                        <Badge tone={kind.tone}>{kind.label}</Badge>
                        <time dateTime={t.at.toISOString()} className="tabular-nums">{when(t.at)}</time>
                        {by && <span>· {by}</span>}
                      </div>
                      <p className="mt-1.5 break-words text-sm text-ink">{t.title}</p>
                      {t.detail && (t.kind === "message" ? (
                        <details className="mt-1 text-sm text-ink-2">
                          <summary className="cursor-pointer text-xs text-ink-3">Full message</summary>
                          <p className="mt-1 whitespace-pre-wrap break-words">{t.detail}</p>
                        </details>
                      ) : (
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2">{t.detail}</p>
                      ))}
                    </li>
                  );
                })}
              </ol>
            )}
            {(before || timeline.length >= PAGE) && (
              <div className="mt-3 flex gap-3">
                {before && <Link href={`/patients/${patient.id}`} className={btnSecondary}>Newest</Link>}
                {timeline.length >= PAGE && (
                  <Link
                    href={`/patients/${patient.id}?before=${encodeURIComponent(timeline.at(-1)!.at.toISOString())}`}
                    className={btnSecondary}
                  >
                    Show older
                  </Link>
                )}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Prescriptions</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">
              Stored exactly as entered. The assistant reads these back to the patient verbatim and never interprets them.
            </p>

            {rx.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-line-strong bg-surface p-8 text-center text-sm text-ink-3">
                No prescriptions on record.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {rx.map(p => {
                  const status = prescriptionStatus(p.status);
                  return (
                    <li
                      key={p.id}
                      className={`rounded-lg border bg-surface p-4 ${
                        p.status === "active" ? "border-l-4 border-line border-l-ok" : "border-line"
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="min-w-0 break-words text-base font-semibold text-ink">{p.drug_name}</span>
                        <span className="min-w-0 break-words text-sm text-ink-2">{p.dosage}</span>
                        {p.duration_days !== null && (
                          <span className="text-sm text-ink-3">
                            for {p.duration_days} day{p.duration_days === 1 ? "" : "s"}
                          </span>
                        )}
                        <span className="ml-auto"><Badge tone={status.tone}>{status.label}</Badge></span>
                      </div>
                      <p className="mt-1.5 text-xs text-ink-3">
                        {p.doctor_name} · recorded by {p.created_by_name} · {when(p.created_at)}
                      </p>
                      {p.notes && <p className="mt-2 break-words text-sm text-ink">{p.notes}</p>}
                      {p.status === "active" && canPrescribe && (
                        <form action={discontinue} className="mt-3">
                          <input type="hidden" name="patientId" value={patient.id} />
                          <input type="hidden" name="prescriptionId" value={p.id} />
                          <button className={btnSecondary}>Discontinue</button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          {canPrescribe ? (
            <form action={addPrescription} className="rounded-lg border border-line bg-surface">
              <input type="hidden" name="patientId" value={patient.id} />
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
                Add prescription
              </h2>
              <div className="space-y-4 p-4">
                {!isDoctor && (
                  <div>
                    <label htmlFor="doctorId" className={fieldLabel}>Doctor</label>
                    <select id="doctorId" name="doctorId" required className={field}>
                      {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor="drugName" className={fieldLabel}>Drug name</label>
                  <input id="drugName" name="drugName" required autoComplete="off" className={field} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="dosage" className={fieldLabel}>Dosage</label>
                    <input id="dosage" name="dosage" required autoComplete="off" placeholder="1 tablet twice daily" className={field} />
                  </div>
                  <div>
                    <label htmlFor="durationDays" className={fieldLabel}>Duration (days)</label>
                    <input id="durationDays" name="durationDays" type="number" min={1} inputMode="numeric" className={field} />
                  </div>
                </div>
                <div>
                  <label htmlFor="notes" className={fieldLabel}>Notes</label>
                  <textarea id="notes" name="notes" rows={3} className={field} />
                </div>
                <p className="text-xs leading-relaxed text-ink-3">
                  Saved exactly as typed, attributed to {isDoctor ? "you" : "the doctor named above"},
                  and sent to the patient on WhatsApp as written.
                </p>
                <button className={`${btnPrimary} w-full`}>Save &amp; send to patient</button>
              </div>
            </form>
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong bg-surface p-4 text-sm text-ink-3">
              Only a doctor or admin can add to this record. Everything on file is shown on this page.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
