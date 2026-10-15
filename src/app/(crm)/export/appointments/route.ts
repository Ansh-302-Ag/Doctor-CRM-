import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { exportAppointments, csvResponse } from "@/lib/export";
import { isId, DeskError } from "@/lib/desk";

export async function GET(req: NextRequest) {
  const staff = await currentStaff();
  const p = req.nextUrl.searchParams;
  const from = p.get("from") ?? "", to = p.get("to") ?? from;
  const filter = p.get("doctor");
  // A doctor exports only his own appointments; the desk may narrow to one doctor.
  const doctorId = staff.role === "doctor" ? staff.doctorId : filter && isId(filter) ? filter : null;
  try {
    const csv = await exportAppointments(
      sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, staff.timezone,
      from, to, doctorId,
    );
    return csvResponse(csv, `appointments-${from}-to-${to}.csv`);
  } catch (e) {
    // Back to the calendar with the reason shown, like every other desk error.
    // An invalid `from` is harmless there: the page falls back to today.
    if (e instanceof DeskError) {
      const back = new URLSearchParams({ day: from, error: e.message });
      if (filter && isId(filter)) back.set("doctor", filter);
      redirect(`/?${back}`);
    }
    throw e;
  }
}
