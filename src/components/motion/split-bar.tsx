/**
 * One bar split into coloured parts that slide open from the left (the
 * `grow-x` CSS keyframe, staggered; it starts with the first paint, so
 * hydration never resets it), with a legend underneath that repeats every
 * number as text.
 */
export type Part = { label: string; value: number; className: string };

export function SplitBar({ parts, label }: { parts: Part[]; label: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div>
      <div aria-hidden="true" className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-line">
        {total > 0 && parts.filter(p => p.value > 0).map((p, i) => (
          <span
            key={p.label}
            className={`h-full origin-left ${p.className}`}
            style={{ flexGrow: p.value, animation: `grow-x 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${150 + i * 120}ms backwards` }}
          />
        ))}
      </div>
      <p className="sr-only">{label}: {parts.map(p => `${p.label} ${p.value}`).join(", ")}</p>
    </div>
  );
}
