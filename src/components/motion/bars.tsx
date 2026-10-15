"use client";

/**
 * A small column chart that grows in (anime.js, staggered from the left).
 * Each column carries its own value as text, so the chart is readable
 * without the animation and without colour.
 */
import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import { cn } from "@/components/lib/utils";

export type Bar = { label: string; value: number; highlight?: boolean };

export function Bars({
  data, className, label, height = 72,
}: { data: Bar[]; className?: string; label: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...data.map(d => d.value));

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = animate(root.querySelectorAll("[data-bar]"), {
      scaleY: [0, 1], duration: 900, delay: stagger(45, { start: 250 }), ease: "outElastic(1, .7)",
    });
    return () => { a.revert(); };
  }, [data]);

  return (
    <figure className={cn("min-w-0", className)}>
      <div ref={ref} role="list" aria-label={label} className="flex items-end gap-1" style={{ height }}>
        {data.map(d => (
          <div key={d.label} role="listitem" className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <span className="sr-only">{d.label}: {d.value}</span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-white/90 px-1 text-[10px] font-semibold tabular-nums text-accent-ink opacity-0 transition-opacity group-hover:opacity-100"
            >
              {d.value}
            </span>
            <div
              data-bar
              aria-hidden="true"
              className={cn(
                "origin-bottom rounded-t-[4px] transition-colors",
                d.highlight ? "bg-white" : "bg-white/35 group-hover:bg-white/60",
              )}
              style={{ height: `${Math.max(d.value > 0 ? 8 : 3, (d.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <figcaption aria-hidden="true" className="mt-1.5 flex gap-1 text-[10px] tabular-nums opacity-70">
        {data.map((d, i) => (
          <span key={d.label} className="min-w-0 flex-1 text-center">{i % 2 === 0 ? d.label : ""}</span>
        ))}
      </figcaption>
    </figure>
  );
}
