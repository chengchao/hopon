import { ALLOWANCE_USED } from "@hopon/schemas";
import { Schema } from "effect";

// Kept out of index.ts: workerd treats every named export of the Worker entry as an entrypoint.

// The status and message a client sees, plus a `code` when the app acts on the error, not just shows it.
// Thrown from Hono code, yielded from Effect code; `app.onError` renders both.
export class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
  code: Schema.optional(Schema.Literals(["handle_rejected", ALLOWANCE_USED])),
  message: Schema.String,
  status: Schema.Number,
}) {}

export const fail = (
  status: number,
  message: string,
  code?: HttpError["code"]
) => new HttpError({ code, message, status });

// 'self' is the served scaffolds (/runtime/v2.js, /dom/v1.js) and a game's own files.
export const GAME_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src 'self' data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
