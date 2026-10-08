import { openBrowserAsync } from "expo-web-browser";
import { Alert, Linking } from "react-native";

import { API_URL } from "@/lib/api";

// What signed-in people last agreed to, stored as Clerk `unsafeMetadata.rulesAgreed`. Bump it whenever the Rules at
// /terms (apps/api/src/pages.ts) change, and everyone sees the Rules screen again.
export const RULES_VERSION = "2026-10-07";
export const agreedToRules = (
  user?: { unsafeMetadata: { rulesAgreed?: unknown } } | null
) => user?.unsafeMetadata.rulesAgreed === RULES_VERSION;

// Placeholder until the mailbox exists; the Worker has its own copy in apps/api/src/pages.ts.
const CONTACT_EMAIL = "support@hopon.example";

export const openRules = () => openBrowserAsync(`${API_URL}/terms`);

// No mail app (the Simulator has none)? Show the address instead.
export const contactUs = async () => {
  try {
    await Linking.openURL(`mailto:${CONTACT_EMAIL}`);
  } catch {
    Alert.alert("Contact us", CONTACT_EMAIL);
  }
};
