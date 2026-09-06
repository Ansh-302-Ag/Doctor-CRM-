import { Skel } from "../_ui";

export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading patients">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skel className="h-7 w-32" />
          <Skel className="mt-2 h-5 w-28" />
        </div>
        <div className="flex items-center gap-2">
          <Skel className="h-10 w-72" />
          <Skel className="h-10 w-24" />
        </div>
      </header>

      <div className="mt-5 rounded-lg border border-line bg-surface">
        <div className="h-[41px] border-b border-line bg-subtle" />
        <div className="divide-y divide-line">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skel className="h-4 w-44 shrink-0" />
              <Skel className="h-4 w-32 shrink-0" />
              <Skel className="h-5 w-20 shrink-0 rounded-full" />
              <Skel className="h-4 w-40 shrink-0" />
              <Skel className="ml-auto h-4 w-8 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
