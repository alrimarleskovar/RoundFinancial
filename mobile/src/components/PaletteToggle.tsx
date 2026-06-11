// Global palette toggle — lives in the navigation chrome (headerRight)
// so the neon ↔ soft flip is reachable from every screen, not just the
// Home hero. Persistence happens inside ThemeProvider (AsyncStorage),
// so this is a dumb button: read palette, render the opposite-mode
// icon, call togglePalette.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import { useTheme } from "../theme/ThemeProvider";

export function PaletteToggle() {
  const { palette, tokens, togglePalette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={palette === "neon" ? "Switch to light palette" : "Switch to dark palette"}
      onPress={togglePalette}
      hitSlop={8}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
    >
      <Ionicons
        name={palette === "neon" ? "sunny-outline" : "moon-outline"}
        size={20}
        color={tokens.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
});
