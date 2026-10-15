"use client";

/** The clinic's wall clock, in the clinic's timezone, ticking each second.
 *  Rendered empty on the server so the two renders never disagree. */
import { useEffect, useState } from "react";

export function Clock({ timeZone, className }: { timeZone: string; className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const text = now
    ? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)
    : "--:--:--";
  return (
    <time suppressHydrationWarning className={className} aria-label="Clinic time">
      {text}
    </time>
  );
}
