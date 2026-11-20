# P5 trail: the agent writes Phaser, r3f and React games

The decisions behind P5 of `maker-single-agent-vite.md`, in order. Each names what it changed and its evidence, marked measured, inferred or guess. The decision itself is ADR 0008.

## Build

- **Branch.** `claude/p5-engines` from `origin/main` at `5238d5d`. The trunk side of the sweeps is `claude/p5-trunk`: main plus one file, `p5-trunk.md`, at the root, since the Deploy workflow ignores `docs/**`.
- **Three engine guides, written in parallel, each from one shared contract.** They began as skills and became make-game's references (see "One skill"). The contract fixed the project layout, the scaffold's state machine (the overlay owns `start` to `play`; the game gates on `hopon.state`, resets on a new round, follows `hopon.paused`), and the nine things each guide covers. Each guide's example game was written as files, run green in the box, then assembled into the guide by a script, so the example in the guide is the code that ran (measured: each was extracted back out and diffed). After review, one script extracts all three examples from the committed guides and runs them on the head's image: each playtest and each test suite is green (measured).
- **Phaser traps the guide names were each reproduced against 4.2.1.** `setTintFill(color)`, `sprite.preFX`, `particles.createEmitter`, `Phaser.Math.PI2`, `gravity: { y }` without `x`, and plain objects for `fillPoints` fail the typecheck. `fillGradientStyle` inside `generateTexture` draws nothing, since the canvas renderer skips gradient fills. `textures.createCanvas` with a key in use logs an error, which turns a restart red. A scene with no key is `"default"`. The start tap reaches Phaser as neither pointerdown nor pointerup (all measured).
- **Phaser draws at the phone's pixel ratio, in CSS px.** The first version drew at a fixed 720 × 1280 for sharp phones, so a test's taps were half the game's coordinates, and 9 s of play took 23 to 27 s in the box against 8 to 11 s at 360 (measured). The game is now the viewport times `ZOOM = min(devicePixelRatio, 2)` with the camera zoomed by `ZOOM`, textures drawn on canvases at `ZOOM`× with the source's resolution set, and text with `resolution: ZOOM`. World units are CSS px. The Phaser guide's example went from 7.4 to 8.0 s of wall time for its random script to 2.9 to 3.1 s (measured, load average 4 to 5). A render with `deviceScaleFactor: 2` is sharp (measured, screenshots in the scratchpad). `setTrim` with `source.resolution` isn't a documented Phaser API, so an upgrade must re-run the probe (inferred).
- **r3f.** three 0.187 removed `PCFSoftShadowMap`, which r3f's `shadows` asks for, and warns; the skill uses `shadows="percentage"`. Changing `frameloop` resets r3f's clock. Instanced meshes and points compute their bounds once, so moving ones need `frustumCulled={false}`. A camera shake that draws from `Math.random` every frame makes runs differ, since the load moves a varying number of frames (all measured or read in source with line numbers in the agent's report). The example renders with `antialias: false`, Lambert and Basic materials for scenery and blob shadows: each saved 3.5 to 5.5 CPU-s of a 10 s playtest in the box's software GPU (measured). 10 s of its play took 4.7 to 4.8 s of wall time (measured, load 4).
- **React.** State set from timers renders on the fake clock (P4b's fixes hold). CSS runs on real time, so tests read state. The overlay takes the start tap even from an `onClick` on a full-screen button beneath it (measured).
- **`sound-effects` replaces `zzfx`.** `src/sfx.ts` is a small Web Audio synth: oscillators and filtered noise with a pitch glide and an envelope, made at the first touch, silent when muted, suspended when paused. A probe game that plays two sounds on a right answer passes its test with no console error (measured).
- **make-game picks the engine and ports old Drafts.** "An old game" says how the agent knows (a `game.ts` and no `vite.config.ts`; with an `index.html` it is plain DOM) and what it keeps. The performance section lost its LittleJS lines. `maker.md` didn't change: the engine is the skill's business (ADR 0006).
- **verify.js refuses an unported game.** A `game.ts` without `vite.config.ts` fails with a sentence that points to "An old game", so `build` can't publish one (measured, `verify.test.js`).
- **The box keeps building `game.ts`.** It lets the agent play an old Draft before porting it, and the harness's two dozen P3 cases use a LittleJS fixture. Deviation from the plan, which said to delete the LittleJS d.ts and engine path: the parent brief asked to keep what checks old Drafts.
- **Port fixtures.** `apps/maker/fixtures/port/{fruit-catcher,ocean-memory}/{before,after}`: the eval's LittleJS and plain-DOM games with a `design.md` and `tests.json` written from their code, and their Phaser and React ports. `before/game.ts` gained only the `testVars` lines its tests read. Both are in the lint ignores, as the eval's revisions are: they stand for code the agent writes.

## One skill: the guides are make-game's references

- **The operator's call, mid-run.** The engine guides, sound effects and music are references of `make-game`, not skills: the agent must always enter through make-game (in P2's live runs it once loaded only an engine skill and never saw make-game's design, tests and music rules), and a guide is material for making a game, not a task of its own.
- **How the agent reads one, settled by a run.** `agents/skills`' manifest entries take `resources`, and `agents/harness/pi`'s `skills()` gives the model `read_skill_resource` beside `activate_skill` (`node_modules/agents/dist/harness/pi/index.js`, `resolveSkillSources`). The Worker now bundles the six guides as make-game's resources, kind `reference`. The worker test "skills: the agent loads make-game, and reads an engine's guide from it through the real tools" drives the real Maker, harness and tools with the fake model: `activate_skill {"name": "make-game"}` returns the SKILL.md and a `<skill_resources>` list with `<file kind="reference" encoding="text">references/phaser.md</file>` and the five others; `read_skill_resource {"name": "make-game", "path": "references/phaser.md"}` returns the guide in a `<skill_resource>` tag; an unknown path returns "Skill resource not found: make-game/references/littlejs.md" (measured). With the resources dropped from the manifest the test is red (measured). The box needs nothing: the guides never enter the workspace, so `source.tgz` can't carry them.
- **The live probe agrees.** On the head's Preview at `3dcb3db`, "Make whack-a-mole but with frogs." ran, in order: `activate_skill {"name":"make-game"}`, `read_skill_resource {"name":"make-game","path":"references/phaser.md"}`, the same for `references/sound-effects.md` and `references/music-synth.md`, then four writes by bash, one `playtest`, and a `build` that published a Phaser game with `src/sfx.ts` and music (measured, from the Draft's snapshot; the sixth and last Draft of the live lanes).
- **music-synth and music-sf2 moved too**, at the operator's second call. Their skeletons are code blocks in the guides, which `music-synth.test.ts` and the music-sf2 docker case read from the new paths.
- **Step label.** `read_skill_resource` shows as "Reading the docs", as `activate_skill` does.

## The scaffold, before it froze

- **The start tap's release reached the game.** The overlay hides on `pointerdown`, so the `pointerup`, `touchend` and `click` after it landed on the game. An r3f game that steered on `pointerup` changed lane when the round started (measured by the r3f author). The overlay now swallows each of them once, and the next press ends the swallowing for a browser that didn't send one. Case: "the tap that starts a round is the scaffold's", red on the P4b image (`ups` 1 and `clicks` 1 after the start tap) and green on the head's (measured).
- **The over screen's words are the game's to set.** The Spanish live lane's game set its title and hint in Spanish, but the scaffold's "Game over", "Score", "Best" and "Tap to play again" were fixed English, as the LittleJS scaffold's are. Freezing that would fix English on every non-English Game for good. `hopon.text` holds the five words, English by default, and make-game's Language line says to set them. A quiz with `hopon.text` in Spanish shows "Fin del juego", "Puntos", "Récord" and "Toca para jugar otra vez" (measured, screenshot `head-out/live-quiz-es-end.png` in the scratchpad).
- **The overlay has a soft vignette and a text shadow.** The start and end screenshots are what the judge sees first and last.
- **Rejected: a `hopon.round` counter, a pause attribute on `<html>`, and an over-screen line.** Each would save a game a few lines; the skills' examples work without them. Not worth a frozen API without a measured need.
- **Frozen.** `HOPON_V1_SHA256` in `runtime.ts`; `build:runtime` refuses a change; the Worker serves it `immutable` and its test checks the sha256.

## The playtest's clock

- **A timer at a frame's instant skipped the frame.** The next frame was derived from `now`, which the timer had just set. A 100 ms timer cost one frame in six: 50 frames and 10 ticks in a second of game time, against 60 (measured on the P4b image). The clock now keeps the next frame's time. Case: "a frame due at a timer's instant still runs", red on the P4b image and green on the head's.
- **A throw in a frame crashed the harness.** The page's exception propagated out of `page.evaluate`, so `playtest.js` died with a Node stack. Each callback now runs in a `try` that reports the error to the page. Case: "a game that throws in a frame fails the check with its error", red then green (measured).

## The eval

- **The judge reads `.tsx` and `.jsx`.** `CODE` in `judge.ts` matched `.ts`, `.css` and `.html`, so a React game's components never reached it.
- **The final checks build Vite games on the Mac.** `preview.ts` runs the box's `playtest.js` in `apps/maker/out/`. A React game's typecheck failed there with "Could not find a declaration file for module 'react'" (measured): the types were only in the image. `apps/maker` now has `@types/react`, `@types/react-dom` and `@types/three` at the image's versions. pnpm re-resolved the optional `@types/react-dom` peer of two mobile packages in the lockfile; `pnpm check` is green with it (measured).
- **An r3f game had no WebGL on the Mac.** Headless Chromium there made no WebGL context ("Could not create a WebGL context ... SwiftShader"). The fallback launch now passes `--use-angle=swiftshader --enable-unsafe-swiftshader`; the r3f example then played green with score 7 (measured). The box connects to its own Chromium server and is unchanged.
- **Not changed.** `previewHtml` builds `preview.html` only for a page with `game.js`, so the blind page has no playable copy of a Vite game.

## Verify

- `pnpm check` green. `HOPON_BOX_IMAGE=<image from the head> pnpm -F maker test`: every docker case ran, none skipped, all passed (arm64, local Docker).
- Mutations: the start-tap, frame and throw cases are red on the P4b image (`hopon-box:p5-base`, built from main) and green on the head's. The port cases fail on main's verify.js, which passes a `game.ts`.

### Live lanes

Driver `scratchpad/p5/live/drive.mjs` (the P2 driver, reading `source.tgz` and the page's files as bytes). Head Preview `claude-p5-engines`, deployed from `3816858`, a new Preview whose box app was created with this image (so no box ran an older one; inferred). Trunk Preview `claude-p5-trunk`. Five Drafts in all. Each Revision's `source.tgz` was unpacked and played in the head's image with the random script.

| Lane | Request | Engine (from the built module's imports) | Box replay |
| --- | --- | --- | --- |
| vague | "make me something fun" | Phaser: Star Catcher | green, score 4 |
| 3D | "Make a 3D racing game." | r3f: Sunset Racer | green, score 7 |
| quiz | "Make a quiz about ocean animals." | React only, with a stylesheet | green, ends at over |
| port | trunk: a LittleJS Star Catcher (`game.ts`, `/runtime/v4.js`); head: "fall a bit faster, and add a golden star worth 5 points" | Phaser, Revision 2, `design.md`, `tests.json` and `music.mjs` kept, the same `music.opus` bytes length | green, score 4 |
| Spanish | "Haz un juego donde un perro atrapa huesos..." | Phaser, `Language: Spanish.`, Spanish title and hint, `src/sfx.ts` | green |

Every page loads `/hopon/v1.js` with `data-music="music.opus"` and imports only `/vendor/` files. Seen, not fixed here: the 3D game is the r3f guide's example nearly as written (its name, palette and scoring); the port's reply mentions "rebuilt the game's engine under the hood" though make-game says not to mention the port; two replies exceed the 40-word rule, as the trunk's reply did too. Only one of the four new games used `sound-effects`.

## Cost

The e2e sweeps `p5-head-1` and `p5-head-2` against `p5-trunk-1` and `p5-trunk-2` (operator's sweeps, read from their `result.json` and each build's `box/`). Head's median build cost $0.284 against trunk's $0.137 to $0.150, about 197%, over the plan's 130%. Looks rose from 3.15 to 3.8.

Where it goes, over the green first builds (new games) of both sweeps, 11 a side, medians:

|  | head | trunk |
| --- | --- | --- |
| cost | $0.292 | $0.155 |
| output tokens | 14,863 | 7,191 |
| steps | 9 | 7 |
| game code (`src/`, `index.html`, configs; `game.ts` on trunk) | 17.4 KB | 4.7 KB |
| `src/sfx.ts`, copied from the guide | 2.8 KB | none |
| music | 5.3 KB | 3.6 KB |
| `design.md` | 1.1 KB | 0.9 KB |
| `tests.json` | 0.9 KB | 0.4 KB |
| guides read | 65 KB | 45 KB |

All measured, but the guides read: those are the files' sizes (make-game, the engine's guide, sound effects and music-synth on head; make-game, `littlejs-api`, `zzfx` and music-synth on trunk), and every head run's events show the four reads.

- **Output is 56% of the gap, the game's code most of it.** pi-ai's catalog prices Sonnet 5.5 at $10 a million output tokens, $2 input, $0.20 a cache read and $2.50 a cache write (measured, read from the catalog). Output is $0.149 of head's $0.292 and $0.072 of trunk's $0.155, so $0.077 of the $0.137 gap. The files grow by about 14.5 KB, roughly 4,300 tokens at 3.5 bytes a token (inferred). The other 3,400 or so extra output tokens are reasoning, commands and the reply, which grow with the code they plan (inferred: the record keeps no split).
- **The rest, $0.060, is input:** a guide 20 KB larger than LittleJS's (about 5,500 tokens written to the cache once and read on each later call), the larger code in the context, and two more steps (inferred from the prices and sizes; the record has no input or cache counts).
- **The code is the example's size.** The Phaser guide's example is about 300 lines of `play.ts` and 200 of `art.ts`. Head's vague game wrote 249 and 214, and its `art.ts` is 6 KB of textures drawn with gradients, outlines and highlights, which is what the judge's looks score rewards (measured line counts; the link to looks is inferred).
- **Not the cause.** Design length: `design.md` grew 0.2 KB. Extra builds: one playtest per build at the median on both sides. Rewrites: no run of any sweep, 140 builds, called `edit` (no "Fixing the game" event), so every fix writes a whole file again or edits through bash; a write after a playtest can't be told from a `verify.js` or tests command, which shares its label, so how often a fix rewrites a file is unmeasured.
- **What the fix round changed.** make-game now says to fix and change with `edit`, never by writing a whole file again. With files 2.5 times larger, a rewrite costs 2.5 times more (inferred), so this trims the runs that rewrite, by a guess of a few cents at most. It touches neither the design's length nor what the game draws.
- **What it can't reach.** About $0.10 of a build's cost would have to go to land at 130%, more than the whole input side. That means a smaller game: a shorter example or a size budget, or less reasoning (`MAKER_EFFORT` low). Each trades against the looks gain, which the plan's rule doesn't weigh, so it is the operator's call. The starter below is the one lever with no such trade, and it is small.
- **Head-2 ran short of Allowance.** From its fourth chat on, replies are "You've used this week's hopon tokens", so head-2 has 4 builds against head-1's 11 (measured). The medians above use every green first build.

## Fix round

- **`/hopon/v1.js` redraws its words and wraps them.** `hopon.title`, `hopon.hint` and `hopon.text` are accessors that redraw the overlay when set, and `ready()` redraws it too, so a title set from an effect or after a load shows. The overlay has `overflow-wrap: anywhere`, so a word wider than the screen wraps. Case: "the start screen shows the title and hint a game sets after it first draws, and wraps a long word inside the screen". `HOPON_V1_SHA256` and the Worker test's hash moved with it; nothing loads v1 in production yet.
- **Sound effects unlock on a touch's end.** `src/sfx.ts` made its AudioContext on `pointerdown`, which iOS doesn't count as a gesture for audio. The synth then moved into the scaffold (see "The starter"), which makes the context on `pointerdown`, `pointerup` and `touchend`, each registered on `window` before the overlay's swallowing of the start tap's release, so that release still counts (inferred from listener order; not run on a device).
- **A port has a way out.** make-game publishes an old Draft's port on its own, with `build` kind `"change"`, before the Creator's change, so a limit that stops the change leaves the port published and the next message starts from it. In code, a run that published a Revision and then hits the step, build or time limit is told the Revision stays and to tell the Creator to send the rest again ("kept" in `tool-results.md`); a run that published nothing is told to give up as before. Case: the limits test in `maker.test.js` checks both texts.
- **ADR 0008 no longer says the eval checks a port.** No eval chat starts from an old Draft, and adding one needs the eval to seed a Draft with a LittleJS Revision, which it can't do today. The ADR now says what does check a port: its tests, `check.test.ts`'s two port fixtures, and the live lanes by hand.
- **Stale wording.** The ADR, this trail, the Dockerfile and `maker.ts` called the guides skills. r3f's guide said the start tap's `pointerup` reaches the game, which the scaffold stopped before freezing.
- **The judge's file filter has a test.** `judge.test.ts`: a React game's `.tsx`, `.jsx`, `.ts`, `.css` and `.html` reach the judge; its music, design and tests don't.
- **Replies and the 3D copy.** make-game's Reply step repeats the 40-word limit and says to give the name and how to play, not every rule (the long replies listed rules). r3f's example says to take its patterns, not its game, even for a racer. Neither is measured.
- **The skills' fingerprint is `v12`,** since make-game's text changed.

## The starter

The coordinator's call in the fix round: a new Vite game shouldn't start from zero. Template the skeleton only, and keep each game's design, art and rules free.

- **Before, measured over `p5-head-1`'s first builds.** `vite.config.ts` and `tsconfig.json` were byte-identical in every game, and `index.html` came in a few variants that differ only in `<title>` and the background (the coordinator's count: 7 variants in 10). The three files together were 837 to 901 bytes a game. Every game wrote `src/sfx.ts`, 2,611 to 2,978 bytes, of which the synth, copied from the guide, was all but its `sfx` table of 292 to 746 bytes (the table differs per game; the synth differs only in its comments).
- **The skeleton is seeded, not owned.** `apps/maker/image/starter.js`, at `/opt/hopon/starter.js`, writes `index.html`, `vite.config.ts`, `tsconfig.json` and a `src/main.tsx` stub into a workspace with neither `vite.config.ts` nor `game.ts`, and exits 1 otherwise, writing nothing. make-game's new-game command runs it after emptying the workspace, and its port steps run it after deleting the old game's files. The harness doesn't overwrite the two configs at build: `vite.config.ts` is how `isVite()` and `verify.js` tell a Vite game from an old one, and the check already fails a broken `tsconfig.json` with its reason, so owning them would remove a check for no saving the seed doesn't already give.
- **One `index.html` for every engine.** The title and hint are `hopon.title` and `hopon.hint` in `main.tsx`, which the scaffold now redraws when set, so the page needs no per-game edit. Its background is on `html` only, so a React game's stylesheet on `body` or `#root` still shows.
- **The synth is the scaffold's.** `hopon.play(sound)` in `/hopon/v1.js` plays through the music's AudioContext, which the scaffold now makes at the first touch for every game, so sounds follow the mute and pause with the music. A game's `src/sfx.ts` is its own table of sounds. v1 isn't in production yet, so this is its last change before it freezes.
- **The guides say so.** make-game names the skeleton and says to keep it and write `src/main.tsx` over the stub. The three engine guides lost their copies of the three files, and each example's `main.tsx` sets `hopon.title`. `sound-effects.md` is the table and `hopon.play`'s parameters, 2.7 KB from 4.9 KB.
- **Checked in the box** (image from this head, arm64): the Start over case now expects the skeleton; "the starter seeds only a workspace with no game, and never writes over one"; each guide's example, extracted from the guide and written over the skeleton by make-game's own command, builds, passes its tests and plays green (Phaser, r3f and React); "a game's sound effects play through the scaffold" plays two sounds on a tap with no console error. The sound case and the guide-example cases are red on the image from before this change, and the refusal case passes there only because it has no starter to run (measured).
- **After, estimated.** A new game no longer writes about 0.9 KB of skeleton and 2.3 KB of synth, about 900 output tokens or $0.009 a build at 3.5 bytes a token (inferred). Its reads shrink by about 2 KB: sound effects by 2.2 KB and the Phaser guide by 1 KB, against make-game's 1.2 KB more. Together about $0.01 of the $0.284 median, so around 4% (inferred). The sweep measures it.

## Fix round 2

Live review on iOS found three defects in what Creators see. Evidence is the lane logs, reply texts and Revision sources of the coordinator's `p5v` sweep, and the screenshots `media/p5-edit-chat.png` and `media/p5-port-dom.png`.

### The Creator saw process talk

Penguin Slide's first reply ended "I didn't ask the advisor for a final check before publishing. The tests passed, but I didn't play a run that jumped any rocks, so the jump-and-score loop is untested." (`p5-edit-chat.png`; its lane logged `ask_advisor: 0`). A prompt rule alone isn't reliable here, so the fix is a rule, a reminder at the moment of writing, and an eval check:

- **Rule.** `prompts/maker.md` says to talk about the game, never how it was made, and never what wasn't checked; a shortfall is said as what the game does now ("the slope is flat for now"). make-game's Reply step says the same.
- **Reminder where the reply is written.** The `published` tool result, the last thing the agent reads before its reply, now ends "If you're done, reply to the Creator with what the game is and how to play it. Say nothing about how you made it: not the advisor, tests, playtests or checks, and nothing you skipped." A server-side rewrite of the reply was rejected: any heuristic that strips sentences can mangle a normal one.
- **Eval check.** `processTalk(reply)` in `eval/talker.ts` lists a reply's process words; a turn with any fails the chat (`processOk`, part of `pass`). Plain "test", "build", "check" and "tool" are game words ("test your reflexes", "build a tower", "collect tools"), so they match only in a phrase about the work ("the tests", "tests passed", "final check", "tool call"). `advisor`, `playtest*`, `untested`, `verif*`, `typecheck*`, `screenshot`, `harness`, `workspace`, `tests.json` and `design.md` match alone. The unit test fails the Penguin Slide reply on `advisor`, `final check`, `the tests` and `untested`, and passes five game replies that use the game words.

### Lily Hop's taps: not reproduced

The suspected cause, screen against world coordinates under `setZoom(ZOOM)`, is ruled out. The game reads `pointer.worldX` and `pointer.worldY`, as phaser.md already teaches. Its source, built in the box image, gives the same `index-C8A3E6Hw.js` as the Revision. A tap on the pad above the frog hopped (`hops` 0 to 1) in every case run:

- the game's own tests at DPR 1, 2 and 3 (the box's context patched to take a `deviceScaleFactor`; ZOOM is 2 at DPR 3);
- Chromium with mouse and with touch (`hasTouch`, `isMobile`), at DPR 1 and 3, at 360×640 and 390×844;
- Playwright's WebKit, the same eight cases;
- WebKit with touch at DPR 3, the viewport cut from 390×844 to 390×664 after load, tapping the pad where the screenshot drew it.

