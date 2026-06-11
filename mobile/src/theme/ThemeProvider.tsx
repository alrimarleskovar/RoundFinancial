// Theme Context for React Native — mirrors the web `ThemeProvider` in
// `app/src/lib/theme.tsx` but without the `"use client"` directive (RN
// has no SSR boundary) and without the CSS-only `glassSurfaceStyle`
// helper. Same `useTheme()` ergonomics: components read `tokens` and
// call `togglePalette` to flip neon ↔ soft.
//
// Persistence: the active palette is mirrored to AsyncStorage (same
// pattern as src/state/WalletContext.tsx) so a cold-open restores the
// user's last choice. Reads are tolerant — a missing/corrupt value
// just means "use the caller-provided initial", which is the default
// state anyway. Writes are fire-and-forget: a failed write only means
// the next cold-open won't restore; not worth surfacing mid-session.
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { PALETTES, type Palette, type ThemeTokens } from "./tokens";

const STORAGE_KEY = "@roundfi/mobile/palette";

function isPalette(v: string | null): v is Palette {
  return v === "neon" || v === "soft";
}

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

  // Cold-open: restore the persisted palette once. The brief window
  // where the initial palette renders before the read resolves is
  // acceptable (~ms on a warm cache, and both palettes are legible).
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (active && isPalette(stored)) setPaletteState(stored);
      })
      .catch(() => {
        // first launch / corrupted storage → keep `initial`
      });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback((p: Palette) => {
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const setPalette = useCallback(
    (p: Palette) => {
      setPaletteState(p);
      persist(p);
    },
    [persist],
  );

  const togglePalette = useCallback(() => {
    setPaletteState((p) => {
      const next: Palette = p === "neon" ? "soft" : "neon";
      persist(next);
      return next;
    });
  }, [persist]);

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
