"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Palette tokens mirror the prototype's `RFI` object in
// app/public/prototype/components/brand.jsx. Kept in TypeScript so
// every consumer gets autocomplete + type-checking on token names.
export type Palette = "neon" | "soft";

export interface ThemeTokens {
  // surfaces
  bg: string;
  bgDeep: string;
  surface1: string;
  surface2: string;
  surface3: string;
  fillSoft: string;
  fillMed: string;
  // accents
  green: string;
  teal: string;
  purple: string;
  amber: string;
  red: string;
  // brand blue
  navy: string;
  navyDeep: string;
  // text
  text: string;
  text2: string;
  muted: string;
  border: string;
  borderStr: string;
}

export const PALETTES: Record<Palette, ThemeTokens> = {
  neon: {
    bg: "#06090F",
    bgDeep: "#02050B",
    surface1: "#0C1018",
    surface2: "#111828",
    surface3: "#18202F",
    fillSoft: "rgba(255,255,255,0.03)",
    fillMed: "rgba(255,255,255,0.08)",
    green: "#14F195",
    teal: "#00C8FF",
    purple: "#9945FF",
    amber: "#FFB547",
    red: "#FF5656",
    navy: "#0A2748",
    navyDeep: "#071A32",
    text: "#EEF0F8",
    text2: "rgba(238,240,248,0.65)",
    muted: "#4E5870",
    border: "rgba(255,255,255,0.08)",
    borderStr: "rgba(255,255,255,0.14)",
  },
  soft: {
    bg: "#F5F1EA",
    bgDeep: "#EDE7DC",
    surface1: "#FFFFFF",
    surface2: "#FAF6EF",
    surface3: "#F0EAE0",
    fillSoft: "rgba(42,46,56,0.025)",
    fillMed: "rgba(42,46,56,0.06)",
    green: "#6FB39A",
    teal: "#7BA7C4",
    purple: "#A898D4",
    amber: "#E5B472",
    red: "#D48A82",
    navy: "#D9E4EC",
    navyDeep: "#C7D5E0",
    text: "#2A2E38",
    text2: "rgba(42,46,56,0.65)",
    muted: "#8A8578",
    border: "rgba(42,46,56,0.08)",
    borderStr: "rgba(42,46,56,0.14)",
  },
};

export interface ThemeContextValue {
  palette: Palette;
  tokens: ThemeTokens;
  isDark: boolean;
  setPalette: (p: Palette) => void;
  togglePalette: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  initial = "soft",
  children,
}: {
  initial?: Palette;
  children: ReactNode;
}) {
  const [palette, setPaletteState] = useState<Palette>(initial);
  const setPalette = useCallback((p: Palette) => setPaletteState(p), []);
  const togglePalette = useCallback(
    () => setPaletteState((p) => (p === "neon" ? "soft" : "neon")),
    [],
  );
  const value = useMemo<ThemeContextValue>(
    () => ({
      palette,
      tokens: PALETTES[palette],
      isDark: palette === "neon",
      setPalette,
      togglePalette,
    }),
    [palette, setPalette, togglePalette],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error("useTheme() must be used within <ThemeProvider>");
  return v;
}

// ── Glassmorphism helper ───────────────────────────────────
// Returns the canonical card surface for the active palette:
// translucent base + 12px backdrop blur + subtle hairline border.
// Spec ref: rgba(255,255,255,0.03) + blur(12px) + 1px solid
// rgba(255,255,255,0.08).
//
// Components spread the result into their style object:
//   <div style={{ ...glassSurfaceStyle(palette), padding: 18 }} />
//
// Saturate(140%) keeps the green glows behind glass cards crisp
// instead of muddy.
export function glassSurfaceStyle(palette: Palette): React.CSSProperties {
  if (palette === "soft") {
    return {
      background: "rgba(255, 255, 255, 0.62)",
      backdropFilter: "blur(12px) saturate(140%)",
      WebkitBackdropFilter: "blur(12px) saturate(140%)",
      border: "1px solid rgba(42, 46, 56, 0.08)",
    };
  }
  // neon
  return {
    background: "rgba(255, 255, 255, 0.03)",
    backdropFilter: "blur(12px) saturate(140%)",
    WebkitBackdropFilter: "blur(12px) saturate(140%)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
  };
}
