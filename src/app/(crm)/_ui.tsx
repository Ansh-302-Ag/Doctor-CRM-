/** The three bits of markup that genuinely repeat across the CRM screens:
 *  a status pill, the vocabulary that drives it, and a loading bar. Nothing
 *  else lives here — the screens are different enough to stay hand-written. */
import type { ReactNode } from "react";

const TONES = {
  neutral: "border-line bg-subtle text-ink-2",
  accent: "border-accent-line bg-accent-soft text-accent-ink",
  ok: "border-ok-line bg-ok-soft text-ok-ink",
  warn: "border-warn-line bg-warn-soft text-warn-ink",
  danger: "border-danger-line bg-danger-soft text-danger-ink",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

type Label = { label: string; tone: Tone };

/** Statuses arrive as raw enum text from the database; these turn them into
 *  something a receptionist reads. Unknown values fall back to the raw value
 *  rather than disappearing. */
const APPOINTMENT: Record<string, Label> = {
  booked: { label: "Booked", tone: "accent" },
  completed: { label: "Completed", tone: "ok" },
  no_show: { label: "No show", tone: "warn" },
};

const CONSENT: Record<string, Label> = {
  granted: { label: "Granted", tone: "ok" },
  pending: { label: "Pending", tone: "warn" },
  withdrawn: { label: "Withdrawn", tone: "danger" },
};

const PRESCRIPTION: Record<string, Label> = {
  active: { label: "Active", tone: "ok" },
  completed: { label: "Completed", tone: "neutral" },
  discontinued: { label: "Discontinued", tone: "neutral" },
};

const raw = (v: string): Label => ({ label: v.replace(/_/g, " "), tone: "neutral" });

export const appointmentStatus = (s: string) => APPOINTMENT[s] ?? raw(s);
export const consentStatus = (s: string) => CONSENT[s] ?? raw(s);
export const prescriptionStatus = (s: string) => PRESCRIPTION[s] ?? raw(s);

/** A grey bar for the loading skeletons. Same dimensions as the real thing. */
export function Skel({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-line ${className}`} />;
}

/** Button skins, as class strings rather than components — every button in the
 *  CRM is a plain <button> inside a server-action form, and wrapping that in a
 *  component would buy nothing. */
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover";
export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink";
