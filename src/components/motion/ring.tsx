"use client";

/**
 * A progress ring that draws itself (anime.js) from empty to `value` of
 * `total`, with the percentage counting up in the middle. The numbers are
 * also given as text for screen readers.
 */
import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { cn } from "@/components/lib/utils";

export function Ring({
  value, total, label, size = 112, stroke = 10, className, track = "rgb(255 255 255 / 0.18)", tone = "white",
}: {
  value: number; total: number; label: string; size?: number; stroke?: number;
  className?: string; track?: string; tone?: string;
}) {
  const arc = useRef<SVGCircleElement>(null);
  const pct = useRef<HTMLSpanElement>(null);
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, value / total) : 0;

  useEffect(() => {
    const el = arc.current, out = pct.current;
    if (!el || !out) return;
    const end = c * (1 - share);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.strokeDashoffset = String(end);
      out.textContent = `${Math.round(share * 100)}%`;
      return;
    }
    const n = { v: 0 };
    const a = animate(el, { strokeDashoffset: [c, end], duration: 1400, ease: "outExpo", delay: 200 });
    const b = animate(n, {
      v: share * 100, duration: 1400, delay: 200, ease: "outExpo",
      onUpdate: () => { out.textContent = `${Math.round(n.v)}%`; },
    });
    return () => { a.revert(); b.revert(); };
  }, [c, share]);

  return (
    <div className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          ref={arc} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - share)}
          style={{ filter: "drop-shadow(0 0 6px rgb(255 255 255 / 0.35))" }}
        />
      </svg>
      <div className="relative text-center leading-tight">
        <span ref={pct} aria-hidden="true" className="block text-2xl font-semibold tabular-nums">
          {Math.round(share * 100)}%
        </span>
        <span aria-hidden="true" className="block text-[11px] font-medium opacity-80">{label}</span>
        <span className="sr-only">{label}: {value} of {total}</span>
      </div>
    </div>
  );
}
