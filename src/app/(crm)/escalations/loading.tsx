import { Skel } from "../_ui";

export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading escalations">
      <Skel className="h-7 w-40" />
      <Skel className="mt-2 h-5 w-full max-w-lg" />

      <div className="mt-6">
        <Skel className="h-4 w-56" />
        <div className="mt-3 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Skel className="h-6 w-48" />
                <Skel className="h-10 w-52" />
              </div>
              <Skel className="mt-4 h-4 w-full max-w-2xl" />
              <Skel className="mt-2 h-3 w-72" />
              <div className="mt-4 flex gap-2">
                <Skel className="h-9 w-40" />
                <Skel className="h-9 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
