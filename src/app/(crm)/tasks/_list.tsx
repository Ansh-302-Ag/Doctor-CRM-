import Link from "next/link";
import type { Task } from "@/lib/tasks";
import { btnSecondary } from "../_ui";

/** A due day is a calendar date, not an instant: format it as UTC so no
 *  timezone can move it a day. */
const day = (d: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", dateStyle: "medium",
}).format(new Date(`${d}T00:00:00Z`));

/** Open tasks with a "Done" button each. Shared by /tasks and the patient page;
 *  each passes its own action so it can send the user back where they were. */
export function TaskList({
  tasks, done, empty, showPatient = true,
}: {
  tasks: Task[]; done: (form: FormData) => Promise<void>; empty: string; showPatient?: boolean;
}) {
  if (tasks.length === 0) {
    return (
      <p className="mt-2 rounded-lg border border-dashed border-line-strong bg-surface p-6 text-center text-sm text-ink-3">
        {empty}
      </p>
    );
  }
  return (
    <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
      {tasks.map(t => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-ink">{t.title}</p>
            <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-ink-3">
              {showPatient && t.patient_id && (
                <Link href={`/patients/${t.patient_id}`} className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
                  {t.patient_name ?? "Unnamed patient"}
                </Link>
              )}
              <span className={t.overdue ? "font-semibold text-danger-ink" : undefined}>
                {t.due_on ? `${t.overdue ? "Overdue · " : "Due "}${day(t.due_on)}` : "No due date"}
              </span>
              <span>· {t.assignee_name ?? "Unassigned"}</span>
            </p>
          </div>
          <form action={done}>
            <input type="hidden" name="taskId" value={t.id} />
            <button className={btnSecondary}>Done</button>
          </form>
        </li>
      ))}
    </ul>
  );
}
