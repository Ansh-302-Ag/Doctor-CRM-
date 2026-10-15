"use client";

/**
 * Lightswind UI "count-up" (lightswind.com), trimmed to what the CRM uses and
 * recoloured to our tokens. Counts from 0 to `value` once, when first visible.
 * Reduced-motion users see the final number straight away.
 */
import { useEffect, useRef } from "react";
import { animate, useMotionValue, useTransform, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/lib/utils";

export function CountUp({
  value, duration = 0.9, className,
}: { value: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const count = useMotionValue(reduce ? value : 0);
  const shown = useTransform(count, v => Math.round(v).toLocaleString("en-IN"));

  useEffect(() => {
    if (reduce) { count.set(value); return; }
    let controls: { stop: () => void } | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      controls = animate(count, value, { duration, ease: [0, 0, 0.58, 1] });
      io.disconnect();
    }, { threshold: 0.1 });
    if (ref.current) io.observe(ref.current);
    return () => { controls?.stop(); io.disconnect(); };
  }, [value, duration, reduce, count]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      <motion.span aria-hidden="true">{shown}</motion.span>
      {/* The animated digits are decoration; a screen reader hears the value once. */}
      <span className="sr-only">{value}</span>
    </span>
  );
}
