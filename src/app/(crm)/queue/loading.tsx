import { Skel } from "../_ui";

/** The same header and row geometry as the real queue, so nothing shifts when
 *  the appointments arrive. */
export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading your day">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skel className="h-7 w-36" />
          <Skel className="mt-2 h-5 w-72" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skel className="size-9" />
          <Skel className="h-9 w-20" />
          <Skel className="size-9" />
          <Skel className="h-9 w-44" />
        </div>
      </header>

      <Skel className="mt-3 h-5 w-96 max-w-full" />

      <ul className="mt-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="rounded-lg border border-line bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div className="w-24 shrink-0">
                <Skel className="h-6 w-16" />
                <Skel className="mt-1.5 h-3 w-14" />
              </div>
              <div className="min-w-0 flex-1">
                <Skel className="h-6 w-56" />
                <Skel className="mt-2.5 h-4 w-72 max-w-full" />
              </div>
              <Skel className="h-[38px] w-52" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
