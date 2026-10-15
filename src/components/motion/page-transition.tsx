"use client";

/**
 * Every CRM page enters the same way (anime.js): a short rise out of a soft
 * blur. Mounted by (crm)/template.tsx, which Next remounts on each navigation.
 * The content is in the DOM and readable from the first paint; the animation
 * only plays from an offset back to rest.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { animate } from "animejs";

export function PageTransition({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = animate(el, {
      opacity: [0, 1],
      translateY: [14, 0],
      filter: ["blur(6px)", "blur(0px)"],
      duration: 520,
      ease: "outExpo",
      // A transform or filter left on the wrapper would become the containing
      // block of every fixed child: hand the element back clean.
      onComplete: self => { self.revert(); },
    });
    return () => { a.revert(); };
  }, []);
  return <div ref={ref}>{children}</div>;
}
