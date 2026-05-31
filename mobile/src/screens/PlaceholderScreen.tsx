// Generic placeholder used by tabs that haven't built their real
// content yet (Pools, Wallet, Profile in Fase 1). Renders a centered
// label using the active palette so the navigation + theme wiring is
// visible at a glance — clicking a tab MUST change the title and the
// background must follow the palette toggle on Home.
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../theme/ThemeProvider";

export function PlaceholderScreen({ title, blurb }: { title: string; blurb: string }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <View style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}>
        <Text style={[styles.label, { color: tokens.muted }]}>placeholder</Text>
        <Text style={[styles.title, { color: tokens.text }]}>{title}</Text>
        <Text style={[styles.body, { color: tokens.text2 }]}>{blurb}</Text>
      </View>
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
  card: {
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  label: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
});
