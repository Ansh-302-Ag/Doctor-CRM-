/** The patient's own prescription page, reached from the secure link we send
 *  on WhatsApp (src/lib/record-links.ts). Public — outside the staff (crm)
 *  group. Before the one-time code is verified it shows only the clinic's name
 *  and the code form: WhatsApp fetches links to build previews, and that fetch
 *  must see nothing. Headers (no-store, no-referrer, noindex): next.config.ts. */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { sql } from "@/lib/db";
import {
  linkPreview, readRecord, sendRecordCode, verifyCode, CODE_TTL_MINUTES, MAX_WRONG_CODES,
} from "@/lib/record-links";
import { markVerified, viewedLinkId } from "@/lib/record-session";
import { Alert, btnPrimary, btnSecondary, field, fieldLabel } from "../../(crm)/_ui";

export const metadata: Metadata = {
  title: "Secure link",
  description: "Enter the code sent to your WhatsApp.",
  robots: { index: false, follow: false },
};

const DEAD =
  "This link is no longer valid. Ask the clinic for a new one, or message us “my prescription” on WhatsApp.";

const Shell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <main className="min-h-dvh bg-canvas px-4 py-8 sm:py-12">
    <div className="mx-auto w-full max-w-lg">
      <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
      <div className="mt-4">{children}</div>
    </div>
  </main>
);

export default async function RecordPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ s?: string; left?: string }>;
}) {
  const { token } = await params;
  const { s, left: leftRaw } = await searchParams;
  // From the query string: shown only as a small whole number, else not at all.
  const n = Number.parseInt(leftRaw ?? "", 10);
  const left = Number.isInteger(n) && n >= 0 && n <= MAX_WRONG_CODES ? n : null;
  const preview = await linkPreview(sql, token);
  if (!preview) return <Shell title="Link not valid"><Alert tone="warn">{DEAD}</Alert></Shell>;

  const here = `/r/${encodeURIComponent(token)}`;

  async function sendCode() {
    "use server";
    const r = await sendRecordCode(sql, token);
    redirect(`${here}?s=${r.ok ? (r.sent ? "sent" : "unsent") : r.reason === "rate_limited" ? "rate" : "dead"}`);
  }

  async function verify(form: FormData) {
    "use server";
    const r = await verifyCode(sql, token, String(form.get("code") ?? ""));
    if (r.ok) {
      await markVerified(r.linkId);
      redirect(here);
    }
    if (r.reason === "wrong_code") redirect(`${here}?s=wrong&left=${r.triesLeft}`);
    if (r.reason === "expired_code") redirect(`${here}?s=expired`);
    if (r.reason === "no_code") redirect(`${here}?s=nocode`);
    redirect(here); // invalid or locked: the page now shows it as dead
  }

  if ((await viewedLinkId()) === preview.linkId) {
    const record = await readRecord(sql, preview.linkId);
    if (!record) return <Shell title="Link not valid"><Alert tone="warn">{DEAD}</Alert></Shell>;
    const day = (at: Date) => new Intl.DateTimeFormat("en-GB", {
      timeZone: record.timezone, day: "numeric", month: "short", year: "numeric",
    }).format(at);
    return (
      <Shell title={record.clinicName}>
        {record.patientName && <p className="text-sm text-ink-2">{record.patientName}</p>}
        {record.prescriptions.length === 0 ? (
          <p className="mt-4 text-sm text-ink-2">There are no active prescriptions on your record.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {record.prescriptions.map((p, i) => (
              <li key={i} className="break-words rounded-xl border border-line bg-surface p-4">
                <p className="font-semibold text-ink">{p.drugName}</p>
                <p className="text-sm text-ink">{p.dosage}</p>
                {p.durationDays !== null && (
                  <p className="text-sm text-ink-2">{p.durationDays} day{p.durationDays === 1 ? "" : "s"}</p>
                )}
                {p.notes && <p className="text-sm text-ink-2">{p.notes}</p>}
                <p className="mt-2 text-xs text-ink-3">{p.doctorName} · {day(p.createdAt)}</p>
              </li>
            ))}
          </ol>
        )}
        {record.prescriptions.length > 0 && (
          <a href={`${here}/pdf`} className={`${btnPrimary} mt-5 min-h-11 w-full sm:w-auto`}>
            <Download aria-hidden className="size-4" /> Download PDF
          </a>
        )}
        <p className="mt-5 text-sm text-ink-2">
          {record.clinicPhone
            ? `For any question about this, call the clinic on ${record.clinicPhone}.`
            : "For any question about this, call the clinic."}
        </p>
      </Shell>
    );
  }

  const codeOut = s === "sent" || s === "unsent" || s === "wrong";
  return (
    <Shell title={preview.clinicName}>
      <p className="text-sm text-ink-2">
        To see your prescription, we’ll send a 6-digit code to your WhatsApp number ending ••{preview.phoneEnding}.
      </p>
      <div className="mt-4 space-y-3 empty:hidden">
        {s === "sent" && <Alert tone="ok">Code sent. It expires in {CODE_TTL_MINUTES} minutes.</Alert>}
        {s === "unsent" && <Alert tone="warn">We could not send the code just now. Try again in a minute, or call the clinic.</Alert>}
        {s === "rate" && <Alert tone="warn">Too many codes. Try again in an hour.</Alert>}
        {s === "wrong" && (
          <Alert tone="danger">
            That code isn’t right.{left !== null && ` ${left} ${left === 1 ? "try" : "tries"} left.`}
          </Alert>
        )}
        {s === "expired" && <Alert tone="warn">That code has expired. Send a new one.</Alert>}
        {s === "nocode" && <Alert tone="warn">Request a code first, then enter it here.</Alert>}
        {s === "dead" && <Alert tone="warn">{DEAD}</Alert>}
      </div>

      {codeOut && (
        <form action={verify} className="mt-5 rounded-xl border border-line bg-surface p-4">
          <label htmlFor="code" className={fieldLabel}>Code</label>
          <input id="code" name="code" required inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} autoFocus
            className={`${field} mt-1 py-2.5 text-lg tracking-[0.3em] tabular-nums`} />
          <button type="submit" className={`${btnPrimary} mt-4 min-h-11 w-full`}>View prescription</button>
        </form>
      )}

      <form action={sendCode} className="mt-4">
        <button type="submit" className={`${codeOut ? btnSecondary : btnPrimary} min-h-11 w-full`}>
          {codeOut ? "Send a new code" : "Send code"}
        </button>
      </form>
    </Shell>
  );
}
