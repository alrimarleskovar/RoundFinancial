"use client";

import Link from "next/link";

import { RFILogoMark } from "@/components/brand/brand";
import { NetworkBadge } from "@/components/layout/NetworkBadge";
import { SegToggle } from "@/components/layout/SegToggle";
import { SessionNav } from "@/components/layout/SessionNav";
import { TopBarPrefsMenu } from "@/components/layout/TopBarPrefsMenu";
import { WalletChip } from "@/components/layout/WalletChip";
import { WalletErrorToast } from "@/components/layout/WalletErrorToast";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useWallet } from "@/lib/wallet";

// Sticky top bar — the app's primary chrome now that the left SideNav is
// gone: brand logo + horizontal session nav + PT/EN & R$/USDC toggles +
// network badge + wallet chip. Mirrors the /home-v2 header so every
// dashboard route shares the same top navigation.

export function TopBar() {
  const { tokens, isDark } = useTheme();
  const i18n = useI18n();
  const wallet = useWallet();
  const connected = wallet.status === "connected";

  return (
    // z-50 (not 10): the wallet chip's dropdown is positioned inside this
    // sticky bar's stacking context, so its own z-index can't escape this root
    // layer. At z-10 the home ActionHero card's filter/backdrop-filter layers
    // overlapped the dropdown under page zoom; lifting the bar to 50 keeps it
    // above page content (full-screen modals still win — they portal to <body>
    // at z-70). Padding + gap are responsive and the nav scrolls when cramped,
    // so the bar never overlaps itself on mobile or under heavy browser zoom.
    <div
      className="sticky top-0 z-50 flex items-center gap-2.5 px-3 py-3 md:gap-4 md:px-8"
      style={{
        background: isDark ? "rgba(6,9,15,0.85)" : "rgba(245,241,234,0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${tokens.border}`,
      }}
    >
      <Link
        href="/home"
        className="flex items-center gap-3 shrink-0 transition-transform hover:scale-105"
        style={{ textDecoration: "none", color: tokens.text }}
      >
        <RFILogoMark size={32} />
        <h1 className="text-xl font-black italic tracking-tighter hidden sm:block uppercase">
          Round<span className="text-[#14F195]">Fi</span>
        </h1>
      </Link>

      {/* Desktop: horizontal session nav. Mobile (<lg): hidden — the
          BottomTabBar (in DeskShell) takes over, freeing the cramped top row.
          The spacer keeps the wallet chip + prefs menu right-aligned. */}
      <div className="hidden flex-1 lg:flex">
        <SessionNav className="w-full" />
      </div>
      <div className="flex-1 lg:hidden" aria-hidden />

      <div className="flex items-center gap-2.5 shrink-0">
        <div className="hidden lg:flex items-center gap-2.5">
          <SegToggle
            value={i18n.lang}
            onChange={i18n.setLang}
            options={[
              { v: "pt", l: "PT" },
              { v: "en", l: "EN" },
            ]}
          />
          <SegToggle
            value={i18n.currency}
            onChange={i18n.setCurrency}
            options={[
              { v: "BRL", l: "R$" },
              { v: "USDC", l: "$" },
            ]}
          />
          <NetworkBadge connected={connected} />
        </div>

        <TopBarPrefsMenu connected={connected} />
        <WalletChip wallet={wallet} />
      </div>

      <WalletErrorToast wallet={wallet} />
    </div>
  );
}
