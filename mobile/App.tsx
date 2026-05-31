// Fase 0 scaffold — proves three things end-to-end:
//   1. The @roundfi/sdk workspace dep resolves through the pnpm
//      monorepo + Metro `watchFolders` config.
//   2. The Solana polyfills loaded in `index.ts` are in place before
//      `@solana/web3.js` constructs a `PublicKey`.
//   3. The web `theme` tokens land on RN unchanged (palette toggle
//      proves the Context wiring).
//
// What it does: derives the ProtocolConfig PDA for the canonical
// devnet core program id and renders the base58. If the PDA renders
// and the palette toggle works, every Fase 1 screen can be built on
// top of this surface.

import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { protocolConfigPda } from "@roundfi/sdk/pda";
import { PublicKey } from "@solana/web3.js";

import { ThemeProvider, useTheme } from "./src/theme/ThemeProvider";

// Canonical devnet RoundFi core program id (same constant the web app
// uses in `app/src/lib/devnet.ts`). Hard-coded here so the mobile
// scaffold doesn't import from `app/` — keeps the two apps decoupled.
const DEVNET_CORE_PROGRAM_ID = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");

function Screen() {
  const { tokens, palette, togglePalette } = useTheme();

  const [configPda, bump] = useMemo(() => protocolConfigPda(DEVNET_CORE_PROGRAM_ID), []);

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <StatusBar style={palette === "neon" ? "light" : "dark"} />

      <Text style={[styles.label, { color: tokens.muted }]}>RoundFi mobile · Fase 0</Text>

      <Text style={[styles.title, { color: tokens.text }]}>ProtocolConfig PDA (devnet)</Text>

      <View style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}>
        <Text style={[styles.mono, { color: tokens.green }]} selectable>
          {configPda.toBase58()}
        </Text>
        <Text style={[styles.meta, { color: tokens.text2 }]}>bump {bump}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={togglePalette}
        style={[styles.toggle, { backgroundColor: tokens.surface2, borderColor: tokens.borderStr }]}
      >
        <Text style={[styles.toggleLabel, { color: tokens.text }]}>palette: {palette}</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider initial="soft">
      <Screen />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 64,
    gap: 18,
  },
  label: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  mono: {
    fontFamily: "Menlo",
    fontSize: 13,
    lineHeight: 18,
  },
  meta: {
    fontSize: 12,
  },
  toggle: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
});
