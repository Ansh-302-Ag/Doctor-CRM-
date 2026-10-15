/**
 * The banner at the top of the day screens (calendar, My day, board): a deep
 * teal panel with an aurora wash (Lightswind "aurora-background", in CSS), a
 * 3D canvas scene, a typed greeting and the clinic clock. `children` is the
 * right-hand side — rings, charts — so each screen shows its own numbers.
 *
 * Everything moving here is decoration; every number it shows is also on the
 * page below as plain text.
 */
import type { ReactNode } from "react";
import { Scene3D } from "@/components/three/scene";
import { TypingText } from "@/components/lightswind/typing-text";
import { Clock } from "@/components/motion/clock";

export function greeting(timeZone: string, now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Hero({
  eyebrow, title, subtitle, timeZone, scene = "helix", children,
}: {
  eyebrow: ReactNode; title: string; subtitle?: ReactNode; timeZone: string;
  scene?: "helix" | "sphere"; children?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl bg-deep text-white shadow-[0_24px_48px_-24px_rgb(6_43_42/0.6)]">
      {/* Aurora: three blurred colour fields drifting slowly. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-1/4 -top-1/2 h-[140%] w-3/4 animate-aurora rounded-full bg-accent-2/45 blur-3xl" />
        <div className="absolute -bottom-1/2 left-1/3 h-[120%] w-1/2 animate-aurora rounded-full bg-sky/40 blur-3xl [animation-delay:-6s]" />
        <div className="absolute -right-1/4 -top-1/3 h-full w-1/2 animate-aurora rounded-full bg-iris/30 blur-3xl [animation-delay:-12s]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.08)_1px,transparent_0)] bg-[length:20px_20px]" />
      </div>

      <div aria-hidden="true" className="absolute inset-y-0 right-[22%] -z-10 hidden w-[40%] opacity-80 md:block">
        <Scene3D variant={scene} />
      </div>

      <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-white/75">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-2 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-white" />
            </span>
            {eyebrow}
            <span aria-hidden="true">·</span>
            <Clock timeZone={timeZone} className="font-semibold tabular-nums text-white" />
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <TypingText text={title} />
          </h2>
          {subtitle && <div className="mt-2 max-w-xl text-sm text-white/80">{subtitle}</div>}
        </div>
        {children && (
          <div className="flex shrink-0 flex-wrap items-center gap-5 rounded-2xl bg-deep/40 p-4 ring-1 ring-white/10 backdrop-blur-md">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

/** A frosted chip for the hero: a label and a number. */
export function HeroStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15 backdrop-blur-md">
      <p className="text-[11px] font-medium uppercase tracking-wider text-white/70">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums leading-none">{value}</p>
    </div>
  );
}
