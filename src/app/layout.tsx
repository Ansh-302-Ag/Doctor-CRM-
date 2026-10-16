import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Sans_Devanagari } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Doctor-CRM",
  description: "Appointments, escalations and patient records for the clinic front desk.",
};

// next/font downloads these once at build time and serves them from this app,
// so the page still makes no third-party request at runtime. Plex has a
// Devanagari cut, which matters: many patient names here are written in Hindi.
const plex = IBM_Plex_Sans({
  subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex", display: "swap",
});
const plexDeva = IBM_Plex_Sans_Devanagari({
  subsets: ["devanagari"], weight: ["400", "500", "600", "700"], variable: "--font-plex-deva", display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plex.variable} ${plexDeva.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
