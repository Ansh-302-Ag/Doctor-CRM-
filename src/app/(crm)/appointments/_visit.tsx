import { recordVisit } from "./actions";
import { btnSecondary } from "../_ui";

/** The desk's buttons on a still-booked appointment. No-show only once the
 *  slot has started — setOutcome refuses it before then anyway. */
export function VisitActions({
  a, from, day, doctor, now,
}: {
  a: { id: string; status: string; arrived_at: Date | null; starts_at: Date };
  from: "calendar" | "queue"; day: string; doctor?: string | null; now: Date;
}) {
  if (a.status !== "booked") return null;
  return (
    <form action={recordVisit} className="flex flex-wrap gap-1.5">
      <input type="hidden" name="appointmentId" value={a.id} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="day" value={day} />
      {doctor && <input type="hidden" name="doctor" value={doctor} />}
      {!a.arrived_at && (
        <button name="visit" value="arrived" className={btnSecondary}>Arrived</button>
      )}
      <button name="visit" value="completed" className={btnSecondary}>Completed</button>
      {a.starts_at <= now && (
        <button name="visit" value="no_show" className={btnSecondary}>No-show</button>
      )}
    </form>
  );
}
