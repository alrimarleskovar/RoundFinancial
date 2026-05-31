// Theme Context for React Native — mirrors the web `ThemeProvider` in
// `app/src/lib/theme.tsx` but without the `"use client"` directive (RN
// has no SSR boundary) and without the CSS-only `glassSurfaceStyle`
// helper. Same `useTheme()` ergonomics: components read `tokens` and
// call `togglePalette` to flip neon ↔ soft.
//
// Persistence (AsyncStorage / SecureStore) is NOT wired here — the
// initial palette is what the caller passes in. Add persistence in
// Fase 1 when we know the storage layer (Expo SecureStore is the
// default candidate; AsyncStorage if no secret data is stored).
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { PALETTES, type Palette, type ThemeTokens } from "./tokens";

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
