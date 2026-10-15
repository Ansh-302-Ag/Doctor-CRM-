import { Skel } from "../../_ui";

/** Same shape as the record: header, four tiles, the tab bar, the activity feed. */
export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading patient record">
      <div className="mb-6">
        <Skel className="h-4 w-24" />
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skel className="size-12 rounded-full" />
            <div>
              <Skel className="h-7 w-52" />
              <Skel className="mt-2 h-4 w-32" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skel className="h-9 w-40 rounded-lg" />
            <Skel className="h-9 w-48 rounded-lg" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] rounded-2xl border border-line bg-surface p-4 shadow-card">
            <Skel className="h-3 w-24" />
            <Skel className="mt-3 h-6 w-20" />
          </div>
        ))}
      </div>

      <Skel className="mt-6 h-10 w-full max-w-md rounded-xl" />

      <div className="mt-4 rounded-2xl border border-line bg-surface shadow-card">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <Skel className="h-4 w-20" />
          <Skel className="mt-1.5 h-3 w-64 max-w-full" />
        </div>
        <div className="px-4 py-2 sm:px-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 py-3">
              <Skel className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skel className="h-3 w-48 max-w-full" />
                <Skel className="mt-2 h-4 w-80 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
