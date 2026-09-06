import { redirect } from "next/navigation";
import { currentStaff, signOut } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Nav } from "./_nav";

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

  // The rail is role-shaped, and the role logic stays here on the server: the
  // nav component only draws what it is handed.
  const items = [
    ...(isDoctor ? [{ href: "/queue", label: "My day", icon: "queue" as const }] : []),
    { href: "/", label: isDoctor ? "Clinic day" : "Calendar", icon: "calendar" as const },
    { href: "/patients", label: isDoctor ? "My patients" : "Patients", icon: "patients" as const },
    ...(inbox ? [{ href: "/escalations", label: "Escalations", icon: "escalations" as const }] : []),
  ];

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  return (
    <div className="min-h-dvh md:flex">
      {/* A rail rather than a strip: this tool stays open all day, and the
          escalation count needs somewhere it can shout. It collapses to a
          single dark bar on a small laptop — wrapping, no toggle to script. */}
      <aside className="flex flex-wrap items-center gap-3 border-b border-rail-line bg-rail px-4 py-3 md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:flex-col md:items-stretch md:gap-0 md:border-b-0 md:px-0 md:py-0">
        <div className="flex items-center gap-2.5 md:border-b md:border-rail-line md:px-4 md:py-4">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-white"
          >
            <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 6v12M6 12h12" />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">Clinic CRM</span>
        </div>

        <Nav items={items} openEscalations={Number(open.count)} />

        <form
          action={logout}
          className="ml-auto flex items-center gap-3 md:ml-0 md:flex-col md:items-stretch md:gap-2 md:border-t md:border-rail-line md:p-3"
        >
          <span className="leading-tight">
            <span className="block text-sm font-medium text-white">{staff.name}</span>
            <span className="block text-[11px] capitalize text-rail-ink">{staff.role}</span>
          </span>
          <button className="rounded-md border border-rail-line px-3 py-1.5 text-sm font-medium text-rail-ink transition-colors hover:bg-rail-active hover:text-white">
            Sign out
          </button>
        </form>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
