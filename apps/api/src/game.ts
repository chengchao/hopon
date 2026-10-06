import { Effect, Schema } from "effect";

// Kept out of index.ts: workerd treats every named export of the Worker entry as an entrypoint.

// The status and message a client sees. Thrown from Hono code, yielded from Effect code; `app.onError` renders both.
export class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
  message: Schema.String,
  status: Schema.Number,
}) {}

export const fail = (status: number, message: string) =>
  new HttpError({ message, status });

export const GAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

// What the model must return: a playable, complete HTML document with a short title and description.
const GeneratedGame = Schema.Struct({
  description: Schema.Trim.check(Schema.isMaxLength(180)),
  html: Schema.String.check(
    Schema.isMaxLength(100_000),
    Schema.isPattern(/<\/html>\s*$/iu),
    Schema.isPattern(/<script[\s>]/iu)
  ),
  title: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(60)),
});

export const parseGame = Effect.fn("parseGame")(function* (text: unknown) {
  if (typeof text !== "string") {
    return yield* fail(502, "AI did not return a game. Please try again.");
  }
  const json = yield* Effect.try({
    catch: () =>
      fail(502, "AI returned an incomplete response. Please try again."),
    try: (): unknown =>
      JSON.parse(
        text
          .replaceAll(/<think>[\s\S]*?<\/think>/gu, "")
          .trim()
          .replace(/^```(?:json)?\s*/u, "")
          .replace(/\s*```$/u, "")
      ),
  });
  return yield* Schema.decodeUnknownEffect(GeneratedGame)(json).pipe(
    Effect.mapError(() =>
      fail(502, "The generated game is incomplete. Please try again.")
    )
  );
});
