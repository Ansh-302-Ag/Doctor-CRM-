/**
 * A number tile: label, an animated count (Lightswind count-up), and a 3D tilt
 * with a light that follows the pointer (Lightswind interactive-card). The
 * coloured edge says which status it counts, the label says it in words.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CountUp } from "@/components/lightswind/count-up";
import { TiltCard } from "@/components/lightswind/tilt-card";

const TONE = {
  accent: { bar: "from-accent-2 to-accent", icon: "bg-accent-soft text-accent ring-accent-line/60" },
  ok: { bar: "from-ok to-accent-2", icon: "bg-ok-soft text-ok ring-ok-line/60" },
  warn: { bar: "from-warn to-warn-line", icon: "bg-warn-soft text-warn ring-warn-line/60" },
  danger: { bar: "from-danger to-danger-line", icon: "bg-danger-soft text-danger ring-danger-line/60" },
  neutral: { bar: "from-ink-3 to-line-strong", icon: "bg-subtle text-ink-3 ring-line" },
  sky: { bar: "from-sky to-iris", icon: "bg-sky-soft text-sky ring-sky/20" },
} as const;

export function StatTile({
  label, value, icon: Icon, tone = "accent", hint, children,
}: {
  label: string; value?: number; icon?: LucideIcon; tone?: keyof typeof TONE;
  hint?: ReactNode; children?: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <TiltCard className="h-full rounded-2xl border border-line bg-surface shadow-card transition-shadow hover:shadow-lift">
      <div className="relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4">
        <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.bar}`} />
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold tracking-wide text-ink-3">{label}</p>
          {Icon && (
            <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-xl ring-1 ${t.icon}`}>
              <Icon className="size-4" />
            </span>
          )}
        </div>
        <div className="mt-auto pt-2">
          {value !== undefined
            ? <CountUp value={value} className="block text-[28px] font-semibold leading-none text-ink" />
            : children}
          {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
        </div>
      </div>
    </TiltCard>
  );
}
