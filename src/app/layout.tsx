import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by Next.js — no external request at runtime, no
// layout shift. Swaps in for the system-font stack used as a fallback.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Robinhood Chain RWA LP Screener",
  description: "Ranks Uniswap RWA pools on Robinhood Chain by estimated fee APR for concentrated LP positions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
