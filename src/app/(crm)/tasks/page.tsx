import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { getPatient, patientScope } from "@/lib/patients";
import { createTask, completeTask, listTasks, TITLE_MAX } from "@/lib/tasks";
import { isId, refusal } from "@/lib/desk";
import { btnPrimary } from "../_ui";
import { TaskList } from "./_list";

const field = "mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink";
const fieldLabel = "block text-xs font-semibold uppercase tracking-wide text-ink-3";
const heading = "text-sm font-semibold uppercase tracking-wide text-ink-3";

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

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Tasks</h1>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger-ink">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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

        <form action={create} className="self-start rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">New task</h2>
          <div className="space-y-4 p-4">
            {patient && (
              <p className="text-sm text-ink-2">
                <input type="hidden" name="patientId" value={patient.id} />
                For{" "}
                <Link href={`/patients/${patient.id}`} className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
                  {patient.name ?? "Unnamed patient"}
                </Link>{" "}
                · <Link href="/tasks" className="text-ink-3 underline underline-offset-2 hover:text-ink">general task instead</Link>
              </p>
            )}
            <div>
              <label htmlFor="title" className={fieldLabel}>Task</label>
              <input id="title" name="title" required maxLength={TITLE_MAX} autoComplete="off" className={field} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dueOn" className={fieldLabel}>Due</label>
                <input id="dueOn" name="dueOn" type="date" className={field} />
              </div>
              <div>
                <label htmlFor="assignedTo" className={fieldLabel}>Assign to</label>
                <select id="assignedTo" name="assignedTo" defaultValue={staff.id} className={field}>
                  <option value="">Unassigned</option>
                  {team.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <button className={`${btnPrimary} w-full`}>Add task</button>
          </div>
        </form>
      </div>
    </section>
  );
}
