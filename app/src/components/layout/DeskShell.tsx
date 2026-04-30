"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

import { PageTransition } from "@/components/layout/PageTransition";
import { SideNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";
import { TweaksPanel } from "@/components/layout/TweaksPanel";
import { useRedirectOnDisconnect } from "@/lib/useRedirectOnDisconnect";
import { useTheme } from "@/lib/theme";

// Wraps every authenticated dashboard route. Mounted once by
// (app)/layout.tsx so the SideNav persists across navigations and
// can animate enter/exit smoothly when `hideSideNav` flips.
//
// The SideNav itself measures 240px / 72px wide. We wrap it in a
// motion.div with `width` + `x` keyframes inside an AnimatePresence
// so going to /lab slides it OUT to the left, and coming back
// slides it back IN — bidirectional, frame-by-frame.

const SLIDE_TRANSITION = {
  duration: 0.32,
  ease: [0.4, 0, 0.2, 1] as const,
};

export function DeskShell({
  children,
  hideSideNav = false,
}: {
  children: ReactNode;
  hideSideNav?: boolean;
}) {
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
      <AnimatePresence initial={false} mode="sync">
        {!hideSideNav && (
          <motion.div
            key="sidenav"
            initial={{ width: 0, x: -240, opacity: 0 }}
            animate={{ width: "auto", x: 0, opacity: 1 }}
            exit={{ width: 0, x: -240, opacity: 0 }}
            transition={SLIDE_TRANSITION}
            style={{ overflow: "hidden", display: "flex", flexShrink: 0 }}
          >
            <SideNav />
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar />
        <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <PageTransition>{children}</PageTransition>
        </div>
      </div>
      <TweaksPanel />
    </div>
  );
}
