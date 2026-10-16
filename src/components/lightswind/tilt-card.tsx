"use client";

/**
 * Lightswind UI "interactive-card" (lightswind.com), recoloured to our tokens
 * and trimmed: the card tips toward the pointer in 3D and a soft accent light
 * follows it across the face. Children are server-rendered as usual.
 *
 * The pointer only writes four CSS variables; a CSS transition does the
 * easing. Reduced-motion users and touch screens get a flat card (same
 * markup, the pointer is simply ignored), and nothing inside depends on it.
 * The 3D layer (preserve-3d, will-change) exists only while hovered, so text
 * is not left on a blurry composited layer at rest.
 */
import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/components/lib/utils";

export function TiltCard({
  children, className, max = 8,
}: { children: ReactNode; className?: string; max?: number }) {
  const set = (el: HTMLElement, x: number, y: number) => {
    el.style.setProperty("--rx", `${(0.5 - y) * 2 * max}deg`);
    el.style.setProperty("--ry", `${(x - 0.5) * 2 * max}deg`);
    el.style.setProperty("--lx", `${x * 100}%`);
    el.style.setProperty("--ly", `${y * 100}%`);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const b = e.currentTarget.getBoundingClientRect();
    set(e.currentTarget, (e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
  };

  return (
    <div className="[perspective:900px]">
      <div
        onPointerMove={move}
        onPointerLeave={e => set(e.currentTarget, 0.5, 0.5)}
        // Inline so a caller's transition class (e.g. transition-shadow) cannot
        // drop the transform easing.
        style={{ transition: "transform 200ms ease-out, box-shadow 150ms ease" }}
        className={cn(
          "group/tilt relative [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))]",
          "motion-safe:hover:[transform-style:preserve-3d] motion-safe:hover:will-change-transform",
          className,
        )}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] opacity-0 transition-opacity duration-300 bg-[radial-gradient(260px_circle_at_var(--lx,50%)_var(--ly,50%),color-mix(in_srgb,var(--color-accent-2)_18%,transparent),transparent_70%)] motion-safe:group-hover/tilt:opacity-100"
        />
        <div className="relative z-10 h-full motion-safe:group-hover/tilt:[transform:translateZ(20px)]">{children}</div>
      </div>
    </div>
  );
}
