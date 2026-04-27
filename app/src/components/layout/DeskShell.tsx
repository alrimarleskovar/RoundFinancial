"use client";

import type { ReactNode } from "react";

import { SideNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";
import { TweaksPanel } from "@/components/layout/TweaksPanel";
import { useRedirectOnDisconnect } from "@/lib/useRedirectOnDisconnect";
import { useTheme } from "@/lib/theme";

// Wraps every Next-native RoundFi screen. SideNav on the left,
// sticky TopBar at the top of the content column, children below.

export function DeskShell({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  // Disconnecting the wallet from the chip dropdown sends the user
  // back to the public landing.
  useRedirectOnDisconnect("/");
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: tokens.bg,
        color: tokens.text,
        fontFamily: "var(--font-dm-sans), DM Sans, system-ui, sans-serif",
      }}
    >
      <SideNav />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar />
        <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
          {children}
        </div>
      </div>
      <TweaksPanel />
    </div>
  );
}
