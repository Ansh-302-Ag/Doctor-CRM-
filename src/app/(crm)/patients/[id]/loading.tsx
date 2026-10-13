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
            {/* Same table and headers as the record, so the columns do not
                shift under the cursor when the rows arrive. */}
            <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle text-left text-xs uppercase tracking-wide whitespace-nowrap text-ink-3">
                    <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Doctor</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Reason (as given)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3"><Skel className="h-4 w-36" /></td>
                      <td className="px-4 py-3"><Skel className="h-4 w-24" /></td>
                      <td className="px-4 py-3"><Skel className="h-5 w-20 rounded-full" /></td>
                      <td className="px-4 py-3"><Skel className="h-4 w-48" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

        {/* The prescription form: one field per row except dosage and duration,
            which share one — same as the real thing. */}
        <div className="rounded-lg border border-line bg-surface lg:self-start">
          <div className="border-b border-line px-4 py-3"><Skel className="h-5 w-36" /></div>
          <div className="space-y-4 p-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i}>
                <Skel className="h-3 w-24" />
                <Skel className="mt-1.5 h-[38px] w-full" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i}>
                  <Skel className="h-3 w-20" />
                  <Skel className="mt-1.5 h-[38px] w-full" />
                </div>
              ))}
            </div>
            <div>
              <Skel className="h-3 w-16" />
              <Skel className="mt-1.5 h-[86px] w-full" />
            </div>
            <Skel className="h-[38px] w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}
