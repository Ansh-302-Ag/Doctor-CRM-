"use client";

/** The clinic's wall clock, in the clinic's timezone, to the minute. It wakes
 *  once a minute, on the minute (these screens stay open all day). Rendered
 *  empty on the server so the two renders never disagree. */
import { useEffect, useState } from "react";

export function Clock({ timeZone, className }: { timeZone: string; className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let t = 0;
    const tick = () => {
      setNow(new Date());
      t = window.setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    t = window.setTimeout(tick, 0);
    return () => window.clearTimeout(t);
  }, []);
  const text = now
    ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now)
    : "--:--";
  return (
    <time suppressHydrationWarning className={className}>
      <span className="sr-only">Clinic time </span>{text}
    </time>
  );
}
