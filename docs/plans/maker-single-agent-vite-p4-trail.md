# P4 trail: Vite games on shared vendor files

The decisions behind P4 of `maker-single-agent-vite.md`, in order. Each names what it changed and its evidence. P4 ships in two PRs: P4a (#221) lays the parts that don't depend on P3, and P4b switches the playtest and `build` to `vite build` on top of P3 (#220).

## P4a: vendor files, serving, scaffold, image

### Build

- **Branch.** `claude/p4a-vendor` from `origin/main` at `b933ddb`.
- **The vendor build runs on the host, not in the box.** `apps/maker/vendor/build.ts` uses Vite's library mode from `apps/maker`'s devDependencies, as `src/runtime.ts` builds LittleJS from `littlejsengine`. The bytes then come from `pnpm-lock.yaml`, and `src/vendor.test.ts` rebuilds them in about 0.6 s and fails when they differ from the committed JSON. The spike's `box/vendor.mjs` ran inside the box. Its approach carries over: the CommonJS entry that names React's exports, the `enforce: "pre"` sibling plugin that turns a sibling library into a re-export of its URL, three's missing default, and esbuild's minify.
- **A version comes from `apps/maker/package.json`, pinned exactly.** `three`'s `exports` hides its `package.json`, so the build reads the pin instead, and refuses a range.
- **Frozen like the scaffolds.** `FROZEN` holds every served vendor file's route and sha256. A build that differs from a frozen file fails, and a new file fails with the entry to add. The Worker's `api.ts` imports each JSON by name, and `worker.test.js` lists `src/vendor/` and asserts each is served, so a file without a route fails.
- **Phaser 4.2.1 only.** Shipping 3.90 as well would need an npm alias in the box (`phaser3@npm:phaser@3.90.0`), its own types and its own specifier, and P5 would still have to pick one per game. The spike ran 4.2.1, so it ships alone. P5's eval measures Sonnet on Phaser 4's API, and a Phaser 3 file can follow at its own URL.
- **`/hopon/v1.js`.** `apps/maker/image/hopon.js`, from the spike's `box/hopon.js` with the music and bridge of P3's `/dom/v4.js`: the page names `music.opus` on the script's `data-music`. It adds `hopon.title` and `hopon.hint` for the start screen, as the LittleJS scaffold has, `hopon.testVars` (a module can't declare a global), and the `hoponClock` frame counter the playtest reads. `ready()` sets `hopon.loaded`. Its types are `image/hopon-v1.d.ts`. `src/runtime.ts` freezes it as `HOPON_V1_SHA256` and writes `apps/worker/src/runtime/hopon-v1.json`. The box's playtest serves it at the same path. Freezing now means a change before any Game uses it still ships as v2. That cost is one more route.
- **CORS on every scaffold route.** The old `/runtime` and `/dom` routes share the loop and get `Access-Control-Allow-Origin: *` too. They are public scripts, so the header is harmless.
- **The image.** One `RUN` installs Vite 8.3.8, `@vitejs/plugin-react` 6.3.0, the five libraries and `@types/react`, `@types/react-dom` and `@types/three` into `/opt/hopon`, links `/opt/hopon/node_modules` at `/node_modules`, and removes Phaser's `src`, `tests`, `docs` and `changelog`. Debian's `/etc/profile` resets `PATH` in a login shell, which is what the model's bash runs, so `ENV PATH` alone left `vite` and `tsc` off it. `/etc/profile.d/hopon.sh` adds them. Measured: `bash -lc 'command -v vite'` printed nothing before that line.
- **The box's game CSP moved to `page.ts`.** `check.test.ts` needs it, and it can't import `helpers.js` from TypeScript. `helpers.js` imports it from there.

### Verify, unit

- `pnpm check` green at `2220f42`.
- Mutations, each red then restored. A changed byte in `react-19.3.1.json` fails "the Worker serves each vendor file as it was frozen" and "the vendor build makes the bytes the Worker serves". `phaser@4.2.0` in the Dockerfile fails "the box installs the versions the vendor files are built from". A changed constant in `hopon.js` fails "the Worker serves the Vite games' scaffold the box serves", and `build:runtime` refuses with "/hopon/v1.js is frozen and this build differs from it". Removing the `Access-Control-Allow-Origin` line from `api.ts` fails the worker test "vendor:".
- `HOPON_BOX_IMAGE=hopon-box:p4a pnpm -F maker test`: 42 of 42, on an image built from this head (arm64, local Docker). The new cases write three fixtures (`apps/maker/fixtures/vite/`: a React quiz, a Phaser scene, an r3f spinner) into a box started with `--network none`, run `tsc -p . && vite build` in a login shell with the libraries external at their vendor URLs, then serve the build, `/hopon/v1.js` and the vendor files from a Node HTTP server in the box under the box's game CSP. Chromium loads each with no console error, `origin` is `"null"`, the game calls `ready()`, a tap takes the overlay from start to play, and the engine's loop ran. Each library's file loads once, and each game's own files are under 10 KB gzip.
- **CORS is enforced on a sandboxed page's modules, in Chromium.** The first version of the no-header case served through Playwright's `page.route`, and the page still loaded: routing skips the CORS check, which the plan's Appendix A suspected. Served by a real HTTP server, the same page without the header fails to load its modules. The case stays in `check.test.ts`.

### Verify, live

- **Preview.** `https://claude-p4a-vendor-hopon.calendeam.workers.dev`, deployed from `2220f42`. Each `/vendor/*` file and `/hopon/v1.js` answered 200, `text/javascript; charset=utf-8`, `Content-Encoding: gzip`, `public, max-age=31536000, immutable`, `Access-Control-Allow-Origin: *`, and its unzipped sha256 matches `FROZEN`. The table is in the PR's comment. Phaser's file took 0.6 to 1.0 s in total over three fetches from the Mac mini.

### Sizes

- Vendor files, gzip: react 4.1 KB, react-dom 67.0 KB, phaser 380.4 KB, three 192.3 KB, r3f 60.4 KB. The spike reported 3.8, 64.8, 357.8, 185.9 and 58.0 KB. Each file is 3 to 8% larger here. Guess: the spike measured with a different gzip level. The versions and the minifier match.
- Image, arm64, local Docker, measured against main's Dockerfile built from the same context: `docker image inspect .Size` 501.8 MB to 535.5 MB, +33.7 MB. `docker image ls` 1.81 GB to 2.02 GB on disk. `/opt/hopon/node_modules` is 211 MB, Phaser's types 54 MB of it. The spike's +43.6 MB was amd64 under Rosetta, with its own measure. Not measured here: the amd64 image Cloudflare runs.
- Worker: `wrangler deploy --dry-run` uploads 10,520 KiB, 2,261 KiB gzip.

### Not done in P4a

- The playtest and `build` still bundle with esbuild. P4b switches them to `vite build`, serves the vendor files in the box's playtest, and advances fake frames while a game loads.
- The box serves `/hopon/v1.js` to the playtest but no vendor file, since no harness path builds a Vite game yet.
- iOS and Android WebViews: whether they enforce CORS on these modules and share the HTTP cache across feed games stays unproven. The plan's lanes 2 to 5 cover it in P4b.
