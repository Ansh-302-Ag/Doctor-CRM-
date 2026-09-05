import { redirect } from "next/navigation";
import { authenticate } from "@/lib/auth";
import { getSession, signIn } from "@/lib/session";
import { TooManyAttempts } from "@/lib/throttle";

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const session = await getSession();
  if (session.user) redirect("/");

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
    redirect("/");
  }

  return (
    <main className="min-h-dvh grid place-items-center bg-slate-50 p-6">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Clinic CRM</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your clinic account.</p>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error === "throttled"
              ? "Too many sign-in attempts. Please wait a few minutes and try again."
              : "That email and password did not match."}
          </p>
        )}

        <label className="block text-sm font-medium text-slate-700">
          Email
          <input name="email" type="email" required autoComplete="username"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Password
          <input name="password" type="password" required autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" />
        </label>

        <button type="submit"
          className="w-full rounded-md bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-800">
          Sign in
        </button>
      </form>
    </main>
  );
}
