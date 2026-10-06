// Request bodies the API accepts, shared so the app enables Post and Make only for input the API will take.
// A namespace import keeps bundles to the parts used (`import { z }` adds ~110 KiB gzipped to the Worker).
import * as z from "zod/mini";

export const PROMPT_MAX = 2000;
export const COMMENT_MAX = 300;

// Counts characters like SQLite's length(), not UTF-16 units.
export const characters = (text: string) => [...text].length;

export const newGame = z.object({
  prompt: z.string().check(z.maxLength(PROMPT_MAX), z.trim(), z.minLength(4)),
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

// What the API sends back. The API checks each response with `satisfies`, so renaming a field breaks the build instead of a screen.

/** A new game, or the signed-in user's latest draft. */
export interface GameSummary {
  id: number;
  title: string;
  description: string;
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
