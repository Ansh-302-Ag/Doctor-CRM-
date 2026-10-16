"use client";

import Link from "next/link";
import { CircleAlert, ShieldOff } from "lucide-react";
import { btnPrimary, btnSecondary } from "./_ui";

/** A failed CRM page shows this instead of Next's bare crash screen. A refused
 *  permission (rbac's Forbidden: "role '…' is not permitted …") reads as such. */
export default function CrmError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const forbidden = error.message.startsWith("role '");
  const Icon = forbidden ? ShieldOff : CircleAlert;
  return (
    <section role="alert" className="mx-auto mt-10 max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-pop">
      <span aria-hidden="true" className="mx-auto grid size-14 animate-float place-items-center rounded-2xl bg-warn-soft text-warn ring-1 ring-warn-line">
        <Icon className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-ink">
        {/* Production hides Server Component messages, so the fallback has to cover a refusal too. */}
        {forbidden ? "You are not allowed to do that." : "Something went wrong, or you don't have access to this."}
      </h1>
      <p className="mt-1 text-sm text-ink-3">Try again, or go back to the calendar.</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={() => retry()} className={btnPrimary}>
          Try again
        </button>
        <Link href="/" className={btnSecondary}>
          Back to calendar
        </Link>
      </div>
    </section>
  );
}
