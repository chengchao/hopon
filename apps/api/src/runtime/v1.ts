// PROTOTYPE: how /document wires a game to the runtime. The runtime and music bytes are in ./files.ts.
// A game opts in with this marker in its <body>; /document swaps it for the runtime and the music element.
export const RUNTIME_MARKER = "<!-- hopon:runtime v1 -->";
export const runtimeTags = (id: number) =>
  // The inline reporter goes first so it sees a CSP refusal of the runtime itself.
  `<script>addEventListener("securitypolicyviolation",(e)=>window.ReactNativeWebView?.postMessage(JSON.stringify({event:"csp",directive:e.violatedDirective,uri:e.blockedURI})))</script>
<script src="/runtime/v1.js"></script>
<audio data-hopon-music loop preload="auto" src="/api/games/${id}/assets/music.mp3"></audio>`;

// script-src 'self' for /runtime/v1.js, media-src 'self' for /assets. Everything else matches GAME_CSP.
export const RUNTIME_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src 'self' data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
