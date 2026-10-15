import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { getPatient, patientScope } from "@/lib/patients";
import { createTask, completeTask, listTasks, TITLE_MAX } from "@/lib/tasks";
import { isId, refusal } from "@/lib/desk";
import { ListChecks, Plus } from "lucide-react";
import { Alert, Avatar, Badge, Card, PageHeader, btnPrimary, field, fieldLabel } from "../_ui";
import { TaskList } from "./_list";

const heading = "mb-2 text-xs font-semibold tracking-wide text-ink-3";

/** Run a desk write; a refusal comes back as ?error= on `back`, anything else is a real fault. */
async function attempt(back: string, write: () => Promise<unknown>) {
  try { await write(); } catch (e) {
    const error = refusal(e);
    if (error === null) throw e;
    redirect(`${back}${back.includes("?") ? "&" : "?"}${new URLSearchParams({ error })}`);
  }
}

export default async function TasksPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; patient?: string }> }) {
  const staff = await currentStaff();
  const { error, patient: patientRaw } = await searchParams;
  const actor = { kind: "staff" as const, id: staff.id };
  const scope = patientScope(staff);
  const patientId = patientRaw && isId(patientRaw) ? patientRaw : null;

  const [mine, open, team, patient] = await Promise.all([
    listTasks(sql, actor, staff.role, staff.clinicId, { assignedTo: staff.id, open: true }, scope),
    listTasks(sql, actor, staff.role, staff.clinicId, { open: true }, scope),
    sql<{ id: string; name: string }[]>`
      select id, name from staff_users where clinic_id = ${staff.clinicId} order by name`,
    // ?patient= comes from the patient page's "New task" link; it is only used
    // if this staff member may see that patient.
    patientId ? getPatient(sql, actor, staff.role, staff.clinicId, patientId, scope) : null,
  ]);

  async function create(form: FormData) {
    "use server";
    const me = await currentStaff();
    const pid = String(form.get("patientId") ?? "") || null;
    await attempt(pid ? `/tasks?patient=${encodeURIComponent(pid)}` : "/tasks", () =>
      createTask(sql, { kind: "staff", id: me.id }, me.role, me.clinicId, {
        title: String(form.get("title") ?? ""),
        dueOn: String(form.get("dueOn") ?? ""),
        assignedTo: String(form.get("assignedTo") ?? ""),
        patientId: pid,
      }, patientScope(me)));
    revalidatePath("/tasks");
    // Back to the record the task was raised from, where it now shows.
    if (pid) {
      revalidatePath(`/patients/${pid}`);
      redirect(`/patients/${pid}`);
    }
    redirect("/tasks");
  }

  async function done(form: FormData) {
    "use server";
    const me = await currentStaff();
    await attempt("/tasks", () => completeTask(sql, { kind: "staff", id: me.id }, me.role,
      me.clinicId, String(form.get("taskId")), patientScope(me)));
    revalidatePath("/tasks");
  }

  const overdue = open.filter(t => t.overdue).length;

  return (
    <section className="space-y-6">
      <PageHeader
        icon={ListChecks}
        title="Tasks"
        subtitle={
          <>
            <Badge tone="accent">{open.length} open</Badge>
            {overdue > 0 && <Badge tone="warn">{overdue} overdue</Badge>}
            <span className="text-ink-3">{mine.length} assigned to you</span>
          </>
        }
      />

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <div>
            <h2 className={heading}>Assigned to me</h2>
            <TaskList tasks={mine} done={done} empty="Nothing assigned to you." />
          </div>
          <div>
            <h2 className={heading}>All open</h2>
            <TaskList tasks={open} done={done} empty="No open tasks." />
          </div>
        </div>

        <Card icon={Plus} title="New task" description="A follow-up for someone at the clinic." className="self-start lg:sticky lg:top-6">
          <form action={create} className="space-y-4">
            {patient && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-accent-line bg-accent-soft/60 px-3 py-2 text-sm text-ink-2">
                <input type="hidden" name="patientId" value={patient.id} />
                <Avatar name={patient.name} size="sm" />
                <span>For</span>
                <Link href={`/patients/${patient.id}`} className="font-medium text-accent-ink hover:underline">
                  {patient.name ?? "Unnamed patient"}
                </Link>
                <Link href="/tasks" className="ml-auto text-xs text-ink-3 underline underline-offset-2 hover:text-ink">general task instead</Link>
              </div>
            )}
            <div>
              <label htmlFor="title" className={fieldLabel}>Task</label>
              <input id="title" name="title" required maxLength={TITLE_MAX} autoComplete="off" className={field} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label htmlFor="dueOn" className={fieldLabel}>Due</label>
                <input id="dueOn" name="dueOn" type="date" className={field} />
              </div>
              <div className="min-w-0">
                <label htmlFor="assignedTo" className={fieldLabel}>Assign to</label>
                <select id="assignedTo" name="assignedTo" defaultValue={staff.id} className={field}>
                  <option value="">Unassigned</option>
                  {team.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <button className={`${btnPrimary} w-full`}>
              <Plus className="size-4" aria-hidden="true" /> Add task
            </button>
          </form>
        </Card>
      </div>
    </section>
  );
}
