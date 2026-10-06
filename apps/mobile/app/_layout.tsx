import "@/global.css";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  AtkinsonHyperlegibleNext_400Regular,
  AtkinsonHyperlegibleNext_700Bold,
} from "@expo-google-fonts/atkinson-hyperlegible-next";
import { BigShouldersDisplay_900Black } from "@expo-google-fonts/big-shoulders-display";
import { PortalHost } from "@rn-primitives/portal";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";

import { NAV_THEME } from "@/lib/theme";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
if (!publishableKey) {
  throw new Error("Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env");
}

export { ErrorBoundary } from "expo-router";

const RootLayout = () => {
  const [fontsLoaded] = useFonts({
    AtkinsonHyperlegibleNext_400Regular,
    AtkinsonHyperlegibleNext_700Bold,
    BigShouldersDisplay_900Black,
  });
  // Bundled fonts load in a frame or two; rendering before that would flash the system font.
  if (!fontsLoaded) {
    return null;
  }
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ThemeProvider value={NAV_THEME}>
        {/* oxlint-disable-next-line react/style-prop-object -- expo-status-bar's `style` is a string ("light"), not a style object. */}
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="create" options={{ presentation: "modal" }} />
          <Stack.Screen name="sign-in" options={{ presentation: "modal" }} />
          <Stack.Screen name="handle" options={{ presentation: "modal" }} />
          <Stack.Screen
            name="saved-feed"
            options={{
              headerBackButtonDisplayMode: "minimal",
              headerShown: true,
              title: "Saved",
            }}
          />
        </Stack>
        <PortalHost />
      </ThemeProvider>
    </ClerkProvider>
  );
};

export default RootLayout;
