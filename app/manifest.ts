import type { MetadataRoute } from "next";

// Installable on the home screen (spec §3.6); no offline mode
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Guldala CRM",
    short_name: "Guldala",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f5",
    theme_color: "#1e6b48",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
