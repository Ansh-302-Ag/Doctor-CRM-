import Link from "next/link";
import { AlertTriangle, CalendarDays, Check, User } from "lucide-react";
import type { Task } from "@/lib/tasks";
import { Reveal } from "@/components/motion/reveal";
import { btnSecondary, btnSm } from "../_ui";

/** A due day is a calendar date, not an instant: format it as UTC so no
 *  timezone can move it a day. */
const day = (d: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", dateStyle: "medium",
}).format(new Date(`${d}T00:00:00Z`));

/** Open tasks with a "Done" button each, overdue ones first and marked. Shared
 *  by /tasks and the patient page; each passes its own action so it can send
 *  the user back where they were. */
export function TaskList({
  tasks, done, empty, showPatient = true,
}: {
  tasks: Task[]; done: (form: FormData) => Promise<void>; empty: string; showPatient?: boolean;
}) {
  if (tasks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong bg-surface/60 p-6 text-center text-sm text-ink-3">
        {empty}
      </p>
    );
  }
  const overdue = tasks.filter(t => t.overdue);
  const later = tasks.filter(t => !t.overdue);
  const group = (label: string, list: Task[], warn: boolean) => list.length > 0 && (
    <div>
      {overdue.length > 0 && (
        <p className={`px-4 pb-1 pt-3 text-[11px] font-semibold tracking-wide ${warn ? "text-warn-ink" : "text-ink-3"}`}>
          {label} · {list.length}
        </p>
      )}
      <Reveal as="ul" className="divide-y divide-line">
        {list.map(t => (
          <li
            key={t.id}
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-l-2 px-4 py-3 ${t.overdue ? "border-l-warn bg-warn-soft/50" : "border-l-transparent"}`}
          >
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium text-ink">{t.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                {showPatient && t.patient_id && (
                  <Link href={`/patients/${t.patient_id}`} className="font-medium text-accent hover:text-accent-hover hover:underline">
                    {t.patient_name ?? "Unnamed patient"}
                  </Link>
                )}
                <span className={`inline-flex items-center gap-1 ${t.overdue ? "font-semibold text-warn-ink" : ""}`}>
                  {t.overdue
                    ? <AlertTriangle className="size-3.5" aria-hidden="true" />
                    : <CalendarDays className="size-3.5" aria-hidden="true" />}
                  {t.due_on ? `${t.overdue ? "Overdue · " : "Due "}${day(t.due_on)}` : "No due date"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <User className="size-3.5" aria-hidden="true" />
                  {t.assignee_name ?? "Unassigned"}
                </span>
              </p>
            </div>
            <form action={done}>
              <input type="hidden" name="taskId" value={t.id} />
              <button className={`${btnSecondary} ${btnSm}`}>
                <Check className="size-3.5" aria-hidden="true" /> Done
              </button>
            </form>
          </li>
        ))}
      </Reveal>
    </div>
  );
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      {group("Overdue", overdue, true)}
      {group("Due later", later, false)}
    </div>
  );
}
