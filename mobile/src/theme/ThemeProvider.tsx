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
  const [hydrated, setHydrated] = useState(false);

  // Cold-open: restore the persisted palette once. We track `hydrated`
  // so the subsequent persistence effect doesn't write back the
  // pre-read value over what was on disk.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        if (isPalette(stored)) {
          // eslint-disable-next-line no-console
          console.log("[theme] hydrated from storage:", stored);
          setPaletteState(stored);
        } else {
          // eslint-disable-next-line no-console
          console.log("[theme] no stored palette, using initial:", initial);
        }
        setHydrated(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.log("[theme] hydrate failed:", err?.message ?? err);
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [initial]);

  // Persistence: write whenever palette changes, but only AFTER the
  // initial hydrate read has resolved. Without the gate, the initial
  // render would write the default-value "soft" over a stored "neon"
  // before the read returns. This is the bug that made "matei o app e
  // não voltou na paleta" — the setState-callback persist could race
  // the hydrate read on cold-open.
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, palette).catch((err) => {
      // eslint-disable-next-line no-console
      console.log("[theme] persist failed:", err?.message ?? err);
    });
  }, [hydrated, palette]);

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
