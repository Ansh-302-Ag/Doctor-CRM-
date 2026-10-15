/**
 * Plain HTML/CSS charts for the insights page — no chart library, no client JS.
 * The drawn chart is decoration for sighted readers (aria-hidden); each chart
 * carries a one-line text summary and a "View as table" twin with every value.
 * Single series, so one colour (accent) and no legend box; hover shows a CSS tooltip.
 */
import type { ReactNode } from "react";
import { th, td } from "../_ui";

/** Round the axis top up to a clean number: 4 → 4, 7 → 8, 13 → 15, 42 → 50. */
const niceTop = (max: number) => {
  if (max <= 4) return Math.max(max, 1);
  const step = 10 ** Math.floor(Math.log10(max));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * step).find(v => v >= max)!;
};

type Bar = { key: string; label: string; tip: string; value: number };

function TableTwin({ head, rows }: { head: [string, string]; rows: Bar[] }) {
  return (
    <details className="group mt-3 text-sm">
      <summary className="cursor-pointer select-none text-xs font-medium text-accent hover:text-accent-hover">
        View as table
      </summary>
      <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line">
        <table className="w-full">
          <thead className="sticky top-0 bg-subtle">
            <tr><th scope="col" className={th}>{head[0]}</th><th scope="col" className={`${th} text-right`}>{head[1]}</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-line last:border-0">
                <td className={`${td} !py-1.5`}>{r.tip}</td>
                <td className={`${td} !py-1.5 text-right tabular-nums`}>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Vertical bars on one baseline. `ticks` are the x-axis labels to show by index. */
export function ColumnChart({
  bars, summary, head, ticks, peakLabel = false,
}: { bars: Bar[]; summary: ReactNode; head: [string, string]; ticks: number[]; peakLabel?: boolean }) {
  const max = Math.max(0, ...bars.map(b => b.value));
  const top = niceTop(max);
  const peak = bars.findIndex(b => b.value === max && max > 0);
  const dense = bars.length > 31;
  return (
    <figure>
      <div aria-hidden="true" className="flex gap-2">
        {/* y axis: top tick and baseline only — the table carries the rest */}
        <div className="flex h-40 w-6 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums leading-none text-ink-3">
          <span className="-translate-y-1/2">{top}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-40 border-b border-line-strong">
            <div className="absolute inset-x-0 top-0 border-t border-line" />
            <div className="absolute inset-x-0 top-1/2 border-t border-line" />
            <div className={`absolute inset-0 flex items-end ${dense ? "gap-px" : "gap-0.5"}`}>
              {bars.map((b, i) => (
                <div key={b.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center hover:bg-subtle">
                  {b.value > 0 && (
                    <div
                      className="relative w-full max-w-6 rounded-t bg-accent transition-colors group-hover:bg-accent-hover"
                      style={{ height: `${(b.value / top) * 100}%` }}
                    >
                      {peakLabel && i === peak && (
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-semibold tabular-nums text-ink">
                          {b.value}
                        </span>
                      )}
                    </div>
                  )}
                  <span
                    className={`pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink shadow-pop group-hover:block ${i < bars.length / 2 ? "left-0" : "right-0"}`}
                  >
                    {b.tip}: <span className="font-semibold tabular-nums">{b.value}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className={`mt-1.5 flex text-[11px] text-ink-3 ${dense ? "gap-px" : "gap-0.5"}`}>
            {bars.map((b, i) => (
              <span key={b.key} className="relative min-w-0 flex-1 text-center">
                {ticks.includes(i) && (
                  <span className={`absolute whitespace-nowrap ${bars.length <= 12 ? "left-1/2 -translate-x-1/2" : i === 0 ? "left-0" : i === bars.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
                    {b.label}
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="h-3.5" />
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-ink-2">{summary}</figcaption>
      <TableTwin head={head} rows={bars} />
    </figure>
  );
}

/** Part of a whole with two parts: a meter — the AI share filled in accent,
 *  the rest a lighter step of the same ramp, a 2px surface gap between them. */
export function SplitBar({ ai, staff }: { ai: number; staff: number }) {
  const total = ai + staff;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const parts = [
    { label: "AI assistant", hint: "WhatsApp and voice", n: ai, swatch: "bg-accent" },
    { label: "Staff", hint: "Front desk and doctors", n: staff, swatch: "bg-accent-line" },
  ];
  return (
    <figure>
      <div aria-hidden="true" className="flex h-3 gap-0.5 overflow-hidden rounded bg-subtle">
        {total > 0 && parts.filter(p => p.n > 0).map(p => (
          <div key={p.label} className={`${p.swatch} h-full`} style={{ width: `${(p.n / total) * 100}%` }} />
        ))}
      </div>
      <figcaption className="sr-only">
        {total === 0 ? "No bookings were made in this period." :
          `${ai} of ${total} bookings (${pct(ai)}%) were made by the AI assistant, ${staff} (${pct(staff)}%) by staff.`}
      </figcaption>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {parts.map(p => (
          <div key={p.label} className="flex items-start gap-2.5">
            <span aria-hidden="true" className={`mt-1 size-2.5 shrink-0 rounded-sm ${p.swatch}`} />
            <div className="min-w-0">
              <dt className="text-sm font-medium text-ink">{p.label}</dt>
              <dd className="text-xs text-ink-3">{p.hint}</dd>
              <dd className="mt-0.5 text-sm text-ink-2">
                <span className="font-semibold tabular-nums text-ink">{p.n}</span> bookings · {pct(p.n)}%
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </figure>
  );
}
