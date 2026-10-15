import { redirect } from "next/navigation";
import { currentStaff, signOut } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Nav } from "./_nav";
import { QuickFind } from "./_quickfind";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  const isDoctor = staff.role === "doctor";
  // A doctor has no escalation inbox (docs/08), so neither the link nor the
  // count query that feeds its badge exists for him.
  const inbox = can(staff.role, "escalations:read");
  // Both badge counts go out together: Neon is a continent away.
  const [[open], [mine]] = await Promise.all([
    inbox ? sql<{ count: string }[]>`
      select count(*) from escalations e
        join patients p on p.id = e.patient_id
       where p.clinic_id = ${staff.clinicId} and e.status <> 'resolved'` : [{ count: "0" }],
    // Tasks assigned to me are always mine to see, whatever the doctor scope.
    sql<{ count: string }[]>`
      select count(*) from tasks k left join patients p on p.id = k.patient_id
       where k.clinic_id = ${staff.clinicId} and k.assigned_to = ${staff.id} and k.done_at is null
         and p.deleted_at is null`,  // as listTasks: a withdrawn patient's tasks are hidden
  ]);

  // The rail is role-shaped, and the role logic stays here on the server: the
  // nav component only draws what it is handed.
  const items = [
    ...(isDoctor ? [{ href: "/queue", label: "My day", icon: "queue" as const }] : []),
    { href: "/", label: isDoctor ? "Clinic day" : "Calendar", icon: "calendar" as const },
    { href: "/patients", label: isDoctor ? "My patients" : "Patients", icon: "patients" as const },
    ...(inbox ? [{ href: "/escalations", label: "Escalations", icon: "escalations" as const,
                   count: Number(open.count), countLabel: "open escalations" }] : []),
    { href: "/tasks", label: "Tasks", icon: "tasks" as const,
      count: Number(mine.count), countLabel: "open tasks assigned to you" },
  ];

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  const wordmark = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-white"
      >
        <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 6v12M6 12h12" />
        </svg>
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-semibold tracking-tight text-white">Doctor-CRM</span>
        <span className="block truncate text-xs text-rail-ink">{staff.clinicName}</span>
      </span>
    </div>
  );

  return (
    <div className="min-h-dvh md:flex">
      {/* Phone: a slim top bar (brand + sign out) and, in <Nav>, a fixed bottom
          tab bar. md and up: the rail below. */}
      <header className="flex items-center justify-between gap-3 border-b border-rail-line bg-rail px-4 py-2.5 md:hidden">
        {wordmark}
        <div className="flex shrink-0 items-center gap-2">
        <QuickFind />
        <form action={logout}>
          <button className="rounded-md border border-rail-line px-3 py-1.5 text-sm font-medium text-rail-ink transition-colors hover:bg-rail-active hover:text-white">
            Sign out
          </button>
        </form>
        </div>
      </header>

      {/* A rail rather than a strip: this tool stays open all day, and the
          escalation count needs somewhere it can shout. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-52 md:shrink-0 md:flex-col border-r border-rail-line bg-rail xl:w-60">
        <div className="border-b border-rail-line px-4 py-4">{wordmark}</div>

        <div className="px-3 pt-3"><QuickFind /></div>

        <Nav variant="rail" items={items} />

        <form action={logout} className="flex flex-col gap-2 border-t border-rail-line p-3">
          <span className="leading-tight">
            <span className="block text-sm font-medium text-white">{staff.name}</span>
            <span className="block text-[11px] capitalize text-rail-ink">{staff.role}</span>
          </span>
          <button className="rounded-md border border-rail-line px-3 py-1.5 text-sm font-medium text-rail-ink transition-colors hover:bg-rail-active hover:text-white">
            Sign out
          </button>
        </form>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 pb-24 md:px-6 md:py-8 md:pb-8 xl:px-8">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>

      <Nav variant="tabs" items={items} />
    </div>
  );
}
