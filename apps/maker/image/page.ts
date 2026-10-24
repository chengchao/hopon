// A LittleJS game's index.html: the runtime, then its music when it has some, then the game. The harness writes it into
// each Revision (src/coder.ts) and the box's playtest serves it (helpers.js), so both use these bytes. Siblings are
// relative, so the page plays the same under a Draft's preview URL and a published Game's.
export const MUSIC = "music.js";
// The served scaffolds, at the same paths in the box's playtest and the Worker (apps/maker/src/runtime.ts copies them).
export const RUNTIME_SRC = "/runtime/v2.js";
export const DOM_SRC = "/dom/v1.js";

export const littlejsHtml = (music: boolean) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;overflow:hidden;touch-action:none}</style></head><body><script src="${RUNTIME_SRC}"></script>${music ? `<script src="${MUSIC}"></script>` : ""}<script src="game.js"></script></body></html>`;

// The harness's page rather than a plain-DOM game's own (which loads /dom/v1.js): it never goes into the box.
export const isLittlejsHtml = (html: string) =>
  /<script src="\/runtime\/v\d+\.js">/u.test(html);
