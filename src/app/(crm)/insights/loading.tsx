import { Card, Skel } from "../_ui";

/** The insights page's shape — header, tiles, charts — while Neon answers. */
export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading insights" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skel className="h-8 w-36" />
          <Skel className="mt-2 h-5 w-60 max-w-full" />
        </div>
        <Skel className="h-9 w-56 rounded-lg" />
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
            <Skel className="h-3 w-20" />
            <Skel className="mt-2 h-6 w-12" />
            <Skel className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>

      <Card title="Appointments per day">
        <Skel className="h-48 w-full rounded-lg" />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Busiest hours"><Skel className="h-48 w-full rounded-lg" /></Card>
        <Card title="Who booked"><Skel className="h-3 w-full rounded" /><Skel className="mt-4 h-12 w-full rounded-lg" /></Card>
      </div>
    </section>
  );
}
