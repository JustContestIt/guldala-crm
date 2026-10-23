import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // Dockerfile copies .next/standalone: server.js plus only the node_modules it needs
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
