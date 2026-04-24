import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Syne } from "next/font/google";

import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";

import { ClientProviders } from "@/components/ClientProviders";

// Brand typography. Exposed as CSS variables so inline-styled
// prototype components can reference them via
// fontFamily: 'DM Sans, system-ui' (next/font injects the real
// font-face for us and aliases it under its stable family name).
const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RoundFi — Cooperative credit, on-chain",
  description:
    "On-chain ROSCA protocol on Solana: behavioral credit, reputation-weighted stake, transparent lifecycle.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`dark ${syne.variable} ${dmSans.variable} ${jetBrainsMono.variable}`}
    >
      {/* Body keeps Tailwind tokens so /demo still renders with its
          dark palette; ported screens override via inline tokens
          from useTheme(). */}
      <body className="min-h-screen bg-background text-slate-100 antialiased">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
