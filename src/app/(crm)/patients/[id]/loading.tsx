import { Skel } from "../../_ui";

export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading patient record">
      <Skel className="h-5 w-28" />

      <div className="mt-3 rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Skel className="h-7 w-52" />
            <Skel className="mt-2 h-5 w-36" />
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <Skel className="h-3 w-24" />
                <Skel className="mt-2 h-5 w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <div>
            <Skel className="h-4 w-32" />
            <div className="mt-2 rounded-lg border border-line bg-surface">
              <div className="h-[41px] border-b border-line bg-subtle" />
              <div className="divide-y divide-line">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3">
                    <Skel className="h-4 w-40 shrink-0" />
                    <Skel className="h-4 w-24 shrink-0" />
                    <Skel className="h-5 w-20 shrink-0 rounded-full" />
                    <Skel className="h-4 w-36 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <Skel className="h-4 w-32" />
            <Skel className="mt-2 h-5 w-full max-w-xl" />
            <div className="mt-3 space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-line bg-surface p-4">
                  <Skel className="h-5 w-56" />
                  <Skel className="mt-2 h-3 w-72" />
                  <Skel className="mt-3 h-9 w-28" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3"><Skel className="h-5 w-36" /></div>
          <div className="space-y-4 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skel className="h-3 w-24" />
                <Skel className="mt-2 h-10 w-full" />
              </div>
            ))}
            <Skel className="h-10 w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
