import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { exportPatients, csvResponse } from "@/lib/export";
import { patientScope, isPatientList } from "@/lib/patients";
import { Forbidden } from "@/lib/rbac";

export async function GET(req: Request) {
  const staff = await currentStaff();
  const list = new URL(req.url).searchParams.get("list");
  let csv: string;
  try {
    csv = await exportPatients(
      sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, staff.timezone,
      patientScope(staff), list,
    );
  } catch (e) {
    if (e instanceof Forbidden) return new Response("You are not allowed to export patients.", { status: 403 });
    throw e;
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(new Date());
  return csvResponse(csv, `patients-${isPatientList(list) ? `${list}-` : ""}${today}.csv`);
}
