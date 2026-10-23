import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Guldala CRM", template: "%s · Guldala CRM" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#1e6b48" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-surface text-ink antialiased">{children}</body>
    </html>
  );
}
