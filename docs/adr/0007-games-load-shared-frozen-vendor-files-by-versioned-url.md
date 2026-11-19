# 7. Games load shared, frozen vendor files by versioned URL

## Status

Accepted. ADR 0003's box and ADR 0006's single agent stay as they are.

## Context

The Maker will build games as Vite projects: 2D games in Phaser, 3D games in React Three Fiber, and card, quiz and puzzle games in React. These libraries are large. The spike on branch `spike/vite-engines` (commit `8e7cc24`) built three games both ways in the box with no network. Bundled, each game shipped 67 to 412 KB gzip. With the libraries left as imports of shared files, each game shipped about 2 KB gzip of its own code. The feed loads a new game on every swipe, so a bundled Phaser game would fetch Phaser again on each one.

## Decision

- **One file per library, by version.** The Worker serves each library as one minified ES module at `/vendor/<lib>-<version>.js`: React, React DOM, Phaser, three and React Three Fiber. `apps/maker/vendor/build.ts` builds them with Vite's library mode from the versions `apps/maker` pins, and commits each gzipped, as a JSON string of the gzip's base64, in `apps/worker/src/vendor/`. The Worker sends those bytes as they are to a client that takes gzip and unzips them for one that doesn't, so it never compresses 1.7 MB of Phaser per request. A file that imports another library imports it by that library's URL, so a page loads one React and one three.
- **Frozen from the first deploy.** Each file is served with `Cache-Control: immutable`, and a phone or a published Game may hold it for good. Its sha256 is in `FROZEN` in `build.ts`, and a build that differs fails. A library upgrade ships as a new file at a new URL, and the old one stays served for the Games that load it.
- **The game's build bakes the URLs.** A game's `vite build` maps each library's bare specifiers (`react`, `react/jsx-runtime`, `react-dom/client`, `phaser`, `three`, `@react-three/fiber`) to its vendor URL and leaves them external. The box installs the same versions, so a game typechecks against the code it will load. `src/vendor.test.ts` fails when the box's versions and the vendor files' versions differ.
- **One scaffold for every engine.** `/hopon/v1.js` is a classic script that loads before the game's module. It keeps the score and the state, shows the start and over screens as a DOM overlay, plays the music, carries the feed's pause, resume and mute, and holds the game's `testVars`. It freezes when the first Game uses it, in P5. Until then the Worker serves it with `Cache-Control: no-cache`, and the box's playtest doesn't serve it, so a page that loads it fails the check and no Revision depends on bytes that may still change.
- **Cross-origin headers.** A game's page is sandboxed by its CSP, so its origin is opaque, and every module script it loads is a CORS request. The vendor files and `/hopon/v1.js` carry `Access-Control-Allow-Origin: *`. In the box's Chromium, a module from a sandboxed page fails to load without that header.
- **Phaser 4.** The vendor file is Phaser 4.2.1, the version the spike ran. The model may know Phaser 3's API better. P5's eval measures that, and a Phaser 3 file can ship beside it at its own URL if it does.

## Alternatives rejected

- **Bundle each library into each game.** Simpler to build and serve, but 67 to 412 KB gzip per game, fetched again on each swipe to another game.
- **An import map.** It would keep bare specifiers in the built game and map them in the page. An import map must be an inline script, and the box's game CSP allows scripts only from the game's origin. Baked URLs also fix each Game to the versions it was built and tested with.
- **A CDN such as esm.sh.** The box has no network, the game CSP allows only the game's own origin, and a third party could change or drop a file a published Game needs.

## Consequences

- A game's own files stay small, and the phone caches each library once across the feed. The spike measured about 4% more bytes on a cold cache than a bundled game, because a shared file can't drop the parts one game doesn't use.
- The Worker's bundle grows by the vendor files, about 0.7 MB gzipped, 0.9 MB as base64.
- The box image grows by Vite, the libraries and their types.
- Each library upgrade is a new frozen file and a new box image with the matching version.
