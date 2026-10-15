import { Skel } from "../_ui";

/** The same header and row geometry as the real queue, so nothing shifts when
 *  the appointments arrive. */
export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading your day" className="space-y-6">
      <Skel className="h-[172px] w-full !rounded-3xl" />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skel className="h-8 w-36" />
          <Skel className="mt-2 h-5 w-72 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skel className="size-9 rounded-lg" />
          <Skel className="h-9 w-16 rounded-lg" />
          <Skel className="size-9 rounded-lg" />
          <Skel className="h-9 w-44 rounded-lg" />
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface px-3 py-3 shadow-card sm:px-5 sm:py-4">
            <Skel className="h-3 w-16" />
            <Skel className="mt-2.5 h-7 w-10" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-6">
        <Skel className="h-5 w-28 rounded-full" />
        <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-4">
          <Skel className="h-9 w-24" />
          <div className="flex min-w-0 flex-1 gap-3">
            <Skel className="size-12 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skel className="h-6 w-56 max-w-full" />
              <Skel className="mt-2.5 h-9 w-full" />
            </div>
          </div>
        </div>
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-start gap-4 px-4 py-4 sm:gap-5 sm:px-5">
            <div className="w-14 shrink-0 sm:w-20">
              <Skel className="h-6 w-14" />
              <Skel className="mt-1.5 h-3 w-12" />
            </div>
            <div className="min-w-0 flex-1 border-l border-line pl-4 sm:pl-5">
              <Skel className="h-5 w-48 max-w-full" />
              <Skel className="mt-2.5 h-4 w-72 max-w-full" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
