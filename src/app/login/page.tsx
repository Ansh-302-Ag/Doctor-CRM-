import { redirect } from "next/navigation";
import { ShieldCheck, ScrollText, MessageSquareOff } from "lucide-react";
import { authenticate } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getSession, signIn } from "@/lib/session";
import { TooManyAttempts } from "@/lib/throttle";
import { Alert, btnPrimary, field, fieldLabel } from "../(crm)/_ui";

const TRUST = [
  { icon: ShieldCheck, text: "Patient data stays with your clinic." },
  { icon: ScrollText, text: "Every action is recorded in the audit log." },
  { icon: MessageSquareOff, text: "The assistant never answers clinical questions." },
];

const Mark = ({ className = "" }: { className?: string }) => (
  <span aria-hidden="true" className={`grid place-items-center rounded-lg bg-accent text-white ${className}`}>
    <svg viewBox="0 0 24 24" className="size-1/2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5Z" />
    </svg>
  </span>
);

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const session = await getSession();
  // A cookie whose staff row is gone (deleted account, reseeded database) must
  // not bounce back to the CRM, which would send it here again: show the form,
  // and signing in overwrites the stale cookie.
  if (session.user) {
    const [staff] = await sql`select 1 from staff_users where id = ${session.user.id}`;
    if (staff) redirect(session.user.role === "doctor" ? "/queue" : "/");
  }

  async function login(form: FormData) {
    "use server";
    let user;
    try {
      user = await authenticate({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
    } catch (e) {
      if (e instanceof TooManyAttempts) redirect("/login?error=throttled");
      throw e;
    }
    if (!user) redirect("/login?error=1");
    await signIn(user);
    // A doctor's home is his own queue; everyone else's is the clinic calendar.
    redirect(user.role === "doctor" ? "/queue" : "/");
  }

  return (
    <main className="grid min-h-dvh bg-canvas md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel: md+ only; phones get the compact mark above the form. */}
      <aside className="relative hidden overflow-hidden bg-accent-ink p-10 text-white md:flex md:flex-col md:justify-between lg:p-14">
        <div className="relative flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-lg bg-white/15 ring-1 ring-white/25">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5Z" />
            </svg>
          </span>
          <span className="text-lg font-semibold">Doctor-CRM</span>
        </div>

        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">
            The clinic front desk, handled.
          </p>
          <p className="mt-3 text-base text-white/80">
            Appointments, patients and WhatsApp for your clinic.
          </p>
          <ul className="mt-8 space-y-3">
            {TRUST.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/10">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/70">Patient data. Sessions end after eight hours.</p>
      </aside>

      <div className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center md:hidden">
            <div className="flex items-center gap-2.5">
              <Mark className="size-9" />
              <span className="text-lg font-semibold text-ink">Doctor-CRM</span>
            </div>
            <p className="mt-2 text-sm text-ink-2">The clinic front desk, handled.</p>
          </div>

          <form action={login} className="rounded-xl border border-line bg-surface p-6 shadow-pop sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
            <p className="mt-1 text-sm text-ink-2">Use your clinic staff account.</p>

            {error && (
              <Alert tone="danger" className="mt-4">
                {error === "throttled"
                  ? "Too many sign-in attempts. Please wait a few minutes and try again."
                  : "That email and password did not match."}
              </Alert>
            )}

            <div className="mt-5 space-y-4">
              <div>
                <label htmlFor="email" className={fieldLabel}>Email</label>
                <input id="email" name="email" type="email" required autoFocus autoComplete="username" className={`${field} py-2.5`} />
              </div>
              <div>
                <label htmlFor="password" className={fieldLabel}>Password</label>
                <input id="password" name="password" type="password" required autoComplete="current-password" className={`${field} py-2.5`} />
              </div>
            </div>

            <button type="submit" className={`${btnPrimary} mt-6 w-full py-2.5`}>
              Sign in
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-ink-3 md:hidden">
            Patient data. Sessions end after eight hours.
          </p>
        </div>
      </div>
    </main>
  );
}
