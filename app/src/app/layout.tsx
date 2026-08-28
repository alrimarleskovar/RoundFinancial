import type { Metadata, Viewport } from "next";
import { DM_Sans, Geist_Mono, JetBrains_Mono, Syne } from "next/font/google";

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
// Geist Mono — the team's chosen display mono for the redesigned screens
// (e.g. /insights-v2). Exposed as --font-geist-mono.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-mono",
  display: "swap",
});

// SEO for the public landing. The copy is PT-BR to match `<html lang>` and
// the landing itself — the previous title/description were English against
// a Portuguese page, which is what a crawler would have indexed.
//
// `metadataBase` resolves the relative URLs below into absolute ones for
// OpenGraph. The host is the primary canonical from `lib/domainPinning.ts`
// — the same list the phishing banner trusts — so the two cannot drift
// into disagreeing about which domain is ours.
//
// No `openGraph.images` on purpose: the only lockup asset we hold is white
// on transparency, and the clients that composite a transparent OG image
// onto white would render an invisible logo. A proper 1200x630 card is
// worth having, but shipping a broken preview is worse than shipping none.
export const metadata: Metadata = {
  metadataBase: new URL("https://roundfi.vercel.app"),
  title: "RoundFi — grupos financeiros colaborativos na Solana",
  description:
    "Grupos em que participantes contribuem em ciclos, recebem conforme as regras do grupo e constroem um histórico financeiro verificável on-chain.",
  keywords: [
    "consórcio",
    "grupos financeiros",
    "ROSCA",
    "Solana",
    "reputação on-chain",
    "crédito colaborativo",
    "RoundFi",
  ],
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "RoundFi",
    url: "/",
    title: "RoundFi — grupos financeiros colaborativos na Solana",
    description:
      "Contribua em grupo, realize objetivos e construa reputação. Regras verificáveis, código aberto, histórico on-chain.",
  },
};

// Explicit viewport (Next.js 14 app-router export). Renders to:
//   <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
//   <meta name="theme-color" content="#06090F">
//   <meta name="color-scheme" content="dark">
//
// Notes:
//   - `width: "device-width"` + `initialScale: 1` is the standard
//     mobile baseline; without it, mobile Safari/Chrome render at a
//     980px desktop width and zoom out, breaking everything.
//   - We deliberately do NOT set `maximumScale` or `userScalable: false`
//     — pinching to zoom is a baseline a11y guarantee for users with
//     low vision; locking it would be a WCAG 2.1 violation.
//   - `viewportFit: "cover"` lets the layout extend into the iOS notch
//     / safe-area insets so the dark palette reaches edge-to-edge.
//   - `themeColor` + `colorScheme` mirror the brand ground color
//     (#06090F) so the iOS Safari URL bar + browser chrome blend in.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06090F",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`dark ${syne.variable} ${dmSans.variable} ${jetBrainsMono.variable} ${geistMono.variable}`}
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
