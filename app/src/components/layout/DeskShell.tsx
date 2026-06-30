"use client";

import type { ReactNode } from "react";

import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { PageTransition } from "@/components/layout/PageTransition";
import { TopBar } from "@/components/layout/TopBar";
import { TweaksPanel } from "@/components/layout/TweaksPanel";
import { useIsMobile } from "@/lib/useIsMobile";
import { useRedirectOnDisconnect } from "@/lib/useRedirectOnDisconnect";
import { useTheme } from "@/lib/theme";

// App chrome for every authenticated dashboard route. The left SideNav was
// retired in favor of a horizontal session nav living in the TopBar (same
// pattern as /home-v2), so this is now just a sticky top bar over the
// scrolling page content.

export function DeskShell({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  const isMobile = useIsMobile();
  // Disconnecting the wallet from the chip dropdown sends the user back to
  // the public landing.
  useRedirectOnDisconnect("/");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: tokens.bg,
        color: tokens.text,
        fontFamily: "var(--font-dm-sans), DM Sans, system-ui, sans-serif",
      }}
    >
      <TopBar />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
          // Clear the fixed BottomTabBar (mobile only) so the last content
          // isn't hidden behind it; + iOS home-indicator safe area.
          paddingBottom: isMobile ? "calc(58px + env(safe-area-inset-bottom, 0px))" : undefined,
        }}
      >
        <PageTransition>{children}</PageTransition>
      </div>
      <TweaksPanel />
      <BottomTabBar />
    </div>
  );
}
