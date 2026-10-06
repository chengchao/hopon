// Kept out of index.ts: workerd treats every named export of the Worker entry as an entrypoint.
export const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

export const GAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";

export const parseGame = (text: unknown) => {
  if (typeof text !== "string") {
    throw fail(502, "AI did not return a game. Please try again.");
  }
  let game;
  try {
    game = JSON.parse(
      text
        .replaceAll(/<think>[\s\S]*?<\/think>/gu, "")
        .trim()
        .replace(/^```(?:json)?\s*/u, "")
        .replace(/\s*```$/u, "")
    );
  } catch {
    throw fail(502, "AI returned an incomplete response. Please try again.");
  }
  if (
    !game ||
    typeof game.title !== "string" ||
    !game.title.trim() ||
    game.title.length > 60 ||
    typeof game.description !== "string" ||
    game.description.length > 180 ||
    typeof game.html !== "string" ||
    game.html.length > 100_000 ||
    !/<\/html>\s*$/iu.test(game.html) ||
    !/<script[\s>]/iu.test(game.html)
  ) {
    throw fail(502, "The generated game is incomplete. Please try again.");
  }
  return {
    description: game.description.trim(),
    html: game.html,
    title: game.title.trim(),
  };
};
