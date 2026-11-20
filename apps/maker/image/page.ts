// A game's built index.html: the scaffold, then the game. The box's playtest writes it into dist/ (helpers.js), and a
// Revision holds dist/'s files, so the phone loads the page the playtest ran. Siblings are relative, so the page plays
// the same under a Draft's preview URL and a published Game's.
// The served scaffolds, at the same paths in the box's playtest and the Worker (apps/maker/src/runtime.ts copies them).
export const RUNTIME_SRC = "/runtime/v4.js";
export const DOM_SRC = "/dom/v4.js";
// The Vite games' scaffold (hopon.js). Its page is the one `vite build` writes from the game's own index.html.
export const HOPON_SRC = "/hopon/v2.js";
// The served-runtime CSP: scripts, styles, images, fonts, media and fetches from the game's own origin only. The box's
// playtest serves a game under it (helpers.js), and check.test.ts loads the Vite fixtures under it.
export const GAME_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
// A Revision from before source.tgz loads its music as this script, which sets hopon.music to the Opus loop in base64.
const MUSIC_SCRIPT = `<script src="music.js"></script>`;

// The built game's own files the page loads besides game.js: its Opus loop, which the scaffold fetches from its
// script's data-music, and the stylesheet esbuild makes of the CSS game.ts imports (a Vite build links its own).
export interface PageFiles {
  music?: string;
  css?: string;
}
const scaffoldTag = (src: string, { music }: PageFiles) =>
  `<script src="${src}"${music ? ` data-music="${music}"` : ""}></script>`;
const cssTag = ({ css }: PageFiles) =>
  css ? `<link rel="stylesheet" href="${css}">` : "";

export const littlejsHtml = (files: PageFiles = {}) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;overflow:hidden;touch-action:none}</style>${cssTag(files)}</head><body>${scaffoldTag(RUNTIME_SRC, files)}<script src="game.js"></script></body></html>`;

// The harness's page rather than a plain-DOM game's own (which loads /dom/vN.js): it never goes into the box.
export const isLittlejsHtml = (html: string) =>
  /<script src="\/runtime\/v\d+\.js"[^>]*>/u.test(html);

// A plain-DOM game's own index.html on the current scaffold, naming its music and linking its stylesheet exactly when
// it has them. The agent writes neither: the playtest builds them.
export const domHtml = (html: string, files: PageFiles = {}) => {
  const page = html
    .replaceAll(MUSIC_SCRIPT, "")
    .replace(
      /<script src="\/dom\/v\d+\.js"[^>]*><\/script>/u,
      scaffoldTag(DOM_SRC, files)
    );
  const css = cssTag(files);
  if (!css || page.includes(css)) {
    return page;
  }
  return page.includes("</head>")
    ? page.replace("</head>", `${css}</head>`)
    : `${css}${page}`;
};

// A Vite game's built index.html on the current scaffold, its tag naming its music exactly when it has some. A game
// written on an older scaffold moves to the current one when it's built again.
export const viteHtml = (html: string, files: PageFiles = {}) =>
  html.replace(
    /<script src="\/hopon\/v\d+\.js"[^>]*><\/script>/u,
    scaffoldTag(HOPON_SRC, files)
  );
