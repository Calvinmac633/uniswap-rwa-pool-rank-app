import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Robinhood Chain RWA LP Screener",
  description: "Ranks Uniswap RWA pools on Robinhood Chain by estimated fee APR for concentrated LP positions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
