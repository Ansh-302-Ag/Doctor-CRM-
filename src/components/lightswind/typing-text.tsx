"use client";

/**
 * Lightswind UI "typing-text" (lightswind.com), recoloured: the line types
 * itself in, one character after another, once. Screen readers get the whole
 * line at once; reduced-motion users see it already typed.
 */
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/components/lib/utils";

export function TypingText({
  text, className, delay = 0, duration = 0.9,
}: { text: string; className?: string; delay?: number; duration?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{text}</span>;
  const chars = [...text];
  return (
    <span className={cn("inline-block", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {chars.map((c, i) => (
          <motion.span
            key={i}
            className="inline-block whitespace-pre"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: delay + (i * duration) / chars.length, duration: 0.3, ease: "easeOut" }}
          >
            {c}
          </motion.span>
        ))}
      </span>
    </span>
  );
}
