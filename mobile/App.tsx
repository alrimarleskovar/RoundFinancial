// Fase 1 root — compose ThemeProvider → SafeAreaProvider →
// RootNavigator (bottom-tabs). The Fase 0 PDA-derivation surface
// moved to src/screens/HomeScreen.tsx (now the Home tab).
//
// StatusBar is rendered here (not inside the navigator) so it
// reacts to the palette regardless of which tab is active.
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RootNavigator } from "./src/navigation/RootNavigator";
import { ThemeProvider, useTheme } from "./src/theme/ThemeProvider";

function ThemedStatusBar() {
  const { palette } = useTheme();
  return <StatusBar style={palette === "neon" ? "light" : "dark"} />;
}

export default function App() {
  return (
    <ThemeProvider initial="soft">
      <SafeAreaProvider>
        <ThemedStatusBar />
        <RootNavigator />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
