"use client";

/**
 * Lightswind UI "interactive-card" (lightswind.com), recoloured to our tokens
 * and trimmed: the card tips toward the pointer in 3D and a soft accent light
 * follows it across the face. Children are server-rendered as usual.
 *
 * The tilt is decoration: reduced-motion users and touch screens get a flat
 * card, and nothing inside depends on it.
 */
import { useRef, type ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/components/lib/utils";

export function TiltCard({
  children, className, max = 8, glow = "rgb(20 163 157 / 0.18)",
}: { children: ReactNode; className?: string; max?: number; glow?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const spring = { stiffness: 220, damping: 22, mass: 0.5 };
  const rotateX = useSpring(useTransform(y, [0, 1], [max, -max]), spring);
  const rotateY = useSpring(useTransform(x, [0, 1], [-max, max]), spring);
  const lx = useTransform(x, v => `${v * 100}%`);
  const ly = useTransform(y, v => `${v * 100}%`);
  const light = useMotionTemplate`radial-gradient(260px circle at ${lx} ${ly}, ${glow}, transparent 70%)`;
  const opacity = useSpring(0, { stiffness: 200, damping: 30 });

  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const b = ref.current?.getBoundingClientRect();
    if (!b) return;
    x.set((e.clientX - b.left) / b.width);
    y.set((e.clientY - b.top) / b.height);
    opacity.set(1);
  };
  const leave = () => { x.set(0.5); y.set(0.5); opacity.set(0); };

  if (reduce) return <div className={cn("relative", className)}>{children}</div>;

  return (
    <div className="[perspective:900px]">
      <motion.div
        ref={ref}
        onPointerMove={move}
        onPointerLeave={leave}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className={cn("relative will-change-transform", className)}
      >
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]"
          style={{ background: light, opacity }}
        />
        <div className="relative z-10 h-full [transform:translateZ(20px)]">{children}</div>
      </motion.div>
    </div>
  );
}
