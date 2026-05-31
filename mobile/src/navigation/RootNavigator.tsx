// Bottom-tabs navigator — Fase 1 surface. Four tabs (Home, Pools,
// Wallet, Profile) using React Navigation v7. No native-stack inside
// any tab yet; that comes in Fase 2 when Pool detail / Member detail
// screens land.
//
// Tab bar colors are driven from the active palette so the toggle on
// Home flips the whole UI (including the tab bar) in one tick.
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";

import { useTheme } from "../theme/ThemeProvider";
import { HomeScreen } from "../screens/HomeScreen";
import { PoolsScreen } from "../screens/PoolsScreen";
import { WalletScreen } from "../screens/WalletScreen";
import { ProfileScreen } from "../screens/ProfileScreen";

const Tab = createBottomTabNavigator();

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
        screenOptions={{
          tabBarActiveTintColor: tokens.green,
          tabBarInactiveTintColor: tokens.muted,
          tabBarStyle: {
            backgroundColor: tokens.surface1,
            borderTopColor: tokens.border,
          },
          headerStyle: { backgroundColor: tokens.surface1 },
          headerTitleStyle: { color: tokens.text },
          headerTintColor: tokens.text,
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Pools" component={PoolsScreen} />
        <Tab.Screen name="Wallet" component={WalletScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
