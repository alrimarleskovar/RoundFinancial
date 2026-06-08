// Design tokens ported from `app/src/lib/theme.tsx` (the web app's
// canonical palette source). Single source of truth for color values
// across web + mobile; if the web `PALETTES` shifts (e.g. WCAG bump),
// mirror the change here.
//
// What was NOT ported and why:
//
//   - `glassSurfaceStyle()` — that helper returns `React.CSSProperties`
//     with `backdropFilter` / `WebkitBackdropFilter`, neither of which
//     exist in React Native's style system. The equivalent for RN is
//     `expo-blur`'s `<BlurView>` with `intensity` + `tint`, which is a
//     component, not a style object. Deferred to Fase 1 when an actual
//     card surface is built.
//
//   - `"use client"` and the React hooks come back in the RN
//     ThemeProvider (see ./ThemeProvider.tsx) — the Context API works
//     identically in RN, only the style consumption changes (RN uses
//     plain JS objects, no CSS strings).

export type Palette = "neon" | "soft";

// Typography tokens — bundled Syne + JetBrains Mono via
// @expo-google-fonts. Loaded in App.tsx before <RootNavigator />
// renders; until the hook resolves, names won't match and RN falls
// back to system font (briefly, behind expo-splash-screen).
export const FONT = {
  display: "Syne_800ExtraBold", // big headlines (hero numbers, KPI values)
  displayHeavy: "Syne_700Bold", // titles, screen names
  mono: "JetBrainsMono_500Medium", // mono labels, addresses
  monoBold: "JetBrainsMono_700Bold", // emphasized mono
} as const;

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
    // WCAG AA fix mirrors the web palette (4.81:1 against bg).
    muted: "#7079A1",
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
    // WCAG AA fix mirrors the web palette (4.66:1 against bg).
    muted: "#6E6A5E",
    border: "rgba(42,46,56,0.08)",
    borderStr: "rgba(42,46,56,0.14)",
  },
};
