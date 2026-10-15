"use client";

/**
 * One bar split into coloured parts that slide open from the left (anime.js),
 * with a legend underneath that repeats every number as text.
 */
import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";

export type Part = { label: string; value: number; className: string };

export function SplitBar({ parts, label }: { parts: Part[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const total = parts.reduce((n, p) => n + p.value, 0);
  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = animate(root.querySelectorAll("[data-part]"), {
      scaleX: [0, 1], duration: 800, delay: stagger(120, { start: 150 }), ease: "outExpo",
    });
    return () => { a.revert(); };
  }, [total]);
  return (
    <div>
      <div ref={ref} aria-hidden="true" className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-line">
        {total > 0 && parts.filter(p => p.value > 0).map(p => (
          <span key={p.label} data-part className={`h-full origin-left ${p.className}`} style={{ flexGrow: p.value }} />
        ))}
      </div>
      <p className="sr-only">{label}: {parts.map(p => `${p.label} ${p.value}`).join(", ")}</p>
    </div>
  );
}
