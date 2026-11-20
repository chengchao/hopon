// The app's language, picked once at launch from the phone's: a table in lib/strings per language, English when the
// phone's isn't one of them. A new language is its file there plus its line in TABLES.
import { en } from "./strings/en.ts";
import type { Strings } from "./strings/en.ts";
import { zh } from "./strings/zh.ts";

const TABLES: Record<string, Strings> = { en, zh };

const [language = "en"] = Intl.DateTimeFormat()
  .resolvedOptions()
  .locale.split("-");

export const locale = language in TABLES ? language : "en";
export const t = TABLES[locale] ?? en;
