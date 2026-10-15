import Link from "next/link";
import { btnPrimary } from "./(crm)/_ui";

/** An address that is not part of the app at all. */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <section className="w-full max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-pop">
        <p className="text-gradient text-6xl font-semibold tabular-nums">404</p>
        <h1 className="mt-3 text-lg font-semibold text-ink">This page does not exist</h1>
        <p className="mt-1 text-sm text-ink-3">Check the address, or go back to the clinic&rsquo;s calendar.</p>
        <Link href="/" className={`${btnPrimary} mt-6`}>Go to the calendar</Link>
      </section>
    </main>
  );
}
