"use client";

/**
 * Lightswind UI "top-loader" (lightswind.com), reduced to what the CRM needs:
 * a thin accent bar across the top of the window while a page is on its way.
 * The database is a continent away, so a click deserves visible feedback.
 *
 * Starts on a click on an internal link or a GET form submit (the day and
 * doctor filters); finishes when the URL changes, or on pageshow/popstate. A
 * form re-sent with unchanged values never changes the URL, so that one
 * finishes after ~3s; a safety timer finishes any other after 12s.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function TopLoader() {
  const path = usePathname();
  const search = useSearchParams();
  const [progress, setProgress] = useState(0);
  const timers = useRef<number[]>([]);

  const clear = () => { timers.current.forEach(t => window.clearTimeout(t)); timers.current = []; };

  // The URL changed: the new page is here.
  useEffect(() => {
    clear();
    const done = window.setTimeout(() => setProgress(p => (p > 0 ? 1 : 0)), 0);
    const t = window.setTimeout(() => setProgress(0), 320);
    return () => { window.clearTimeout(done); window.clearTimeout(t); };
  }, [path, search]);

  useEffect(() => {
    const finish = () => {
      clear();
      setProgress(p => (p > 0 ? 1 : 0));
      timers.current.push(window.setTimeout(() => setProgress(0), 320));
    };
    const start = (sameUrl = false) => {
      clear();
      setProgress(0.15);
      // Trickle toward, never reaching, the end.
      [0.35, 0.55, 0.7, 0.8, 0.88].forEach((p, i) =>
        timers.current.push(window.setTimeout(() => setProgress(q => Math.max(q, p)), 250 + i * 450)));
      timers.current.push(window.setTimeout(finish, sameUrl ? 3_000 : 12_000));
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/export/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      if (e.defaultPrevented || f.method.toLowerCase() !== "get" || f.action.includes("/export/")) return;
      const to = new URL(f.action, location.href);
      to.search = new URLSearchParams([...new FormData(f, e.submitter)].map(([k, v]) => [k, String(v)])).toString();
      start(to.pathname === location.pathname && to.search === location.search);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", finish);
    window.addEventListener("popstate", finish);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", finish);
      window.removeEventListener("popstate", finish);
      clear();
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]">
      <div
        className="bg-brand h-full origin-left shadow-[0_0_10px_var(--color-accent-2)] transition-[transform,opacity] duration-300 ease-out"
        style={{ transform: `scaleX(${progress})`, opacity: progress > 0 && progress < 1 ? 1 : 0 }}
      />
    </div>
  );
}
