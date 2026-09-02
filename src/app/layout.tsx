import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clinic CRM",
  description: "Appointments, escalations and patient records for the clinic front desk.",
};

// ponytail: system font stack rather than a downloaded webfont — one less network
// dependency on a page the front desk needs to load reliably.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
