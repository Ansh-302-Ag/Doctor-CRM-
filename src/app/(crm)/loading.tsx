import { Card, Skel } from "./_ui";

/** Navigation blocks on a database a continent away. This holds the calendar's
 *  shape — header, toolbar, stat tiles, schedule rows — so the page fills in
 *  rather than jumps. */
export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading appointments" className="space-y-6">
      <Skel className="h-[172px] w-full !rounded-3xl" />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skel className="h-8 w-44" />
          <Skel className="mt-2 h-5 w-72 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skel className="h-9 w-44 rounded-lg" />
          <Skel className="h-9 w-40 rounded-lg" />
        </div>
      </header>

      <Card bodyClassName="flex flex-wrap items-center gap-x-4 gap-y-3 p-3 sm:px-4">
        <Skel className="h-9 w-36 rounded-lg" />
        <Skel className="h-9 w-48 rounded-lg" />
        <Skel className="h-9 w-48 rounded-lg" />
        <Skel className="ml-auto h-9 w-28 rounded-lg" />
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-card">
            <Skel className="h-3 w-20" />
            <Skel className="mt-2 h-6 w-10" />
          </div>
        ))}
      </div>

      <Card title="Schedule" description="Cancelled appointments stay listed, greyed out." bodyClassName="">
        <ul className="divide-y divide-line">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex gap-3 px-4 py-4 sm:gap-5 sm:px-5">
              <div className="w-14 shrink-0 border-r border-line pr-3 sm:w-16">
                <Skel className="h-5 w-11" />
                <Skel className="mt-1.5 h-3 w-10" />
              </div>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Skel className="size-9 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Skel className="h-4 w-36 max-w-full" />
                  <Skel className="mt-1.5 h-3 w-28" />
                </div>
                <Skel className="hidden h-4 w-28 md:block" />
                <Skel className="h-5 w-16 rounded-full" />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
