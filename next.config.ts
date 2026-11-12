import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Dockerfile copies .next/standalone: server.js plus only the node_modules it needs
  // the confirmation PDF (services/pdf.ts): pdfkit runs from node_modules as is, its fonts ride along into the image
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: { "/**": ["./assets/fonts/*"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
