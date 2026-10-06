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
