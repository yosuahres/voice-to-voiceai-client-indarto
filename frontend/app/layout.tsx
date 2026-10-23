import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live Translate | Databiota",
  description: "Real-time Indonesian and Russian voice translation with dubbed audio.",
  applicationName: "Databiota Live Translate",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
