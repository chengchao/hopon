// A LittleJS game's index.html: the runtime, then its music when it has some, then the game. The harness writes it into
// each Revision (src/job.ts) and the box's playtest serves it (helpers.js), so both use these bytes. Siblings are
// relative, so the page plays the same under a Draft's preview URL and a published Game's.
export const MUSIC = "music.js";
// The served scaffolds, at the same paths in the box's playtest and the Worker (apps/maker/src/runtime.ts copies them).
export const RUNTIME_SRC = "/runtime/v2.js";
export const DOM_SRC = "/dom/v2.js";

export const littlejsHtml = (music: boolean) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;overflow:hidden;touch-action:none}</style></head><body><script src="${RUNTIME_SRC}"></script>${music ? `<script src="${MUSIC}"></script>` : ""}<script src="game.js"></script></body></html>`;

// The harness's page rather than a plain-DOM game's own (which loads /dom/vN.js): it never goes into the box.
export const isLittlejsHtml = (html: string) =>
  /<script src="\/runtime\/v\d+\.js">/u.test(html);

const MUSIC_SCRIPT = `<script src="${MUSIC}"></script>`;
// A plain-DOM game's own index.html on the current scaffold, loading its music right after it exactly when it has some.
// The sub agent never writes the music's script: the box's playtest has no music.js to serve.
export const domHtml = (html: string, music: boolean) => {
  const page = html
    .replaceAll(MUSIC_SCRIPT, "")
    .replace(
      /<script src="\/dom\/v\d+\.js"><\/script>/u,
      `<script src="${DOM_SRC}"></script>`
    );
  return music
    ? page.replace(
        `<script src="${DOM_SRC}"></script>`,
        (scaffold) => `${scaffold}${MUSIC_SCRIPT}`
      )
    : page;
};
