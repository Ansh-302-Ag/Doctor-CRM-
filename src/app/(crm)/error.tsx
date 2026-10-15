"use client";

import Link from "next/link";

/** A failed CRM page shows this instead of Next's bare crash screen. A refused
 *  permission (rbac's Forbidden: "role '…' is not permitted …") reads as such. */
export default function CrmError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const forbidden = error.message.startsWith("role '");
  return (
    <section role="alert" className="mx-auto mt-10 max-w-md rounded-lg border border-line bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold text-ink">
        {forbidden ? "You are not allowed to do that." : "Something went wrong."}
      </h1>
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link href="/" className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-2 hover:bg-subtle">
          Go home
        </Link>
      </div>
    </section>
  );
}
