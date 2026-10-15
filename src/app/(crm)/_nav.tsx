"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  queue:
    "M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01",
  calendar:
    "M8 3v3M16 3v3M3.5 9.5h17M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z",
  patients:
    "M15.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H7a3.5 3.5 0 0 0-3.5 3.5V20M9.5 4.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5ZM20.5 20v-1.5a3.5 3.5 0 0 0-2.6-3.38M15.5 4.7a3.25 3.25 0 0 1 0 6.1",
  escalations:
    "M10.6 4.1 2.9 17.4A1.6 1.6 0 0 0 4.3 19.8h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.1a1.6 1.6 0 0 0-2.8 0ZM12 9.2v4.1M12 16.6h.01",
  tasks:
    "M9 6.5h11M9 12h11M9 17.5h11M3.5 6.5l1.2 1.2 2.3-2.4M3.5 12l1.2 1.2 2.3-2.4M3.5 17.5l1.2 1.2 2.3-2.4",
} as const;

/** `count` draws a badge when above zero; `countLabel` is what a screen reader hears. */
export type NavItem = {
  href: string; label: string; icon: keyof typeof ICONS; count?: number; countLabel?: string;
};

const Icon = ({ name, className }: { name: NavItem["icon"]; className: string }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={ICONS[name]} />
  </svg>
);

/** The active state needs the current path, and a layout is not re-rendered on
 *  navigation between its children — so this one small piece is a client
 *  component. Which items exist is decided on the server.
 *
 *  Two presentations of the same items: "rail" is the md+ sidebar list, "tabs"
 *  is the fixed bottom bar on a phone (hidden from md up). */
export function Nav({
  items, variant,
}: { items: NavItem[]; variant: "rail" | "tabs" }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const badge = (item: NavItem, cls: string) => !!item.count && (
    <span className={`rounded-full bg-danger px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white ${cls}`}>
      {item.count}
      <span className="sr-only"> {item.countLabel}</span>
    </span>
  );

  if (variant === "tabs") {
    return (
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-rail-line bg-rail/95 pb-[env(safe-area-inset-bottom)] shadow-pop backdrop-blur md:hidden"
      >
        <ul className="flex">
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors ${
                    active ? "text-accent-ink" : "text-rail-ink hover:text-ink"
                  }`}
                >
                  <span className="relative">
                    <Icon name={item.icon} className={`size-5 ${active ? "text-accent" : ""}`} />
                    {badge(item, "absolute -right-3 -top-1.5 min-w-4 text-center leading-none")}
                  </span>
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="flex-1 p-3">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-rail-active text-accent-ink"
                    : "text-rail-ink hover:bg-subtle hover:text-ink"
                }`}
              >
                <Icon name={item.icon} className={`size-[18px] shrink-0 ${active ? "text-accent" : "text-ink-3"}`} />
                {item.label}
                {badge(item, "ml-auto")}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
