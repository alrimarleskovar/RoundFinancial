"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { DeskShell } from "@/components/layout/DeskShell";

// Shared layout for every authenticated dashboard route
// (/home, /grupos, /carteira, /lab, /insights, /reputacao, /mercado).
//
// DeskShell lives here — once — so the SideNav persists across
// navigations and can animate enter/exit smoothly as `hideSideNav`
// flips. Without this, each page mounted its own DeskShell instance,
// causing the SideNav to remount between routes and breaking
// transitions like /lab <-> /home.
//
// `hideSideNav` is derived from the pathname: `/lab` runs in focus
// mode, every other route shows the sidebar.

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideSideNav = pathname?.startsWith("/lab") ?? false;
  return <DeskShell hideSideNav={hideSideNav}>{children}</DeskShell>;
}
