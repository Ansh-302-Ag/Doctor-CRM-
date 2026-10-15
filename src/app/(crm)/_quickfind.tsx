"use client";

import { useEffect, useRef } from "react";

// Ctrl/⌘+K from anywhere, or "/" outside a text field, opens one search box.
// Two instances mount (phone bar, desktop rail) but only one is ever visible,
// so the shortcut listener lives on whichever dialog is rendered visible.
export function QuickFind() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el?.closest("input, textarea, select, [contenteditable]");
      const hit = ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") ||
                  (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey);
      const d = dialog.current;
      // offsetParent is null for the copy hidden by the responsive layout.
      if (!hit || !d || d.open || !d.parentElement?.offsetParent) return;
      e.preventDefault();
      d.showModal();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div>
      <button
        type="button"
        onClick={() => { dialog.current?.showModal(); input.current?.select(); }}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-rail-line px-3 py-1.5 text-sm font-medium text-rail-ink transition-colors hover:bg-rail-active hover:text-white"
      >
        Search
        <kbd className="hidden text-[11px] font-normal md:inline">⌘K / Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label="Quick find patient"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-4 text-ink backdrop:bg-black/40"
        onClick={e => { if (e.target === dialog.current) dialog.current?.close(); }}
      >
        <form method="get" action="/patients" onSubmit={() => dialog.current?.close()}>
          <label htmlFor="quickfind-q" className="sr-only">Find a patient by name or phone</label>
          <input type="hidden" name="jump" value="1" />
          <input
            ref={input}
            id="quickfind-q"
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Name or phone number, then Enter"
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </form>
      </dialog>
    </div>
  );
}
