// HomeScreen — Fase 0's PDA-derivation surface, now scoped to a tab.
// Proves the SDK + polyfills + theme tokens land correctly inside the
// React Navigation tree (the chain ThemeProvider → NavigationContainer
// → Tab → this Screen must preserve the theme context).
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { protocolConfigPda } from "@roundfi/sdk/pda";
import { PublicKey } from "@solana/web3.js";

import { useTheme } from "../theme/ThemeProvider";

// Canonical devnet RoundFi core program id (mirrors
// app/src/lib/devnet.ts:14). Hard-coded so mobile never imports from
// app/ — keeps the two apps decoupled.
const DEVNET_CORE_PROGRAM_ID = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");

export function HomeScreen() {
  const { tokens, palette, togglePalette } = useTheme();

  const [configPda, bump] = useMemo(() => protocolConfigPda(DEVNET_CORE_PROGRAM_ID), []);

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <Text style={[styles.label, { color: tokens.muted }]}>RoundFi mobile · Home</Text>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
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
