import Link from "next/link";
import { SearchX } from "lucide-react";
import { btnPrimary, btnSecondary } from "./_ui";

/** A missing record, a bad link, or a page this role has no business on —
 *  the pages answer all three with notFound(), so the wording covers all three. */
export default function NotFound() {
  return (
    <section className="mx-auto mt-10 max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-pop">
      <span aria-hidden="true" className="mx-auto grid size-14 animate-float place-items-center rounded-2xl bg-accent-soft text-accent ring-1 ring-accent-line">
        <SearchX className="size-6" />
      </span>
      <h1 className="text-gradient mt-4 text-lg font-semibold">Nothing to show here</h1>
      <p className="mt-1 text-sm text-ink-3">
        The record may have been merged or removed, or it is not one you can open.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href="/patients" className={btnPrimary}>Find a patient</Link>
        <Link href="/" className={btnSecondary}>Back to calendar</Link>
      </div>
    </section>
  );
}
