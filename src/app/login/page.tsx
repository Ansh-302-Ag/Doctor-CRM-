import { redirect } from "next/navigation";
import { authenticate } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getSession, signIn } from "@/lib/session";
import { TooManyAttempts } from "@/lib/throttle";

const field =
  "mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink";

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
    <main className="grid min-h-dvh place-items-center bg-rail p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-md bg-accent text-white">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 6v12M6 12h12" />
            </svg>
          </span>
          <span className="text-lg font-semibold text-white">Doctor-CRM</span>
        </div>
        <p className="mt-2 text-center text-sm text-rail-ink">
          Appointments, patients and WhatsApp for your clinic
        </p>

        <form action={login} className="mt-6 rounded-xl border border-line bg-surface p-7 shadow-lg">
          <h1 className="text-lg font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-ink-2">Use your clinic staff account.</p>

          {error && (
            <p role="alert" className="mt-4 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
              {error === "throttled"
                ? "Too many sign-in attempts. Please wait a few minutes and try again."
                : "That email and password did not match."}
            </p>
          )}

          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wide text-ink-3">
                Email
              </label>
              <input id="email" name="email" type="email" required autoFocus autoComplete="username" className={field} />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wide text-ink-3">
                Password
              </label>
              <input id="password" name="password" type="password" required autoComplete="current-password" className={field} />
            </div>
          </div>

          <button
            type="submit"
            className="mt-6 w-full rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Sign in
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-rail-ink">
          Patient data. Sessions end after eight hours.
        </p>
      </div>
    </main>
  );
}
