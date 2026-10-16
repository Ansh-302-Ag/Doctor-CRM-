/**
 * Entrance motion: the direct children fade and rise in, one after another.
 * Pure CSS (`.reveal` in globals.css): the keyframe starts with the first
 * paint of the server HTML, so hydration never hides content already on
 * screen; `backwards` fill leaves nothing behind, and the global
 * reduced-motion rule covers it. `delay` and `step` are in milliseconds.
 */
import type { CSSProperties, ReactNode } from "react";

export function Reveal({
  children, className, delay = 0, step = 45, as: Tag = "div",
}: {
  children: ReactNode; className?: string;
  delay?: number; step?: number; as?: "div" | "ul" | "ol" | "section" | "tbody";
}) {
  const style = { "--reveal-delay": `${delay}ms`, "--reveal-step": `${step}ms` } as CSSProperties;
  return <Tag className={`reveal ${className ?? ""}`} style={style}>{children}</Tag>;
}
