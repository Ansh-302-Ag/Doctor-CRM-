"use client";

/**
 * Lightswind UI "count-up" (lightswind.com), trimmed to what the CRM uses and
 * recoloured to our tokens. Counts from 0 to `value` once, when first visible.
 * The server-rendered HTML already holds the real number, so a slow phone, a
 * script failure or reduced motion never shows a wrong "0" — the count-up is
 * only a flourish started after hydration.
 */
import { useEffect, useRef } from "react";
import { animate, useMotionValue, useTransform, motion, MotionConfig } from "framer-motion";
import { cn } from "@/components/lib/utils";

export function CountUp({
  value, duration = 0.9, className,
}: { value: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const count = useMotionValue(value);
  const shown = useTransform(count, v => Math.round(v).toLocaleString("en-IN"));

  useEffect(() => {
    // Read the preference here, after hydration, never during render.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { count.set(value); return; }
    let controls: { stop: () => void } | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      count.set(0);
      controls = animate(count, value, { duration, ease: [0, 0, 0.58, 1] });
      io.disconnect();
    }, { threshold: 0.1 });
    if (ref.current) io.observe(ref.current);
    return () => { controls?.stop(); io.disconnect(); };
  }, [value, duration, count]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {/* The effect handles reduced motion itself; this stops framer warning about it. */}
      <MotionConfig reducedMotion="never">
        <motion.span aria-hidden="true">{shown}</motion.span>
      </MotionConfig>
      {/* The animated digits are decoration; a screen reader hears the value once. */}
      <span className="sr-only">{value}</span>
    </span>
  );
}
