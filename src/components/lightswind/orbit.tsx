/**
 * Lightswind UI "beam-circle" (lightswind.com), recoloured for the sign-in
 * panel: the clinic's mark at the centre, and what the product does — chat,
 * calendar, records, safety — circling it on dashed orbits. Decoration only.
 * Plain CSS keyframes (`orbit`, `orbit-back` in globals.css); mounted through
 * LazyOrbits, so it only runs where it is seen.
 */
import type { CSSProperties, ReactNode } from "react";

export type Orbit = { radius: number; seconds: number; icon: ReactNode; start?: number };

export function OrbitRings({
  size = 340, orbits, center,
}: { size?: number; orbits: Orbit[]; center: ReactNode }) {
  const half = size / 2;
  return (
    <div aria-hidden="true" className="relative" style={{ width: size, height: size }}>
      {orbits.map((o, i) => {
        // The arm turns one way and the icon the other, so the icon stays upright.
        const spin = (name: string): CSSProperties => ({
          ["--from" as string]: `${o.start ?? i * 70}deg`,
          animation: `${name} ${o.seconds}s linear infinite`,
        });
        return (
          <div key={i}>
            <div
              className="absolute rounded-full border border-dashed border-white/25"
              style={{ width: o.radius * 2, height: o.radius * 2, top: half - o.radius, left: half - o.radius }}
            />
            <div className="absolute inset-0" style={spin("orbit")}>
              <div className="absolute" style={{ top: half, left: half + o.radius, transform: "translate(-50%, -50%)" }}>
                <div
                  className="grid size-10 place-items-center rounded-xl bg-white/12 text-white shadow-lg ring-1 ring-white/25 backdrop-blur-md"
                  style={spin("orbit-back")}
                >
                  {o.icon}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div className="absolute inset-0 grid place-items-center">{center}</div>
    </div>
  );
}
