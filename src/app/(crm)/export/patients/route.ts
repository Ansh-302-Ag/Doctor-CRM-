import { currentStaff } from "@/lib/session";
import { sql } from "@/lib/db";
import { exportPatients, csvResponse } from "@/lib/export";
import { patientScope } from "@/lib/patients";

export async function GET() {
  const staff = await currentStaff();
  const csv = await exportPatients(
    sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, staff.timezone,
    patientScope(staff),
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: staff.timezone }).format(new Date());
  return csvResponse(csv, `patients-${today}.csv`);
}
