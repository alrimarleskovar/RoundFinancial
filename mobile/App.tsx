// Root composition — fonts load before render, then:
// ThemeProvider → WalletProvider → SafeAreaProvider → RootNavigator.
//
// Font loading: @expo-google-fonts/* packages ship the .ttf and the
// useFonts hook wires expo-font to register them under the family name.
// While loading we render `null` so the JS-driven splash holds (the
// native splash from expo-splash-screen stays visible). Hydration takes
// ~100ms on a warm cache; on cold-open the user sees the brand splash
// without a "system-font flash" before our typography swaps in.
import {
  useFonts as useJetBrains,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import { useFonts as useSyne, Syne_700Bold, Syne_800ExtraBold } from "@expo-google-fonts/syne";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RootNavigator } from "./src/navigation/RootNavigator";
import { WalletProvider } from "./src/state/WalletContext";
import { ThemeProvider, useTheme } from "./src/theme/ThemeProvider";

function ThemedStatusBar() {
  const { palette } = useTheme();
  return <StatusBar style={palette === "neon" ? "light" : "dark"} />;
}

export default function App() {
  const [syneOk] = useSyne({ Syne_700Bold, Syne_800ExtraBold });
  const [monoOk] = useJetBrains({ JetBrainsMono_500Medium, JetBrainsMono_700Bold });

  // Hold the render until BOTH families have registered — otherwise
  // we'd show typography in the system fallback for a frame, then
  // re-layout when the real font lands. Cheap to wait: total .ttf
  // payload is ~120KB.
  if (!syneOk || !monoOk) return null;

  return (
    <ThemeProvider initial="soft">
      <WalletProvider>
        <SafeAreaProvider>
          <ThemedStatusBar />
          <RootNavigator />
        </SafeAreaProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}
