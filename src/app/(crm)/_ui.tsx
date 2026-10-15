/** The shared kit for every CRM screen: page header, card, alert, empty state,
 *  status pills, form-field and table skins, buttons. Pages compose these so
 *  the whole app reads as one product. Server components only — the animated
 *  pieces live in src/components/ (Lightswind, anime.js). */
import type { ReactNode } from "react";
import Link from "next/link";

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
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
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
  cancelled: { label: "Cancelled", tone: "neutral" },
  rescheduled: { label: "Rescheduled", tone: "neutral" },
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
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
export const btnPrimary =
  `${btnBase} bg-accent text-white shadow-card hover:bg-accent-hover`;
export const btnSecondary =
  `${btnBase} border border-line-strong bg-surface text-ink-2 shadow-card hover:border-ink-3 hover:text-ink`;
export const btnGhost =
  `${btnBase} text-ink-2 hover:bg-subtle hover:text-ink`;
export const btnDanger =
  `${btnBase} border border-danger-line bg-surface text-danger-ink hover:bg-danger-soft`;
/** Compact size for buttons inside table rows and cards: append to a skin. */
export const btnSm = "!px-2.5 !py-1.5 !text-xs";

/** Form fields. Use with a <label htmlFor>; `fieldLabel` sits above the input. */
export const field =
  "mt-1.5 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-[inset_0_1px_1px_rgb(13_27_42/0.04)] transition-colors hover:border-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
export const fieldLabel = "block text-sm font-medium text-ink-2";
export const fieldHint = "mt-1 text-xs text-ink-3";

/** Tables: wrap in `tableWrap`, headers `th`, cells `td`, body rows `tr`. */
export const tableWrap = "overflow-x-auto rounded-xl border border-line bg-surface shadow-card";
export const th =
  "border-b border-line bg-subtle px-4 py-2.5 text-left text-xs font-semibold text-ink-3";
export const td = "px-4 py-3 align-middle text-sm text-ink-2";
export const tr = "border-b border-line last:border-0 transition-colors hover:bg-subtle/70";

/** Title row of a page: optional back link, title, one line of context, actions. */
export function PageHeader({
  title, subtitle, actions, back,
}: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-ink-3 transition-colors hover:text-ink">
          <span aria-hidden="true">&larr;</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A white panel. With `title` it gets a header row (and optional actions). */
export function Card({
  title, description, actions, children, className = "", bodyClassName = "p-4 sm:p-5", id,
}: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode;
  className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <section id={id} className={`rounded-xl border border-line bg-surface shadow-card ${className}`}>
      {title && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const ALERT = {
  danger: "border-danger-line bg-danger-soft text-danger-ink",
  warn: "border-warn-line bg-warn-soft text-warn-ink",
  ok: "border-ok-line bg-ok-soft text-ok-ink",
  info: "border-accent-line bg-accent-soft text-accent-ink",
} as const;

/** A message banner. `danger` is announced immediately (role=alert); the rest politely. */
export function Alert({ tone = "danger", children, className = "" }: {
  tone?: keyof typeof ALERT; children: ReactNode; className?: string;
}) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={`rounded-lg border px-3.5 py-2.5 text-sm font-medium ${ALERT[tone]} ${className}`}
    >
      {children}
    </p>
  );
}

/** What a list says when it is empty: what is missing, and what to do next. */
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink-3">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Initials in a tinted circle, so a list of patients scans by face, not by text. */
export function Avatar({ name, size = "md" }: { name: string | null; size?: "sm" | "md" | "lg" }) {
  const initials = (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => [...w][0]?.toUpperCase() ?? "").join("") || "?";
  const dims = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-12 text-base" }[size];
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent-ink ring-1 ring-accent-line/60 ${dims}`}>
      {initials}
    </span>
  );
}
