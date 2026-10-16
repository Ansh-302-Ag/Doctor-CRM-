/**
 * Lightswind UI "shiny-text" (lightswind.com), as CSS rather than a framer
 * loop: a band of light passes over the text every few seconds. The text is
 * clipped to the gradient, so the text keeps a solid `base` colour between passes.
 */
import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils";

export function ShinyText({
  children, className, speed = 4, base = "var(--color-ink)",
}: { children: ReactNode; className?: string; speed?: number; base?: string }) {
  return (
    <span
      className={cn(
        "animate-[shimmer_var(--shiny-speed)_linear_infinite] bg-[length:250%_100%] bg-clip-text text-transparent",
        "bg-[linear-gradient(110deg,var(--shiny-base)_35%,color-mix(in_srgb,var(--color-white)_95%,transparent)_50%,var(--shiny-base)_65%)]",
        className,
      )}
      style={{ ["--shiny-speed" as string]: `${speed}s`, ["--shiny-base" as string]: base }}
    >
      {children}
    </span>
  );
}
