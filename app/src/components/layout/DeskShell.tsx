"use client";

import type { ReactNode } from "react";

import { PageTransition } from "@/components/layout/PageTransition";
import { TopBar } from "@/components/layout/TopBar";
import { TweaksPanel } from "@/components/layout/TweaksPanel";
import { useRedirectOnDisconnect } from "@/lib/useRedirectOnDisconnect";
import { useTheme } from "@/lib/theme";

// App chrome for every authenticated dashboard route. The left SideNav was
// retired in favor of a horizontal session nav living in the TopBar (same
// pattern as /home-v2), so this is now just a sticky top bar over the
// scrolling page content.

export function DeskShell({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
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
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        <PageTransition>{children}</PageTransition>
      </div>
      <TweaksPanel />
    </div>
  );
}
