import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its data files at runtime; bundling breaks that (src/lib/rx-pdf.ts)
  serverExternalPackages: ["pdfkit"],
  // The patient's prescription page: never cached, never indexed, and the
  // token in its URL never leaks to another site through a Referer header.
  async headers() {
    return [{
      source: "/r/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }];
  },
};

export default nextConfig;
