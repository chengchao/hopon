// Request bodies the API accepts, shared so the app enables Post and Make only for input the API will take.
// A namespace import keeps bundles to the parts used (`import { z }` adds ~110 KiB gzipped to the Worker).
import * as z from "zod/mini";

export const PROMPT_MAX = 2000;
export const COMMENT_MAX = 300;
// A game's title and description, as the Maker writes them for a Draft.
export const GAME_TITLE_MAX = 60;
export const GAME_DESCRIPTION_MAX = 180;
// A Game's Caption, as its Creator writes it on the publish sheet.
export const GAME_CAPTION_MAX = 180;
// A Creator's 21st Draft is refused: the API checks it, and the app disables New game.
export const MAX_DRAFTS = 20;

// Counts characters like SQLite's length(), not UTF-16 units.
export const characters = (text: string) => [...text].length;

// A message to the Maker, the first of a new Draft or a later one.
export const newMessage = z.object({
  text: z.string().check(z.maxLength(PROMPT_MAX), z.trim(), z.minLength(1)),
});

export const newComment = z.object({
  body: z.string().check(
    z.trim(),
    // A NUL would cut SQLite's length() short of the real text.
    z.refine((text) => {
      const length = characters(text);
      return length >= 1 && length <= COMMENT_MAX && !text.includes("\0");
    })
  ),
});

// A Game's Caption: one line of text. Empty is allowed: the feed then shows only who made the game.
const gameCaption = z.string().check(
  z.trim(),
  z.refine(
    (text) => characters(text) <= GAME_CAPTION_MAX && !/[\0\n\r]/u.test(text)
  )
);

export const publishGame = z.object({
  caption: gameCaption,
});

// A request for a Caption. `current` is the one the Creator is looking at, if any, so the next one differs.
export const newCaption = z.object({
  current: z.optional(gameCaption),
});

// Why someone reports a game or comment, in the order the app lists them.
export const REPORT_REASONS = [
  { label: "Not suitable for ages 13+", reason: "age" },
  { label: "Hateful or harassing", reason: "hate" },
  { label: "Spam or scam", reason: "spam" },
  { label: "Something else", reason: "other" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["reason"];

export const newReport = z.object({
  reason: z.enum(REPORT_REASONS.map((r) => r.reason)),
});

// What the API sends back. The API checks each response with `satisfies`, so renaming a field breaks the build instead of a screen.

/** One of the signed-in user's Drafts. `title` and `description` are null until the Maker names the game. */
export interface DraftSummary {
  id: string;
  title: string | null;
  description: string | null;
  /** A link to a screenshot of the game, good for at least an hour; null when the Draft has no game or its Revision has no cover. */
  cover: string | null;
  /** When the Maker took the message its current turn answers; null while it waits for the Creator. */
  turnStartedAt: string | null;
  updatedAt: string;
}

/**
 * The signed-in Creator's weekly Allowance of hopon tokens (ADR 0004): `left` is below zero when the last turn overshot,
 * and the week ends at `resetsAt`, Monday 00:00 UTC.
 */
export interface Allowance {
  left: number;
  weekly: number;
  resetsAt: string;
}

/** The oldest iOS build number (CFBundleVersion) the API still serves; an older build asks to be updated. */
export interface AppVersion {
  minIosBuild: number;
}

/** The code on a message the Maker refuses because the Allowance is used up. */
export const ALLOWANCE_USED = "allowance_used";

/** A published game's id, title and Caption, which may be empty. */
export interface GameSummary {
  id: number;
  title: string;
  caption: string;
}

/** A Caption written for a Draft's game at its Creator's request, to keep, change or replace on the publish sheet. */
export interface Caption {
  caption: string;
}

/** A published game on a feed, as the viewer sees it. */
export interface FeedGame extends GameSummary {
  /** The creator's @handle when they published. */
  author: string | null;
  likes: number;
  liked: boolean;
  comments: number;
  /** Saves are private, so there's no count. */
  saved: boolean;
  /** True on the viewer's own games, which they can't report. */
  mine: boolean;
  /** On a Remix, the @handle of the Game it was remixed from; null otherwise, or once that Game is Deleted. */
  remixOf: string | null;
}

/** A game in the viewer's Saved list. */
export interface SavedGame extends FeedGame {
  /** The save's id, which is the list's paging cursor. */
  saveId: number;
}

export interface Comment {
  id: number;
  /** The commenter's @handle when they posted. */
  author: string;
  body: string;
  createdAt: string;
  /** True for the commenter and for the game's creator. */
  canDelete: boolean;
  /** True on the viewer's own comments, which they can't report. */
  mine: boolean;
}

// Pages run newest first. `next` is the `?before=` cursor for the following page, or null after the last one.
export interface GamePage<T extends FeedGame = FeedGame> {
  games: T[];
  next: number | null;
}

export interface CommentPage {
  comments: Comment[];
  next: number | null;
}

/** A game or comment in the Operator's queue: the snapshot from its oldest open report, and every open report's reason. */
export interface ReportTarget {
  kind: "game" | "comment";
  /** The game's or the comment's id. */
  id: number;
  /** The game, or the game the comment is on. */
  gameId: number;
  /** The poster's @handle. */
  handle: string | null;
  /** A game's title and Caption; null on a comment. */
  title: string | null;
  caption: string | null;
  /** A comment's body; null on a game. */
  body: string | null;
  reasons: { reason: ReportReason; count: number }[];
  /** When its oldest open report was filed, as SQLite's `YYYY-MM-DD HH:MM:SS` in UTC. */
  reportedAt: string;
  /** False once the content is gone ("content deleted"). */
  live: boolean;
}

/** Someone the viewer has Blocked, as their Blocked accounts list shows them. */
export interface BlockedAccount {
  /** The opaque id to unblock with. */
  id: number;
  /** Their @handle when they were blocked, kept through a rename. */
  handle: string | null;
}

/** The viewer's Blocked accounts, newest first. */
export interface BlockedAccounts {
  blocks: BlockedAccount[];
}
