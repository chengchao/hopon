// The Draft list (#119, #149): the part of components/draft-list.tsx the tests drive.
import type { DraftSummary } from "@hopon/schemas";

// A Draft's name wherever it shows: the Maker's title, once it has named the game.
export const draftTitle = (draft: DraftSummary | null | undefined) =>
  draft?.title ?? "New game";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long ago a Draft changed ("2 h ago"), from its ISO `updatedAt`.
// ponytail: days never roll up into weeks or dates; add that if old Drafts read oddly.
export const ago = (iso: string, now = Date.now()) => {
  const since = now - Date.parse(iso);
  if (since < MINUTE) {
    return "just now";
  }
  if (since < HOUR) {
    return `${Math.floor(since / MINUTE)} min ago`;
  }
  if (since < DAY) {
    return `${Math.floor(since / HOUR)} h ago`;
  }
  return `${Math.floor(since / DAY)} d ago`;
};