So no guide change or box test for it; a guess at a cause would teach a trap that isn't one. What's left is the device: a real touch in the app's WKWebView, the pond scrolling under the finger (the pad moves 24 to 60 px a second, and a tap must land within 60 px of its centre), or something in how the app embeds the page. Reproducing it needs the app on the Simulator or a phone.

The box plays every test at DPR 1, where ZOOM is 1 and `pointer.x` equals `pointer.worldX`, so a game that read the wrong one would pass. Playing tests at DPR 2 would catch it, but the pause test's wall time went from 7 s to 24 s there (measured), so it isn't done here.

### The quiz's fourth answer was cut off

The cause is the frame, not the CSS alone. The app shows a game at the feed's measured height (`feedGameHeight`), about 570 px tall on the 844 px iPhone in `p5-port-dom.png` (the card runs from y 408 to 1755 of 2000 at 1.27 px a point over 3×). The box plays at 360×640. The ported quiz's answers end at y 591 (measured in the box from Revision r2's source): inside 640, outside 570. Its column can't shrink: a 76 px emoji, a question with `min-height: 84px`, and four 60 px buttons under `overflow: hidden`.

- **Guide.** react.md's layout section says the frame can be much shorter than the screen, and that controls must stay on screen from 360×540 up. The middle of the column shrinks (`flex: 1 1 0; min-height: 0`), the controls keep their size (`flex: none`), decorations size by height (`clamp(32px, 11dvh, 76px)`), buttons at `min(60px, 9dvh)`, and a list of controls that can't fit scrolls in its own box.
- **Playtest.** After the play, `playtest()` loads the game again at 360×540, taps start, and fails on any shown `button`, `[role=button]`, link or input outside the screen with no scrolling box or scrolling page to reach it, naming each by its label. The quiz's Revision fails it on its fourth answer; with the guide's rules added to its stylesheet it passes and fits at 640, 570 and 560 (measured in the box).
- **Box test.** "a playtest fails a game whose last answer is below a short screen, and passes it once the picture shrinks." The guide examples and the three engine fixtures play through the same check.
