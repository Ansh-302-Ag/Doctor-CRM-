"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { validDay } from "@/lib/valid-day";
import { patientScope } from "@/lib/patients";
import { markArrived, setOutcome, refusal, isId } from "@/lib/desk";

/** Arrived / completed / no-show, posted from the calendar, the visit board or
 *  the doctor's queue. A doctor is held to his own appointments wherever he
 *  posts from. The way back is one of three fixed paths, never a posted URL. */
export async function recordVisit(form: FormData) {
  const me = await currentStaff();
  const actor = { kind: "staff" as const, id: me.id };
  const id = String(form.get("appointmentId") ?? "");
  const visit = String(form.get("visit") ?? "");
  const from = form.get("from");
  const queue = from === "queue";

  // Rebuild the way back from validated values only.
  const back = new URLSearchParams();
  const day = validDay(String(form.get("day") ?? ""), "");
  if (day) back.set("day", day);
  const doctor = String(form.get("doctor") ?? "");
  if (!queue && isId(doctor)) back.set("doctor", doctor);

  let error: string | null = null;
  try {
    if (!isId(id)) error = "no such appointment";
    else if (visit === "arrived") {
      await markArrived(sql, actor, me.role, me.clinicId, id, patientScope(me));
    } else if (visit === "completed" || visit === "no_show") {
      await setOutcome(sql, actor, me.role, me.clinicId, id, visit, patientScope(me));
    } else error = "unknown action";
  } catch (e) {
    error = refusal(e);
    if (error === null) throw e;
  }
  if (error) back.set("error", error);
  const path = queue ? "/queue" : from === "board" ? "/board" : "/";
  revalidatePath(path);
  redirect(`${path}?${back}`);
}
