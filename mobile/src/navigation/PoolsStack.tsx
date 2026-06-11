// Pools tab stack — Fase 2 (detail). Wraps the live Pools list and a
// per-pool detail screen in a native-stack so a row tap pushes the
// detail with a back button.
//
// The list keeps `headerShown: false` so its existing full-bleed look
// is untouched; the detail screen gets a palette-styled header so the
// back affordance + title read correctly. Param is the pool ADDRESS as
// a base58 string (navigation params must be serializable — no
// PublicKey / bigint through nav state; the detail re-fetches by
// address, which also makes pull-to-refresh + deep-link trivial).
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { PaletteToggle } from "../components/PaletteToggle";
import { PoolDetailScreen } from "../screens/PoolDetailScreen";
import { PoolsScreen } from "../screens/PoolsScreen";
import { useTheme } from "../theme/ThemeProvider";
import { FONT } from "../theme/tokens";

export type PoolsStackParamList = {
  PoolsList: undefined;
  PoolDetail: { address: string };
};

const Stack = createNativeStackNavigator<PoolsStackParamList>();

export function PoolsStack() {
  const { tokens } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: tokens.surface1 },
        headerTitleStyle: {
          color: tokens.text,
          fontFamily: FONT.displayHeavy,
          fontSize: 18,
        },
        headerTintColor: tokens.text,
        // Same global toggle the tab headers carry (RootNavigator) —
        // the Pools tab hides its tab header, so the stack supplies it.
        headerRight: () => <PaletteToggle />,
        contentStyle: { backgroundColor: tokens.bg },
      }}
    >
      <Stack.Screen name="PoolsList" component={PoolsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PoolDetail" component={PoolDetailScreen} options={{ title: "Pool" }} />
    </Stack.Navigator>
  );
}
