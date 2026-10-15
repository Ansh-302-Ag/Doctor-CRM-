import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its data files at runtime; bundling breaks that (src/lib/rx-pdf.ts)
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
