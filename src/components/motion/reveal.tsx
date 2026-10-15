"use client";

/**
 * Entrance motion with anime.js: the direct children (or the elements matching
 * `selector`) fade and rise in, one after another. Content is visible without
 * JavaScript and for reduced-motion users — the animation only runs from an
 * offset back to rest, never hides anything permanently.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { animate, stagger } from "animejs";

export function Reveal({
  children, className, selector = ":scope > *", delay = 0, step = 45, as: Tag = "div",
}: {
  children: ReactNode; className?: string; selector?: string;
  delay?: number; step?: number; as?: "div" | "ul" | "ol" | "section" | "tbody";
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = [...root.querySelectorAll<HTMLElement>(selector)].slice(0, 30);
    if (targets.length === 0) return;
    const a = animate(targets, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 420,
      delay: stagger(step, { start: delay }),
      ease: "outQuad",
    });
    return () => { a.revert(); };
  }, [selector, delay, step]);

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={className}>
      {children}
    </Tag>
  );
}
