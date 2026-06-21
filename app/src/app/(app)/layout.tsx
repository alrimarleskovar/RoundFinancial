"use client";

import type { ReactNode } from "react";

import { DeskShell } from "@/components/layout/DeskShell";

// Shared layout for every authenticated dashboard route
// (/home, /grupos, /carteira, /lab, /insights, /reputacao, /mercado).
//
// DeskShell lives here — once — so the sticky TopBar (with the horizontal
// session nav) persists across navigations without remounting between
// routes.

export default function AppLayout({ children }: { children: ReactNode }) {
  return <DeskShell>{children}</DeskShell>;
}
