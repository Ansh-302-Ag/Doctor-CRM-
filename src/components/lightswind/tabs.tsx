"use client";

/**
 * Lightswind UI "tabs" (lightswind.com), recoloured to our tokens, with the
 * sliding indicator kept and arrow-key movement added. Server-rendered
 * children can be passed straight into <TabsContent>.
 */
import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/components/lib/utils";

type Ctx = {
  value: string; setValue: (v: string) => void; base: string;
  register: (v: string, el: HTMLButtonElement | null) => void;
  indicator: Indicator; listRef: React.RefObject<HTMLDivElement | null>;
};
type Indicator = { left: number; width: number };
const TabsContext = React.createContext<Ctx | null>(null);
const useTabs = () => {
  const c = React.useContext(TabsContext);
  if (!c) throw new Error("Tabs parts must sit inside <Tabs>");
  return c;
};

export function Tabs({
  defaultValue, className, children,
}: { defaultValue: string; className?: string; children: React.ReactNode }) {
  const [value, setValue] = React.useState(defaultValue);
  const [indicator, setIndicator] = React.useState<Indicator>({ left: 0, width: 0 });
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const triggers = React.useRef(new Map<string, HTMLButtonElement>());
  const base = React.useId();

  const measure = React.useCallback(() => {
    const el = triggers.current.get(value), list = listRef.current;
    if (!el || !list) return;
    const a = el.getBoundingClientRect(), b = list.getBoundingClientRect();
    if (a.width > 0) setIndicator({ left: a.left - b.left + list.scrollLeft, width: a.width });
  }, [value]);

  React.useEffect(() => {
    const id = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", measure); };
  }, [measure]);

  const register = React.useCallback((v: string, el: HTMLButtonElement | null) => {
    if (el) triggers.current.set(v, el); else triggers.current.delete(v);
  }, []);

  return (
    <TabsContext.Provider value={{ value, setValue, base, register, indicator, listRef }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children, label }: { className?: string; children: React.ReactNode; label: string }) {
  const { indicator, listRef } = useTabs();
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? [])];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus(); next.click();
    e.preventDefault();
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-subtle p-1 [scrollbar-width:none]",
        className,
      )}
    >
      <motion.div
        aria-hidden="true"
        className="absolute top-1 bottom-1 rounded-lg bg-surface shadow-card ring-1 ring-line"
        animate={{ left: indicator.left, width: indicator.width }}
        initial={false}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
      />
      {children}
    </div>
  );
}

export function TabsTrigger({
  value, children, className,
}: { value: string; children: React.ReactNode; className?: string }) {
  const { value: current, setValue, register, base } = useTabs();
  const active = current === value;
  return (
    <button
      ref={el => register(value, el)}
      type="button"
      role="tab"
      id={`${base}-tab-${value}`}
      aria-controls={`${base}-panel-${value}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        "relative z-10 inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "text-ink" : "text-ink-3 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Inactive panels stay mounted but hidden, so a half-typed form survives a
 *  tab switch. */
export function TabsContent({
  value, children, className,
}: { value: string; children: React.ReactNode; className?: string }) {
  const { value: current, base } = useTabs();
  return (
    <div
      role="tabpanel"
      id={`${base}-panel-${value}`}
      aria-labelledby={`${base}-tab-${value}`}
      hidden={current !== value}
      className={cn("mt-4", className)}
    >
      {children}
    </div>
  );
}
