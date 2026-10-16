/** Remounted by Next on every navigation, so each page plays its entrance: a
 *  CSS keyframe (`page-in`, globals.css) that starts with the first paint, so
 *  hydration never blanks a page already on screen, and leaves nothing on the
 *  wrapper once done (a lingering transform would trap fixed children). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
