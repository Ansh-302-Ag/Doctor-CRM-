/**
 * Lightswind UI "typing-text" (lightswind.com), as CSS: the line types itself
 * in, one character after another, once. The text is in the server HTML at
 * full opacity under `prefers-reduced-motion` and if no script ever runs —
 * the keyframes only play from blurred/transparent back to rest. Characters
 * are grouped per word so a line never wraps mid-word.
 */
import { cn } from "@/components/lib/utils";

export function TypingText({
  text, className, delay = 0, duration = 0.9,
}: { text: string; className?: string; delay?: number; duration?: number }) {
  const step = (duration * 1000) / Math.max(1, text.length);
  // Each piece keeps the index of its first character, for the delay.
  const pieces = text.split(/(\s+)/).filter(Boolean).reduce<{ s: string; at: number }[]>(
    (out, s) => [...out, { s, at: out.length ? out.at(-1)!.at + out.at(-1)!.s.length : 0 }], []);
  return (
    <span className={cn("inline", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {pieces.map(({ s, at }) => /^\s*$/.test(s) ? <span key={at}>{s}</span> : (
          <span key={at} className="inline-block whitespace-nowrap">
            {[...s].map((c, k) => (
              <span
                key={k}
                className="inline-block animate-[type-in_0.3s_ease-out_both]"
                style={{ animationDelay: `${delay * 1000 + (at + k) * step}ms` }}
              >
                {c}
              </span>
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}
