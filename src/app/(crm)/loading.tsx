import { Skel } from "./_ui";

/** Navigation blocks on a database a continent away. These placeholders hold
 *  the exact shape of the calendar so the page fills in rather than jumps. */
export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading appointments">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skel className="h-7 w-44" />
          <Skel className="mt-2 h-5 w-72" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skel className="size-9" />
          <Skel className="h-9 w-20" />
          <Skel className="size-9" />
          <Skel className="h-9 w-44" />
        </div>
      </header>

      <div className="mt-5 rounded-lg border border-line bg-surface">
        <div className="h-[41px] border-b border-line bg-subtle" />
        <div className="divide-y divide-line">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="w-20 shrink-0">
                <Skel className="h-5 w-14" />
                <Skel className="mt-1.5 h-3 w-16" />
              </div>
              <div className="min-w-0 flex-1">
                <Skel className="h-4 w-40" />
                <Skel className="mt-1.5 h-3 w-28" />
              </div>
              <Skel className="h-4 w-24 shrink-0" />
              <Skel className="h-4 w-40 shrink-0" />
              <Skel className="h-5 w-20 shrink-0 rounded-full" />
              <Skel className="h-5 w-28 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
