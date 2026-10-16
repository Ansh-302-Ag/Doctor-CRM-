import Link from "next/link";
import { redirect } from "next/navigation";
import { currentStaff, signOut } from "@/lib/session";
import { sql } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Nav, type NavSection } from "./_nav";
import { QuickFind } from "./_quickfind";
import { Suspense } from "react";
import { TopLoader } from "@/components/lightswind/top-loader";
import { Avatar, btnPrimary } from "./_ui";

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
  // nav component only draws what it is handed. Grouped the way the day runs:
  // the desk's work, follow-up, then how the practice is doing.
  const escalations = inbox ? [{ href: "/escalations", label: "Escalations", icon: "escalations" as const,
    count: Number(open.count), countLabel: "open escalations", primary: true }] : [];
  const tasks = { href: "/tasks", label: "Tasks", icon: "tasks" as const,
    count: Number(mine.count), countLabel: "open tasks assigned to you", primary: true };
  const sections: NavSection[] = isDoctor
    ? [
        { title: "My work", items: [
          { href: "/queue", label: "My day", icon: "queue", primary: true },
          { href: "/board", label: "Today's board", icon: "board", primary: true },
          tasks,
        ] },
        { title: "Clinic", items: [
          { href: "/", label: "Clinic day", icon: "calendar", primary: true },
          { href: "/patients", label: "My patients", icon: "patients", primary: true },
        ] },
        { title: "Practice", items: [{ href: "/insights", label: "Insights", icon: "insights" }] },
      ]
    : [
        { title: "Front desk", items: [
          { href: "/", label: "Calendar", icon: "calendar", primary: true },
          { href: "/board", label: "Today's board", icon: "board", primary: true },
          { href: "/patients", label: "Patients", icon: "patients", primary: true },
          ...escalations,
        ] },
        { title: "Follow-up", items: [tasks] },
        { title: "Practice", items: [{ href: "/insights", label: "Insights", icon: "insights" }] },
      ];

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  const wordmark = (
    <div className="flex min-w-0 items-center gap-2.5">
      {/* A medical cross, drawn as one outlined shape, on a tile that turns
          in 3D under the pointer. */}
      <span aria-hidden="true" className="group/mark shrink-0 [perspective:300px]">
        <span className="bg-brand grid size-9 place-items-center rounded-xl text-white shadow-glow ring-1 ring-white/30 transition-transform duration-700 [transform-style:preserve-3d] group-hover/mark:[transform:rotateY(180deg)]">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5Z" />
          </svg>
        </span>
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-ink">Doctor-CRM</span>
        <span className="block truncate text-xs text-ink-3">{staff.clinicName}</span>
      </span>
    </div>
  );

  // Everyone on staff may book and register (appointments:write, patients:write);
  // the pages re-check, these are shortcuts.
  const quick = (
    <div className="flex flex-col gap-1.5">
      <Link href="/appointments/new" className={`${btnPrimary} w-full`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        New appointment
      </Link>
      <Link href="/patients/new" className="rounded-lg px-3 py-1.5 text-center text-sm font-medium text-accent transition-colors hover:bg-accent-soft">
        Register walk-in
      </Link>
    </div>
  );

  return (
    <div className="min-h-dvh md:flex">
      {/* Reads the URL, so it sits in its own Suspense boundary. */}
      <Suspense fallback={null}><TopLoader /></Suspense>
      {/* Phone: a slim top bar (brand + sign out) and, in <Nav>, a fixed bottom
          tab bar. md and up: the rail below. */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-rail-line glass px-4 py-2.5 md:hidden">
        {wordmark}
        <div className="flex shrink-0 items-center gap-2">
          <QuickFind />
          {/* Everything the rail holds, for a phone: a native disclosure, no JS. */}
          <details className="group relative">
            <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-lg border border-line text-ink-2 hover:bg-subtle [&::-webkit-details-marker]:hidden">
              <span className="sr-only">Menu</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </summary>
            <div className="glass absolute right-0 top-11 z-30 w-64 rounded-2xl border border-line p-3 shadow-pop">
              {quick}
              <Nav variant="rail" sections={sections} />
              <form action={logout} className="border-t border-line pt-2">
                <button className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink-2 hover:bg-subtle hover:text-ink">
                  Sign out ({staff.name})
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>

      {/* A rail rather than a strip: this tool stays open all day, and the
          escalation count needs somewhere it can shout. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col border-r border-rail-line glass">
        <div className="border-b border-rail-line px-4 py-4">{wordmark}</div>

        <div className="space-y-3 px-3 pt-3">
          <QuickFind />
          {quick}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <Nav variant="rail" sections={sections} />
        </div>

        <form action={logout} className="m-3 flex items-center gap-2.5 rounded-2xl border border-line bg-gradient-to-br from-surface to-accent-soft/60 p-2.5 shadow-card">
          <Avatar name={staff.name} size="sm" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium text-ink">{staff.name}</span>
            <span className="block text-[11px] capitalize text-ink-3">{staff.role}</span>
          </span>
          <button
            aria-label="Sign out"
            title="Sign out"
            className="grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface hover:text-danger"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" /></svg>
          </button>
        </form>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-10 xl:px-10">
        <div className="mx-auto w-full max-w-[1400px]">{children}</div>
      </main>

      <Nav variant="tabs" sections={sections} />
    </div>
  );
}
