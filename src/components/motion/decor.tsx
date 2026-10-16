"use client";

/**
 * The heavy decorations (the canvas scene, the sign-in orbits), loaded only
 * where they will be seen: a wide enough screen and no reduced-motion
 * preference. Everyone else never downloads or runs them. The server and the
 * first client render both draw nothing, so hydration always agrees; the
 * decoration appears once the media query has been read.
 */
import dynamic from "next/dynamic";
import { useSyncExternalStore, type ComponentProps } from "react";

const Scene = dynamic(() => import("@/components/three/scene").then(m => m.Scene3D), { ssr: false });
const Orbits = dynamic(() => import("@/components/lightswind/orbit").then(m => m.OrbitRings), { ssr: false });

function useMedia(query: string) {
  return useSyncExternalStore(
    change => {
      const m = window.matchMedia(query);
      m.addEventListener("change", change);
      return () => m.removeEventListener("change", change);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const CALM = "(prefers-reduced-motion: no-preference)";

/** md and up: the hero and the sign-in panel only show it there. */
export function LazyScene(props: ComponentProps<typeof Scene>) {
  return useMedia(`(min-width: 768px) and ${CALM}`) ? <Scene {...props} /> : null;
}

/** xl and up: where the sign-in panel has room for it. */
export function LazyOrbits(props: ComponentProps<typeof Orbits>) {
  return useMedia(`(min-width: 1280px) and ${CALM}`) ? <Orbits {...props} /> : null;
}
