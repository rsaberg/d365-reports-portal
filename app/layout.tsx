import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: process.env.APP_NAME ?? "D365 Reports Portal" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" />
      </head>
      <body className="font-sans text-[14px] antialiased">{children}</body>
    </html>
  );
}
