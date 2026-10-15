"use client";

import { useEffect, useId, useRef } from "react";

// Ctrl/⌘+K from anywhere, or "/" outside a text field, opens one search box.
// Two instances mount (phone bar, desktop rail) but only one is ever visible,
// so the shortcut listener lives on whichever dialog is rendered visible.
export function QuickFind() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Two copies mount (phone bar, rail); ids must not collide.
  const id = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The target is usually an element, but can be the document or window.
      const el = e.target instanceof Element ? e.target : null;
      const typing = !!el?.closest("input, textarea, select, [contenteditable]");
      const hit = ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") ||
                  (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey);
      const d = dialog.current;
      // offsetParent is null for the copy hidden by the responsive layout.
      if (!hit || !d || !d.parentElement?.offsetParent) return;
      e.preventDefault();
      if (d.open) return;
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
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-subtle px-3 py-1.5 text-sm text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.8-3.8" /></svg>
          Find patient
        </span>
        <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-3 md:inline">Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label="Quick find patient"
        className="m-auto mt-[12vh] w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-3 text-ink shadow-pop"
        onClick={e => { if (e.target === dialog.current) dialog.current?.close(); }}
      >
        <form method="get" action="/patients" onSubmit={() => dialog.current?.close()}>
          <label htmlFor={id} className="sr-only">Find a patient by name or phone</label>
          <input type="hidden" name="jump" value="1" />
          <input
            ref={input}
            id={id}
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Name or phone number, then Enter"
            className="w-full rounded-xl border border-line-strong bg-surface px-4 py-3 text-base text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-2 px-1 text-xs text-ink-3">
            Name, or a phone in any form — 98…, +91 98…, 098…. Press Enter; Esc to close.
          </p>
        </form>
      </dialog>
    </div>
  );
}
