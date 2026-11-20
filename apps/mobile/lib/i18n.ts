// The app's language, picked once at launch from the phone's: a table in lib/strings per language, English when the
// phone's isn't one of them. A new language is its file there plus its line in TABLES.
import { en } from "./strings/en.ts";
import type { Strings } from "./strings/en.ts";
import { zh } from "./strings/zh.ts";

const TABLES: Record<string, Strings> = { en, zh };

// The phone's first language. iOS hands an app only the languages its bundle declares, so there Intl says English
// even on a Chinese phone; Settings reads the phone's own list. Node, which runs the tests, has no react-native.
const preferred = (): string => {
  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    // oxlint-disable-next-line node/global-require, unicorn/prefer-module -- only React Native has react-native; the tests run in Node.
    const { Platform, Settings } = require("react-native");
    const languages: unknown =
      Platform.OS === "ios" && Settings.get("AppleLanguages");
    if (Array.isArray(languages) && typeof languages[0] === "string") {
      return languages[0];
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().locale;
};

const tag = preferred();
const [language = "en"] = tag.split("-");

export const locale = language in TABLES ? language : "en";
export const t = TABLES[locale] ?? en;
// For dates and numbers: the phone's own tag (its region's clock and all) when the app speaks its language.
export const formatLocale = locale === language ? tag : "en";
