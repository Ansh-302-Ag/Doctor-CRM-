/**
 * A small column chart that grows in, staggered from the left: the `grow-y`
 * CSS keyframe from the first paint, so hydration never resets a drawn chart.
 * Each column carries its own value as text, so the chart is readable
 * without the animation and without colour.
 */
import { cn } from "@/components/lib/utils";

export type Bar = { label: string; value: number; highlight?: boolean };

export function Bars({
  data, className, label, height = 72,
}: { data: Bar[]; className?: string; label: string; height?: number }) {
  const max = Math.max(1, ...data.map(d => d.value));

  return (
    <figure className={cn("min-w-0", className)}>
      <div role="list" aria-label={label} className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => (
          <div key={d.label} role="listitem" className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <span className="sr-only">{d.label}: {d.value}</span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-white/90 px-1 text-[10px] font-semibold tabular-nums text-accent-ink opacity-0 transition-opacity group-hover:opacity-100"
            >
              {d.value}
            </span>
            <div
              aria-hidden="true"
              className={cn(
                "origin-bottom rounded-t-[4px] transition-colors",
                d.highlight ? "bg-white" : "bg-white/35 group-hover:bg-white/60",
              )}
              style={{
                height: `${Math.max(d.value > 0 ? 8 : 3, (d.value / max) * 100)}%`,
                animation: `grow-y 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) ${250 + i * 45}ms backwards`,
              }}
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
