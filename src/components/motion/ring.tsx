/**
 * A progress ring showing `value` of `total`. The arc draws itself in from
 * empty with a CSS keyframe (`ring-draw`, globals.css) that starts with the
 * first paint of the server HTML — hydration never resets it — and eases to a
 * new value if the numbers change. The percentage is plain React text. The
 * numbers are also given as text for screen readers.
 */
import type { CSSProperties } from "react";
import { cn } from "@/components/lib/utils";

const WHITE = "var(--color-white)";
const fade = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export function Ring({
  value, total, label, size = 112, stroke = 10, className, track = fade(WHITE, 18), tone = WHITE,
}: {
  value: number; total: number; label: string; size?: number; stroke?: number;
  className?: string; track?: string; tone?: string;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, value / total) : 0;
  const arc: CSSProperties = {
    stroke: tone,
    strokeDasharray: c,
    strokeDashoffset: c * (1 - share),
    ["--ring-empty" as string]: c,
    animation: "ring-draw 1.4s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards",
    transition: "stroke-dashoffset 0.6s ease-out",
    filter: `drop-shadow(0 0 6px ${fade(WHITE, 35)})`,
  };

  return (
    <div className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: track }} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" style={arc} />
      </svg>
      <div className="relative text-center leading-tight">
        <span aria-hidden="true" className="block text-2xl font-semibold tabular-nums">
          {Math.round(share * 100)}%
        </span>
        <span aria-hidden="true" className="block text-[11px] font-medium opacity-80">{label}</span>
        <span className="sr-only">{label}: {value} of {total}</span>
      </div>
    </div>
  );
}
