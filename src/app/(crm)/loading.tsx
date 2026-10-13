import { Skel } from "./_ui";

/** Navigation blocks on a database a continent away. This holds the calendar's
 *  exact shape so the page fills in rather than jumps — same table, same
 *  headers, same cell padding, so the browser lays the columns out the same
 *  way and nothing moves sideways when the rows arrive. */
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

      <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[740px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-subtle text-left text-xs uppercase tracking-wide whitespace-nowrap text-ink-3">
              <th scope="col" className="px-4 py-2.5 font-semibold">Time</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Patient</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Doctor</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Reason (as given)</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Booked by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="align-top">
                <td className="py-3 pl-4 pr-4">
                  <Skel className="h-5 w-12" />
                  <Skel className="mt-1.5 h-3 w-16" />
                </td>
                <td className="px-4 py-3">
                  <Skel className="h-4 w-32" />
                  <Skel className="mt-1.5 h-3 w-28" />
                </td>
                <td className="px-4 py-3"><Skel className="h-4 w-28" /></td>
                <td className="px-4 py-3"><Skel className="h-4 w-56" /></td>
                <td className="px-4 py-3"><Skel className="h-5 w-20 rounded-full" /></td>
                <td className="px-4 py-3"><Skel className="h-4 w-24" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
