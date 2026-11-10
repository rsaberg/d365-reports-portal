import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "ONE365 Reports", description: "ONE365 Reports — Dynamics 365 Finance & Operations reporting by Grow Path" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 40 40%27%3E%3Crect width=%2740%27 height=%2740%27 rx=%2711%27 fill=%27%23F58220%27/%3E%3Cpath d=%27M9 28c6 0 7.5-9 12-9s6 4.5 11-10%27 fill=%27none%27 stroke=%27%231B0D00%27 stroke-width=%273%27 stroke-linecap=%27round%27/%3E%3C/svg%3E" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Readex+Pro:wght@500;600;700&display=swap" />
      </head>
      <body className="font-sans text-[14px] antialiased">{children}</body>
    </html>
  );
}
