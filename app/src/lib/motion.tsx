"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// User-configurable page-transition preference. Lives behind the
// Tweaks panel; default = "fade" (subtle, polished).

export type MotionMode = "off" | "fade" | "slide";

interface MotionContextValue {
  mode: MotionMode;
  setMode: (m: MotionMode) => void;
}

const MotionContext = createContext<MotionContextValue | null>(null);

export function MotionProvider({
  initial = "fade",
  children,
}: {
  initial?: MotionMode;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<MotionMode>(initial);
  const set = useCallback((m: MotionMode) => setMode(m), []);
  const value = useMemo(() => ({ mode, setMode: set }), [mode, set]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion(): MotionContextValue {
  const v = useContext(MotionContext);
  if (!v) throw new Error("useMotion() must be used within <MotionProvider>");
  return v;
}
