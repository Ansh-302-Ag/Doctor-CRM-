import { Skel } from "../_ui";

export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading escalations" className="space-y-6">
      <div>
        <Skel className="h-8 w-44" />
        <Skel className="mt-2 h-5 w-full max-w-lg" />
      </div>

      <div>
        <Skel className="h-4 w-56" />
        <div className="mt-3 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Skel className="size-9 rounded-full" />
                  <Skel className="h-5 w-44" />
                </div>
                <Skel className="h-9 w-48" />
              </div>
              <Skel className="mt-4 h-9 w-full max-w-2xl" />
              <Skel className="mt-3 h-4 w-40" />
              <div className="mt-4 flex gap-2 border-t border-line pt-3">
                <Skel className="h-7 w-32" />
                <Skel className="h-7 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
