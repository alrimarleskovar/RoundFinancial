import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoundFi — ROSCA on Solana",
  description:
    "On-chain rotating savings & credit, with reputation-weighted stake and transparent lifecycle.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
