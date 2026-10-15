"use client";

/**
 * Lightswind UI "border-beam" (lightswind.com), recoloured to the clinic accent.
 * A light travelling round the border of its parent, which must be
 * `relative` and rounded. Used sparingly: it marks "this one is next".
 * Hidden for reduced-motion users by CSS (motion-reduce:hidden), not by a
 * hook: the server cannot know the preference, so a hook would make the first
 * client render differ from the HTML and fail hydration.
 */
import { motion } from "framer-motion";
import { cn } from "@/components/lib/utils";

export function BorderBeam({
  size = 80, duration = 7, className,
  colorFrom = "var(--color-accent)", colorTo = "var(--color-accent-line)",
}: { size?: number; duration?: number; className?: string; colorFrom?: string; colorTo?: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] motion-reduce:hidden border-[1.5px] border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]"
    >
      <motion.div
        className={cn("absolute aspect-square bg-gradient-to-l from-[var(--beam-from)] via-[var(--beam-to)] to-transparent", className)}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          ["--beam-from" as string]: colorFrom,
          ["--beam-to" as string]: colorTo,
        }}
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: ["0%", "100%"] }}
        transition={{ repeat: Infinity, ease: "linear", duration }}
      />
    </div>
  );
}
