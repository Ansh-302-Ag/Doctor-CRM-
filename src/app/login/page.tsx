import { redirect } from "next/navigation";
import {
  ArrowRight, CalendarDays, KeyRound, LockKeyhole, Mail, MessageCircle, MessageSquareOff,
  ScrollText, ShieldCheck, Stethoscope,
} from "lucide-react";
import { Scene3D } from "@/components/three/scene";
import { ShinyText } from "@/components/lightswind/shiny-text";
import { OrbitRings } from "@/components/lightswind/orbit";
import { BorderBeam } from "@/components/lightswind/border-beam";
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
  <span aria-hidden="true" className={`bg-brand grid place-items-center rounded-lg text-white ${className}`}>
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
    <main className="grid min-h-dvh md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
      {/* Brand panel: md+ only; phones get the compact mark above the form. */}
      <aside className="relative isolate hidden overflow-hidden bg-deep p-10 text-white md:flex md:flex-col md:justify-between lg:p-14">
        <div aria-hidden="true" className="absolute inset-0 -z-10">
          <div className="absolute -left-1/4 -top-1/3 h-[90%] w-[90%] animate-aurora rounded-full bg-accent-2/45 blur-3xl" />
          <div className="absolute -bottom-1/3 right-[-20%] h-[80%] w-[80%] animate-aurora rounded-full bg-sky/40 blur-3xl [animation-delay:-7s]" />
          <div className="absolute bottom-1/4 left-1/4 h-1/2 w-1/2 animate-aurora rounded-full bg-iris/30 blur-3xl [animation-delay:-13s]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.08)_1px,transparent_0)] bg-[length:22px_22px]" />
          <div className="absolute inset-y-0 right-0 w-1/2 opacity-70"><Scene3D variant="helix" /></div>
        </div>

        <div className="relative flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5Z" />
            </svg>
          </span>
          <span className="text-lg font-semibold">Doctor-CRM</span>
        </div>

        <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-md">
            <p className="text-3xl font-semibold leading-tight tracking-tight lg:text-[42px] lg:leading-[1.1]">
              The clinic front desk,{" "}
              <ShinyText base="var(--color-accent-line)" speed={5}>handled.</ShinyText>
            </p>
            <p className="mt-4 text-base text-white/80">
              Appointments, patients and WhatsApp for your clinic.
            </p>
            <ul className="mt-8 space-y-3">
              {TRUST.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm text-white/90">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div className="hidden xl:block">
            <OrbitRings
              size={300}
              center={<Mark className="size-16 rounded-2xl shadow-[0_0_40px_rgb(20_163_157/0.6)] ring-1 ring-white/30" />}
              orbits={[
                { radius: 70, seconds: 14, icon: <CalendarDays className="size-5" /> },
                { radius: 110, seconds: 22, icon: <MessageCircle className="size-5" />, start: 120 },
                { radius: 110, seconds: 22, icon: <Stethoscope className="size-5" />, start: 300 },
                { radius: 146, seconds: 30, icon: <ShieldCheck className="size-5" />, start: 210 },
              ]}
            />
          </div>
        </div>

        <p className="relative text-xs text-white/70">Patient data. Sessions end after eight hours.</p>
      </aside>

      <div className="relative flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center md:hidden">
            <div className="flex items-center gap-2.5">
              <Mark className="size-9" />
              <span className="text-lg font-semibold text-ink">Doctor-CRM</span>
            </div>
            <p className="mt-2 text-sm text-ink-2">The clinic front desk, handled.</p>
          </div>

          <form action={login} className="glass relative rounded-3xl border border-line p-6 shadow-pop sm:p-8">
            <BorderBeam size={120} duration={9} />
            <span aria-hidden="true" className="bg-brand mb-5 hidden size-11 place-items-center rounded-2xl text-white shadow-glow md:grid">
              <LockKeyhole className="size-5" />
            </span>
            <h1 className="text-gradient text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-ink-2">Sign in with your clinic staff account.</p>

            {error && (
              <Alert tone="danger" className="mt-4">
                {error === "throttled"
                  ? "Too many sign-in attempts. Please wait a few minutes and try again."
                  : "That email and password did not match."}
              </Alert>
            )}

            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className={fieldLabel}>Email</label>
                <div className="relative">
                  <Mail aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-ink-3" />
                  <input id="email" name="email" type="email" required autoFocus autoComplete="username" className={`${field} py-2.5 pl-10`} />
                </div>
              </div>
              <div>
                <label htmlFor="password" className={fieldLabel}>Password</label>
                <div className="relative">
                  <KeyRound aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-ink-3" />
                  <input id="password" name="password" type="password" required autoComplete="current-password" className={`${field} py-2.5 pl-10`} />
                </div>
              </div>
            </div>

            <button type="submit" className={`${btnPrimary} mt-6 w-full py-3 text-base`}>
              Sign in <ArrowRight aria-hidden="true" className="size-4" />
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
