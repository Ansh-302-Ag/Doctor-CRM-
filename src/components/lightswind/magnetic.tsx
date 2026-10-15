"use client";

/**
 * Lightswind UI "magnetic-button" (lightswind.com), as a wrapper: whatever is
 * inside (a <Link> styled as a button) leans toward the pointer when it comes
 * near, and springs back when it leaves. Mouse only; nothing for touch or
 * reduced motion.
 */
import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/components/lib/utils";

export function Magnetic({
  children, className, strength = 0.25,
}: { children: ReactNode; className?: string; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 220, damping: 16, mass: 0.5 });
  const y = useSpring(0, { stiffness: 220, damping: 16, mass: 0.5 });
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      ref={ref}
      className={cn("inline-flex", className)}
      style={{ x, y }}
      onPointerMove={e => {
        if (e.pointerType !== "mouse") return;
        const b = ref.current!.getBoundingClientRect();
        x.set((e.clientX - (b.left + b.width / 2)) * strength);
        y.set((e.clientY - (b.top + b.height / 2)) * strength);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.div>
  );
}
