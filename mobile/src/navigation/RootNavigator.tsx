// Bottom-tabs navigator — Fase 1 surface, extended in Fase 2. Four tabs
// (Home, Pools, Wallet, Profile) using React Navigation v7. The Pools
// tab now hosts a native-stack (list → detail), so its tab-level header
// is hidden and the stack renders its own headers.
//
// Tab bar colors are driven from the active palette so the toggle on
// Home flips the whole UI (including the tab bar) in one tick.
//
// Icons via @expo/vector-icons (Ionicons set). The previous version
// rendered the React Navigation v7 default-icon glyph (a small
// downward triangle ▼) because no tabBarIcon was supplied. Outline
// for inactive, filled for active — matches the platform convention.
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";

import { HomeScreen } from "../screens/HomeScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { WalletScreen } from "../screens/WalletScreen";
import { useTheme } from "../theme/ThemeProvider";
import { FONT } from "../theme/tokens";

import { PoolsStack } from "./PoolsStack";

const Tab = createBottomTabNavigator();

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// Per-tab icon pair: [outline, filled]. Outline for inactive, filled
// for the focused tab. Names are validated by the Ionicons type so a
// typo blows up at typecheck rather than at runtime as a "?" glyph.
const TAB_ICONS: Record<string, [IoniconName, IoniconName]> = {
  Home: ["home-outline", "home"],
  Pools: ["layers-outline", "layers"],
  Wallet: ["wallet-outline", "wallet"],
  Profile: ["person-outline", "person"],
};

export function RootNavigator() {
  const { tokens, isDark } = useTheme();

  // Bridge our tokens into React Navigation's Theme shape so the
  // header + tab-bar chrome follow the palette without a second
  // source of truth. The base theme (Default vs Dark) sets text
  // defaults; we override colors with the palette tokens.
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: tokens.bg,
      card: tokens.surface1,
      text: tokens.text,
      border: tokens.border,
      primary: tokens.green,
      notification: tokens.amber,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarActiveTintColor: tokens.green,
          tabBarInactiveTintColor: tokens.muted,
          tabBarStyle: {
            backgroundColor: tokens.surface1,
            borderTopColor: tokens.border,
          },
          headerStyle: { backgroundColor: tokens.surface1 },
          headerTitleStyle: {
            color: tokens.text,
            fontFamily: FONT.displayHeavy,
            fontSize: 18,
            letterSpacing: -0.3,
          },
          headerTintColor: tokens.text,
          tabBarLabelStyle: {
            fontFamily: FONT.mono,
            fontSize: 10,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          },
          tabBarIcon: ({ focused, color, size }) => {
            const pair = TAB_ICONS[route.name];
            // Fallback to a generic dot for any tab we forgot to map —
            // visually obvious if a new route is added without an icon.
            const name: IoniconName = pair ? (focused ? pair[1] : pair[0]) : "ellipse-outline";
            return <Ionicons name={name} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Pools" component={PoolsStack} options={{ headerShown: false }} />
        <Tab.Screen name="Wallet" component={WalletScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
