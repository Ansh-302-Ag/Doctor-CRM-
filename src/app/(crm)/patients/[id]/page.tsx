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
import { addNote, NOTE_MAX } from "@/lib/notes";
import { completeTask, listTasks } from "@/lib/tasks";
import { isId, refusal } from "@/lib/desk";
import { TaskList } from "../../tasks/_list";
import {
  Alert, Avatar, Badge, Card, EmptyState, PageHeader, consentStatus, prescriptionStatus,
  btnPrimary, btnSecondary, btnSm, field, type Tone,
} from "../../_ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/lightswind/tabs";
import { Reveal } from "@/components/motion/reveal";
import { CountUp } from "@/components/lightswind/count-up";
import {
  CalendarDays, CalendarPlus, GitMerge, ListChecks, MessageCircle, Pill, ShieldCheck,
  StickyNote, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { HashTab, RepeatButton, RxForm } from "./_rx-form";

const PAGE = 50;

const KIND: Record<TimelineItem["kind"], { label: string; tone: Tone; icon: LucideIcon }> = {
  appointment: { label: "Appointment", tone: "accent", icon: CalendarDays },
  message: { label: "WhatsApp", tone: "neutral", icon: MessageCircle },
  escalation: { label: "Escalation", tone: "warn", icon: TriangleAlert },
  prescription: { label: "Prescription", tone: "ok", icon: Pill },
  consent: { label: "Consent", tone: "neutral", icon: ShieldCheck },
  note: { label: "Note", tone: "neutral", icon: StickyNote },
  task: { label: "Task", tone: "neutral", icon: ListChecks },
};

const DOT: Record<Tone, string> = {
  neutral: "bg-subtle text-ink-2 ring-line",
  accent: "bg-accent-soft text-accent-ink ring-accent-line",
  ok: "bg-ok-soft text-ok-ink ring-ok-line",
  warn: "bg-warn-soft text-warn-ink ring-warn-line",
  danger: "bg-danger-soft text-danger-ink ring-danger-line",
};

/** Which tab a returning ?error= belongs to. Note and task refusals come from
 *  src/lib/notes.ts / tasks.ts / rbac (DeskError, Forbidden); everything else
 *  that lands here is an InvalidPrescription from the prescribe form. */
const isDeskError = (e: string) => /^(note|task)\b|not found|staff only|not permitted/i.test(e);

/** A refused note or task comes back as ?error= on the record; anything else is a real fault. */
async function deskWrite(patientId: string, write: () => Promise<unknown>) {
  if (!isId(patientId)) notFound();
  try { await write(); } catch (e) {
    const error = refusal(e);
    if (error === null) throw e;
    redirect(`/patients/${patientId}?${new URLSearchParams({ error })}`);
  }
  revalidatePath(`/patients/${patientId}`);
}

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
  // Not a uuid: no such patient (the ::uuid casts below would otherwise 500).
  if (!isId(id)) notFound();

  // One round trip for the whole record. Every query below is scoped to this
  // clinic on its own — the timeline and the doctors list by clinic_id, the
  // prescriptions by a join back to patients — so none of them depends on the
  // existence check to stay safe, and the check can move after them. Neon is a
  // continent away; three sequential hops here were most of the page's latency.
  const canPrescribe = can(staff.role, "prescriptions:write");
  const [patient, timeline, prescriptions, doctors, tasks, drugNames] = await Promise.all([
    getPatient(sql, actor, staff.role, staff.clinicId, id, scope),
    getTimeline(sql, actor, staff.role, staff.clinicId, id, { before, limit: PAGE, doctorId: scope }),
    listPrescriptions(sql, actor, staff.role, staff.clinicId, id),
    // Only an admin has to say who prescribed: a doctor is the prescriber, and
    // currentStaff() now carries his doctor_id.
    isDoctor ? [] : sql<{ id: string; name: string }[]>`
      select id, name from doctors where clinic_id = ${staff.clinicId} order by name`,
    listTasks(sql, actor, staff.role, staff.clinicId, { patientId: id, open: true }, scope),
    // Suggestions for the drug name field: what this clinic has prescribed
    // before, most-used first. Names only — nothing about who they were for.
    canPrescribe ? sql<{ drug_name: string }[]>`
      select p.drug_name from prescriptions p
        join patients pt on pt.id = p.patient_id
       where pt.clinic_id = ${staff.clinicId}
       group by p.drug_name order by count(*) desc, p.drug_name limit 200` : [],
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

  async function note(form: FormData) {
    "use server";
    const me = await currentStaff();
    const patientId = String(form.get("patientId"));
    // addNote re-checks the patient under this staff member's own scope.
    await deskWrite(patientId, () => addNote(sql, { kind: "staff", id: me.id }, me.role,
      me.clinicId, patientId, String(form.get("body") ?? ""), patientScope(me)));
  }

  async function taskDone(form: FormData) {
    "use server";
    const me = await currentStaff();
    // The record the list is on: the task itself is checked against the clinic.
    await deskWrite(id, () => completeTask(sql, { kind: "staff", id: me.id }, me.role,
      me.clinicId, String(form.get("taskId")), patientScope(me)));
    revalidatePath("/tasks");
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
  const canWrite = can(staff.role, "patients:write");
  const active = rx.filter(p => p.status === "active");
  const past = rx.filter(p => p.status !== "active");
  // A message that came back from a form opens on the tab that form lives on.
  const tab = sent ? "rx" : error ? (isDeskError(error) ? "notes" : "rx") : "timeline";

  const rxRow = (p: (typeof rx)[number]) => {
    const status = prescriptionStatus(p.status);
    return (
      <li key={p.id} className="p-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${DOT[p.status === "active" ? "ok" : "neutral"]}`}
          >
            <Pill className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="min-w-0 break-words font-semibold text-ink">{p.drug_name}</span>
              <span className="ml-auto"><Badge tone={status.tone}>{status.label}</Badge></span>
            </div>
            <p className="mt-0.5 break-words text-sm text-ink-2">
              {p.dosage}
              {p.duration_days !== null && (
                <span className="text-ink-3"> · for {p.duration_days} day{p.duration_days === 1 ? "" : "s"}</span>
              )}
            </p>
            {p.notes && <p className="mt-1.5 break-words text-sm text-ink">{p.notes}</p>}
            <p className="mt-1.5 text-xs text-ink-3">
              {p.doctor_name} · recorded by {p.created_by_name} · {when(p.created_at)}
            </p>
            {canPrescribe && (
              <div className="mt-3 flex flex-wrap gap-2">
                <RepeatButton
                  rx={{ drugName: p.drug_name, dosage: p.dosage, durationDays: p.duration_days, notes: p.notes }}
                />
                {p.status === "active" && (
                  <form action={discontinue}>
                    <input type="hidden" name="patientId" value={patient.id} />
                    <input type="hidden" name="prescriptionId" value={p.id} />
                    <button className={`${btnSecondary} ${btnSm}`}>Discontinue</button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </li>
    );
  };

  const group = (label: string, rows: typeof rx) => rows.length > 0 && (
    <div>
      <h3 className="border-b border-line bg-subtle px-4 py-2 text-xs font-semibold tracking-wide text-ink-3 sm:px-5">
        {label} <span className="tabular-nums">({rows.length})</span>
      </h3>
      <Reveal as="ul" className="divide-y divide-line">{rows.map(rxRow)}</Reveal>
    </div>
  );

  return (
    <section>
      <HashTab />
      <PageHeader
        back={{ href: "/patients", label: isDoctor ? "My patients" : "All patients" }}
        title={
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={patient.name} size="lg" />
            <span className="min-w-0 break-words">{patient.name ?? "Unnamed patient"}</span>
          </span>
        }
        subtitle={
          <a
            href={`tel:${patient.phone}`}
            className="tabular-nums text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent"
          >
            {patient.phone}
          </a>
        }
        actions={<>
          {can(staff.role, "appointments:write") && (
            <Link href={`/appointments/new?patient=${patient.id}`} className={btnPrimary}>
              <CalendarPlus aria-hidden className="size-4" /> Book appointment
            </Link>
          )}
          {can(staff.role, "patients:merge") && (
            <Link href={`/patients/${patient.id}/merge`} className={btnSecondary}>
              <GitMerge aria-hidden className="size-4" /> Merge with another record
            </Link>
          )}
        </>}
      />

      <Reveal className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="text-xs font-semibold tracking-wide text-ink-3">Consent</p>
          <p className="mt-2"><Badge tone={consent.tone}>{consent.label}</Badge></p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="text-xs font-semibold tracking-wide text-ink-3">Next appointment</p>
          <p className="mt-2 text-sm font-semibold tabular-nums text-ink">
            {patient.next_appointment ? when(patient.next_appointment) : "None booked"}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-3">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" /> Active prescriptions
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink"><CountUp value={patient.active_prescriptions} /></p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-3">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" /> Open tasks
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink"><CountUp value={tasks.length} /></p>
        </div>
      </Reveal>

      <div className="mt-4 space-y-3 empty:hidden">
        {error && <Alert tone="danger">{error}</Alert>}
        {sent === "1" && (
          <Alert tone="ok">Prescription saved and sent to the patient on WhatsApp.</Alert>
        )}
        {sent === "outside_window" && (
          <Alert tone="warn">
            <span className="font-semibold">Saved, but not delivered.</span>{" "}
            <span className="font-normal">
              WhatsApp only allows us to message a patient within 24 hours of their own last message.{" "}
              {nudged
                ? "They have been sent a note asking them to reply, and the assistant will read this " +
                  "record back to them when they do. Call them if it cannot wait."
                : "We could not reach them at all — please call them."}
            </span>
          </Alert>
        )}
        {sent === "send_failed" && (
          <Alert tone="warn">
            <span className="font-semibold">Saved, but not delivered.</span>{" "}
            <span className="font-normal">
              WhatsApp would not accept the message. Nothing was lost — the record below is on file.
              Please tell the patient another way.
            </span>
          </Alert>
        )}
      </div>

      <Tabs defaultValue={tab} className="mt-6">
        <TabsList label="Patient record sections" className="w-fit">
          <TabsTrigger value="timeline"><CalendarDays aria-hidden className="hidden size-4 sm:block" /> Timeline</TabsTrigger>
          <TabsTrigger value="rx">
            <Pill aria-hidden className="hidden size-4 sm:block" /> Prescriptions
            {active.length > 0 && (
              <span className="rounded-full bg-ok-soft px-1.5 text-xs font-semibold tabular-nums text-ok-ink">{active.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="notes">
            <StickyNote aria-hidden className="hidden size-4 sm:block" /> Notes &amp; tasks
            {tasks.length > 0 && (
              <span className="rounded-full bg-warn-soft px-1.5 text-xs font-semibold tabular-nums text-warn-ink">{tasks.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <Card id="timeline" title="Activity" description="Appointments, messages, prescriptions, consent, notes and tasks, newest first." bodyClassName="">
            {timeline.length === 0 ? (
              <div className="p-4 sm:p-5">
                <EmptyState title={before ? "Nothing older on record." : "Nothing on record yet."} />
              </div>
            ) : (
              <Reveal as="ol" step={20} className="px-4 py-2 sm:px-5">
                {timeline.map((t, i) => {
                  const kind = KIND[t.kind];
                  const Icon = kind.icon;
                  const by = t.byName ?? (t.by ? BY[t.by] : null);
                  return (
                    <li key={`${t.refId}-${i}`} className="relative flex gap-3 py-3">
                      {/* The rail joining one event to the next. */}
                      {i < timeline.length - 1 && (
                        <span aria-hidden="true" className="absolute top-12 bottom-0 left-4 w-px -translate-x-1/2 bg-line" />
                      )}
                      <span
                        aria-hidden="true"
                        className={`relative grid size-8 shrink-0 place-items-center rounded-full ring-1 ${DOT[kind.tone]}`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                          <span className="font-semibold text-ink-2">{kind.label}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={t.at.toISOString()} className="tabular-nums">{when(t.at)}</time>
                          {by && <span>· {by}</span>}
                        </div>
                        <p className="mt-1 break-words text-sm text-ink">{t.title}</p>
                        {t.detail && (t.kind === "message" ? (
                          <details className="mt-1 text-sm text-ink-2">
                            <summary className="cursor-pointer text-xs font-medium text-accent hover:text-accent-hover">Full message</summary>
                            <p className="mt-1.5 whitespace-pre-wrap break-words rounded-lg bg-subtle px-3 py-2">{t.detail}</p>
                          </details>
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2">{t.detail}</p>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </Reveal>
            )}
            {(before || timeline.length >= PAGE) && (
              <div className="flex flex-wrap gap-3 border-t border-line px-4 py-3 sm:px-5">
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
          </Card>
        </TabsContent>

        <TabsContent value="rx">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            <Card
              id="prescriptions"
              title="Prescriptions"
              description="Stored exactly as entered. The assistant reads these back to the patient verbatim and never interprets them."
              bodyClassName=""
              className="min-w-0 overflow-hidden"
            >
              {rx.length === 0 ? (
                <div className="p-4 sm:p-5"><EmptyState title="No prescriptions on record." /></div>
              ) : (
                <>
                  {group("Active", active)}
                  {group("Past", past)}
                </>
              )}
            </Card>

            {/* First on a phone: entering a medicine is what the doctor opens this tab for. */}
            <div className="order-first min-w-0 lg:order-none lg:self-start">
              {canPrescribe ? (
                <RxForm
                  action={addPrescription}
                  patientId={patient.id}
                  doctors={doctors}
                  isDoctor={isDoctor}
                  drugNames={drugNames.map(d => d.drug_name)}
                />
              ) : (
                <p className="rounded-xl border border-dashed border-line-strong bg-surface p-4 text-sm text-ink-3">
                  Only a doctor or admin can prescribe. Everything on file is shown on this page.
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notes">
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {canWrite && (
              <form action={note} id="notes" className="min-w-0 self-start rounded-xl border border-line bg-surface shadow-card">
                <input type="hidden" name="patientId" value={patient.id} />
                <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink sm:px-5">Add note</h2>
                <div className="space-y-3 p-4 sm:p-5">
                  <label htmlFor="body" className="sr-only">Note</label>
                  <textarea id="body" name="body" rows={4} required maxLength={NOTE_MAX} className={field} />
                  <p className="text-xs text-ink-3">Visible to all staff who can see this patient. Notes cannot be edited later.</p>
                  <button className={btnPrimary}>Save note</button>
                </div>
              </form>
            )}

            {/* TaskList is its own card; only a heading row sits above it. */}
            <section id="tasks" className="min-w-0 self-start">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">Open tasks</h2>
                <Link href={`/tasks?patient=${patient.id}`} className={`${btnSecondary} ${btnSm}`}>
                  New task
                </Link>
              </div>
              <TaskList tasks={tasks} done={taskDone} empty="No open tasks for this patient." showPatient={false} />
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
