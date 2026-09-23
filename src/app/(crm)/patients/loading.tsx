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

      {/* The real table, with the real headers: the columns then land in the
          same places when the rows arrive. */}
      <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-subtle text-left text-xs uppercase tracking-wide whitespace-nowrap text-ink-3">
              <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Phone</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Consent</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Next appointment</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Active prescriptions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3"><Skel className="h-4 w-36" /></td>
                <td className="px-4 py-3"><Skel className="h-4 w-28" /></td>
                <td className="px-4 py-3"><Skel className="h-5 w-20 rounded-full" /></td>
                <td className="px-4 py-3"><Skel className="h-4 w-36" /></td>
                <td className="px-4 py-3"><Skel className="ml-auto h-4 w-4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
