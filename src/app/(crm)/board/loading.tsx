import { Card, Skel } from "../_ui";

/** Holds the board's shape — header, toolbar, four columns — while the day loads. */
export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading board" className="space-y-6">
      <header>
        <Skel className="h-8 w-44" />
        <Skel className="mt-2 h-5 w-72 max-w-full" />
      </header>

      <Card bodyClassName="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:px-4">
        <Skel className="h-9 w-36 rounded-lg" />
        <Skel className="h-9 w-48 rounded-lg" />
        <Skel className="h-9 w-48 rounded-lg" />
      </Card>

      <div className="-mx-4 overflow-x-hidden px-4 sm:mx-0 sm:px-0">
        <div className="grid auto-cols-[min(18rem,82vw)] grid-flow-col gap-4 lg:auto-cols-auto lg:grid-flow-row lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2.5 rounded-xl border border-line bg-subtle/60 p-2.5">
              <Skel className="mx-1.5 my-1 h-4 w-24" />
              {Array.from({ length: 3 - (i % 2) }).map((_, j) => (
                <div key={j} className="rounded-2xl border border-line bg-surface p-3.5 shadow-card">
                  <Skel className="h-3 w-20" />
                  <div className="mt-2 flex items-center gap-2.5">
                    <Skel className="size-8 rounded-full" />
                    <Skel className="h-4 w-28" />
                  </div>
                  <Skel className="mt-2 h-3 w-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
