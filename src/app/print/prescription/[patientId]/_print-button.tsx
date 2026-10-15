"use client";

import { Printer } from "lucide-react";
import { btnPrimary } from "@/app/(crm)/_ui";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={`${btnPrimary} min-h-11`}>
      <Printer aria-hidden className="size-4" /> Print
    </button>
  );
}
