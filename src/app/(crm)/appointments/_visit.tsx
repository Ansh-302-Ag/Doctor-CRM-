import { CheckCheck, DoorOpen, UserX } from "lucide-react";
import { recordVisit } from "./actions";
import { btnSecondary, btnSm } from "../_ui";

const btn = `${btnSecondary} ${btnSm}`;

/** The desk's buttons on a still-booked appointment. No-show only once the
 *  slot has started — setOutcome refuses it before then anyway. */
export function VisitActions({
  a, from, day, doctor, now,
}: {
  a: { id: string; status: string; arrived_at: Date | null; starts_at: Date };
  from: "calendar" | "queue" | "board"; day: string; doctor?: string | null; now: Date;
}) {
  if (a.status !== "booked") return null;
  return (
    <form action={recordVisit} className="flex flex-wrap gap-1.5">
      <input type="hidden" name="appointmentId" value={a.id} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="day" value={day} />
      {doctor && <input type="hidden" name="doctor" value={doctor} />}
      {!a.arrived_at && (
        <button name="visit" value="arrived" className={btn}>
          <DoorOpen aria-hidden className="size-3.5" />Arrived
        </button>
      )}
      <button name="visit" value="completed" className={btn}>
        <CheckCheck aria-hidden className="size-3.5" />Completed
      </button>
      {a.starts_at <= now && (
        <button name="visit" value="no_show" className={btn}>
          <UserX aria-hidden className="size-3.5" />No-show
        </button>
      )}
    </form>
  );
}
