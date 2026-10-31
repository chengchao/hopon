import "@/global.css";
import { ClerkProvider, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  AtkinsonHyperlegibleNext_400Regular,
  AtkinsonHyperlegibleNext_700Bold,
} from "@expo-google-fonts/atkinson-hyperlegible-next";
import { BigShouldersDisplay_900Black } from "@expo-google-fonts/big-shoulders-display";
import type { AppVersion } from "@hopon/schemas";
import { PortalHost } from "@rn-primitives/portal";
import Constants from "expo-constants";
import { useFonts } from "expo-font";
import { router, Stack, usePathname } from "expo-router";
import { ThemeProvider } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { api } from "@/lib/api";
import { updateRequired } from "@/lib/min-build";
import { agreedToRules } from "@/lib/rules";
import { NAV_THEME } from "@/lib/theme";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
if (!publishableKey) {
  throw new Error("Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env");
}

export { ErrorBoundary } from "expo-router";

// Signed in without the current Rules version (an older account, or the Rules changed): show the Rules screen.
// Sign-in leads to it itself, carrying where to go next, so the gate waits until that screen is up.
const RulesGate = () => {
  const { user } = useUser();
  const pathname = usePathname();
  const pending = !!user && !agreedToRules(user);
  useEffect(() => {
    if (pending && pathname !== "/rules" && pathname !== "/sign-in") {
      router.push("/rules");
    }
  }, [pending, pathname]);
  return null;
};

// Whether the API says this build is too old for it. Asked once per launch; any failure (offline, an old API) lets the
// app run.
const useUpdateRequired = () => {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    const check = async () => {
      try {
        const { minIosBuild } = await api<AppVersion>("/api/version");
        setRequired(
          updateRequired(Constants.platform?.ios?.buildNumber, minIosBuild)
        );
      } catch {
        // Offline or unreachable: run as usual.
      }
    };
    check();
  }, []);
  return required;
};

// Builds go out through TestFlight, and this opens its app, which offers the new build. Point it at the App Store
// listing once hopon is there.
const UPDATE_URL = "itms-beta://";

const UpdateRequired = () => (
  <View className="flex-1 items-center justify-center gap-6 bg-background px-8">
    {/* oxlint-disable-next-line react/style-prop-object -- expo-status-bar's `style` is a string ("light"), not a style object. */}
    <StatusBar style="light" />
    <Text
      accessibilityRole="header"
      className="text-center font-display text-[44px] leading-[48px]"
    >
      Please update
    </Text>
    <Text className="text-center text-base text-muted-foreground">
      This version of hopon is too old to work anymore. Get the latest one from
      TestFlight.
    </Text>
    <Button
      className="rounded-full"
      onPress={() => Linking.openURL(UPDATE_URL)}
    >
      <Text>Open TestFlight</Text>
    </Button>
  </View>
);

const RootLayout = () => {
  const outdated = useUpdateRequired();
  const [fontsLoaded] = useFonts({
    AtkinsonHyperlegibleNext_400Regular,
    AtkinsonHyperlegibleNext_700Bold,
    BigShouldersDisplay_900Black,
  });
  // Bundled fonts load in a frame or two; rendering before that would flash the system font.
  if (!fontsLoaded) {
    return null;
  }
  if (outdated) {
    return <UpdateRequired />;
  }
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ThemeProvider value={NAV_THEME}>
        {/* oxlint-disable-next-line react/style-prop-object -- expo-status-bar's `style` is a string ("light"), not a style object. */}
        <StatusBar style="light" />
        {/* A new route fails `tsc` until Metro (`CI=1 pnpm run ios`) regenerates the gitignored .expo/types/router.d.ts. */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="create" options={{ presentation: "modal" }} />
          <Stack.Screen name="sign-in" options={{ presentation: "modal" }} />
          <Stack.Screen name="handle" options={{ presentation: "modal" }} />
          <Stack.Screen name="blocked" options={{ presentation: "modal" }} />
          <Stack.Screen
            name="rules"
            options={{ gestureEnabled: false, presentation: "modal" }}
          />
          <Stack.Screen
            name="saved-feed"
            options={{
              headerBackButtonDisplayMode: "minimal",
              headerShown: true,
              title: "Saved",
            }}
          />
        </Stack>
        <RulesGate />
        <PortalHost />
      </ThemeProvider>
    </ClerkProvider>
  );
};

export default RootLayout;
