"use client";

/**
 * Lightswind UI "beam-circle" (lightswind.com), recoloured for the sign-in
 * panel: the clinic's mark at the centre, and what the product does — chat,
 * calendar, records, safety — circling it on dashed orbits. Decoration only.
 */
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

export type Orbit = { radius: number; seconds: number; icon: ReactNode; start?: number };

export function OrbitRings({
  size = 340, orbits, center,
}: { size?: number; orbits: Orbit[]; center: ReactNode }) {
  const reduce = useReducedMotion();
  const half = size / 2;
  return (
    <div aria-hidden="true" className="relative" style={{ width: size, height: size }}>
      {orbits.map((o, i) => (
        <div key={i}>
          <div
            className="absolute rounded-full border border-dashed border-white/25"
            style={{ width: o.radius * 2, height: o.radius * 2, top: half - o.radius, left: half - o.radius }}
          />
          <motion.div
            className="absolute inset-0"
            initial={{ rotate: o.start ?? i * 70 }}
            animate={reduce ? undefined : { rotate: (o.start ?? i * 70) + 360 }}
            transition={{ repeat: Infinity, duration: o.seconds, ease: "linear" }}
          >
            <div className="absolute" style={{ top: half, left: half + o.radius, transform: "translate(-50%, -50%)" }}>
              <motion.div
                className="grid size-10 place-items-center rounded-xl bg-white/12 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-md"
                initial={{ rotate: -(o.start ?? i * 70) }}
                animate={reduce ? undefined : { rotate: -(o.start ?? i * 70) - 360 }}
                transition={{ repeat: Infinity, duration: o.seconds, ease: "linear" }}
              >
                {o.icon}
              </motion.div>
            </div>
          </motion.div>
        </div>
      ))}
      <div className="absolute inset-0 grid place-items-center">{center}</div>
    </div>
  );
}
