// The Draft list (#119, #149): the part of components/draft-list.tsx the tests drive.
import type { DraftSummary } from "@hopon/schemas";

import { t } from "./i18n.ts";

// A Draft's name wherever it shows: the Maker's title, once it has named the game.
export const draftTitle = (draft: DraftSummary | null | undefined) =>
  draft?.title ?? t.drafts.newGame;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long ago a Draft changed ("2 h ago"), from its ISO `updatedAt`.
// ponytail: days never roll up into weeks or dates; add that if old Drafts read oddly.
export const ago = (iso: string, now = Date.now()) => {
  const since = now - Date.parse(iso);
  if (since < MINUTE) {
    return t.drafts.ago.now;
  }
  if (since < HOUR) {
    return t.drafts.ago.minutes(Math.floor(since / MINUTE));
  }
  if (since < DAY) {
    return t.drafts.ago.hours(Math.floor(since / HOUR));
  }
  return t.drafts.ago.days(Math.floor(since / DAY));
};
