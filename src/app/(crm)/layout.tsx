import Link from "next/link";
import { redirect } from "next/navigation";
import { currentStaff, signOut } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  const isDoctor = staff.role === "doctor";
  // A doctor has no escalation inbox (docs/08), so neither the link nor the
  // count query that feeds its badge exists for him.
  const inbox = can(staff.role, "escalations:read");
  const [open] = inbox ? await sql<{ count: string }[]>`
    select count(*) from escalations e
      join patients p on p.id = e.patient_id
     where p.clinic_id = ${staff.clinicId} and e.status <> 'resolved'` : [{ count: "0" }];

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <span className="font-semibold text-slate-900">Clinic CRM</span>
          <nav className="flex gap-4 text-sm">
            {isDoctor && (
              <Link href="/queue" className="text-slate-600 hover:text-slate-900">My day</Link>
            )}
            <Link href="/" className="text-slate-600 hover:text-slate-900">
              {isDoctor ? "Clinic day" : "Calendar"}
            </Link>
            <Link href="/patients" className="text-slate-600 hover:text-slate-900">
              {isDoctor ? "My patients" : "Patients"}
            </Link>
            {inbox && (
              <Link href="/escalations" className="text-slate-600 hover:text-slate-900">
                Escalations
                {Number(open.count) > 0 && (
                  <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                    {open.count}
                  </span>
                )}
              </Link>
            )}
          </nav>
          <form action={logout} className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-500">{staff.name} · {staff.role}</span>
            <button className="text-slate-600 underline hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
