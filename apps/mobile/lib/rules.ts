import { openBrowserAsync } from "expo-web-browser";
import { Alert, Linking } from "react-native";

import { API_URL } from "@/lib/api";

// What signed-in people last agreed to, stored as Clerk `unsafeMetadata.rulesAgreed`. Bump it whenever the Rules at
// /terms (apps/worker/src/pages.ts) change, and everyone sees the Rules screen again.
export const RULES_VERSION = "2026-10-23";
export const agreedToRules = (
  user?: { unsafeMetadata: { rulesAgreed?: unknown } } | null
) => user?.unsafeMetadata.rulesAgreed === RULES_VERSION;

// The Maker's AI disclosure (#125), stored as `unsafeMetadata.aiAgreed`. Bump it only when WHAT the Maker sends changes
// (or a provider would train on it); a new model or provider is an edit to /privacy#maker, not a new version.
export const AI_VERSION = "2026-10-23";
export const agreedToAi = (
  user?: { unsafeMetadata: { aiAgreed?: unknown } } | null
) => user?.unsafeMetadata.aiAgreed === AI_VERSION;

export const openMakerPrivacy = () =>
  openBrowserAsync(`${API_URL}/privacy#maker`);

// The Worker has its own copy in apps/worker/src/pages.ts.
export const CONTACT_EMAIL = "support@gethopon.app";

export const openRules = () => openBrowserAsync(`${API_URL}/terms`);

// No mail app (the Simulator has none)? Show the address instead.
export const contactUs = async () => {
  try {
    await Linking.openURL(`mailto:${CONTACT_EMAIL}`);
  } catch {
    Alert.alert("Contact us", CONTACT_EMAIL);
  }
};
