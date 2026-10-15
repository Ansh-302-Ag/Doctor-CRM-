import { Skel, tableWrap, th, td, tr } from "../_ui";

export default function Loading() {
  return (
    <section aria-busy="true" aria-label="Loading patients" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skel className="h-8 w-36" />
          <Skel className="mt-2 h-5 w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Skel className="h-9 w-36 rounded-lg" />
          <Skel className="h-9 w-40 rounded-lg" />
        </div>
      </header>

      <div className="flex items-center gap-2">
        <Skel className="h-11 w-full max-w-md rounded-lg" />
        <Skel className="h-11 w-20 rounded-lg" />
      </div>

      {/* The real table, with the real headers: the columns then land in the
          same places when the rows arrive. */}
      <div className={tableWrap}>
        <table className="w-full min-w-[700px] border-collapse">
          <thead>
            <tr className="whitespace-nowrap">
              <th scope="col" className={th}>Name</th>
              <th scope="col" className={th}>Phone</th>
              <th scope="col" className={th}>Consent</th>
              <th scope="col" className={th}>Next appointment</th>
              <th scope="col" className={`${th} text-right`}>Active prescriptions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className={tr}>
                <td className={td}>
                  <div className="flex items-center gap-3">
                    <Skel className="size-7 rounded-full" />
                    <Skel className="h-4 w-36" />
                  </div>
                </td>
                <td className={td}><Skel className="h-4 w-28" /></td>
                <td className={td}><Skel className="h-5 w-20 rounded-full" /></td>
                <td className={td}><Skel className="h-4 w-36" /></td>
                <td className={td}><Skel className="ml-auto h-4 w-4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
