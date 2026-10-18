# Where a game's music comes from: music-source prototype

Prototype for [#129](https://github.com/chengchao/hopon/issues/129) (map [#111](https://github.com/chengchao/hopon/issues/111)), run 2026-10-18. The code is on the throwaway branch `prototype/music-source`, in `apps/maker/music/` (harness, page, seam check), `apps/maker/skills/zzfxm-music.md` and the ZzFXM hook in `apps/maker/image/scaffold.js`. Every model-written song and synth script, with its numbers and the owner's scores, is in `apps/maker/music/runs/`.

**Question:** Each game gets one optional music loop, and only one source ships. The candidates were (A) a ZzFXM song the model writes and the runtime plays, (B) a dependency-free synthesizer the model writes in Node that renders a WAV, in the [Claude Composer](https://www.josh.ing/blog/claude-composer) style, and (C) a Google Lyria 3 Clip generated from a prompt the model writes.

**Decision (owner):** **B, raw synthesis in Node.** The model writes `music.mjs` (oscillators, envelopes, drums, mix, sections, no packages), runs it in the box to render `music.wav`, and the harness re-encodes it to Opus 64 kbps. The owner scored B highest: 3.9 on first listen and 4.1 after the follow-up edit, against 3.5 and 3.6 for A. Lyria (C) was not heard. The Gemini key on hand is free tier, which allows 0 Lyria requests a day, and the owner chose without it. So nothing in the box calls out yet, and the tool-server fog item stays unneeded.

## Setup

- **Games:** five from spike A's eval (Sonnet 5.5's versions): moon-cat, fruit-catcher, ocean-memory, neon-snake and gnome-whack. Each got a genre and mood brief, the kind the Talker would pass, plus one follow-up ("Make the music faster." or "Make the music spookier.").
- **How it ran:** each arm ran as a real Maker turn. It used pi-coding-agent, the spike's system prompt and tools (`run_node`, `load_skill`) and a local box, with the game already in `game.ts`. The follow-up ran as the next turn in the same session. Models were Claude Haiku 5.5 and Sonnet 5.5 through the spike's Cloudflare AI Gateway setup.
- **A:** a 1-page skill (`zzfxm-music`) teaching the song format, with a note table, mood guidance and 2 example songs. The game sets `hopon.music = [instruments, patterns, sequence, bpm]`. The scaffold renders it with the vendored ZzFXM 2.0.3 player (MIT) on the first tap and loops the buffer.
- **B:** a one-shot prompt in the Claude Composer style. It gives the genre and mood, asks for sections, says the loop must be seamless with tails wrapping onto the start, makes `music.wav` the only acceptable output, forbids third-party packages and says not to ask questions. The model writes and runs the script in one `run_node` call. Render time was measured by re-running the script alone, with no env, on this Mac (not E2B).
- **Listening:** a blind page (shuffled letters) that loops each track gaplessly with Web Audio. A "Seam" button starts 4 s before the end. A is the exact sample buffer the runtime renders; B is the Opus file that would ship.
- **Seam check** (`music/seam.ts`): the sample jump across the wrap, the level of the last 100 ms against the first 100 ms, and digital silence at either end. Every track had a jump of 1.4 or less (no clicks), so the table shows the level step and any silence.

## Results

Scores are the owner's, 1–5, first listen / after the follow-up. Cost and turn time are for the turn that adds the music. Render is in the browser at the first tap for A, and in the box for B.

| game | arm | model | score | cost | turn | size | render | length | seam (end vs start) | follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fruit-catcher | A ZzFXM | haiku-5-5 | 3 / 3 | $0.0037 | 30.9 s | 1.3 KB song | 325 ms | 28.7 s | clean (9.5 dB) | rewrote, $0.0004, 8.8 s |
| fruit-catcher | A ZzFXM | sonnet-5-5 | 3 / 3 | $0.0375 | 22.4 s | 1.5 KB song | 382 ms | 30 s | dip 15.3 dB | patched, $0.0061, 9.1 s |
| fruit-catcher | B synth | haiku-5-5 | 4 / 4 | $0.0072 | 55.5 s | 5.2 KB script, 338 KB Opus | 904 ms | 32 s | clean (2.5 dB) | rewrote, $0.0009, 6.4 s |
| fruit-catcher | B synth | sonnet-5-5 | 4 / 4 | $0.0327 | 18.6 s | 2.9 KB script, 293 KB Opus | 1014 ms | 27.4 s | clean (7.3 dB) | patched, $0.0044, 4.2 s |
| gnome-whack | A ZzFXM | haiku-5-5 | 3 / 4 | $0.0039 | 29.6 s | 1.7 KB song | 314 ms | 25.6 s | dip 16.6 dB | patched, $0.0010, 14.3 s |
| gnome-whack | A ZzFXM | sonnet-5-5 | 3 / 4 | $0.0362 | 22.1 s | 1.0 KB song | 475 ms | 45.7 s | 0.086 s silent | rewrote, $0.0177, 15.4 s |
| gnome-whack | B synth | haiku-5-5 | 4 / 5 | $0.0055 | 42.1 s | 5.1 KB script, 328 KB Opus | 1154 ms | 30 s | dip 19.5 dB | patched, $0.0018, 16.7 s |
| gnome-whack | B synth | sonnet-5-5 | 4 / 3 | $0.0348 | 19.3 s | 3.3 KB script, 287 KB Opus | 469 ms | 25.3 s | dip 14.5 dB | rewrote, $0.0196, 13.2 s |
| moon-cat | A ZzFXM | haiku-5-5 | 4 / 4 | $0.0063 | 49.1 s | 2.3 KB song | 517 ms | 38.4 s | clean (11.3 dB) | patched, $0.0008, 11.9 s |
| moon-cat | A ZzFXM | sonnet-5-5 | 4 / 4 | $0.0368 | 19.1 s | 1.5 KB song | 418 ms | 30 s | clean (3.6 dB) | patched, $0.0151, 13.3 s |
| moon-cat | B synth | haiku-5-5 | 4 / 5 | $0.0070 | 63.1 s | 4.4 KB script, 429 KB Opus | 3384 ms | 34.3 s | clean (7 dB) | edited in run_node, $0.0029, 20.4 s |
| moon-cat | B synth | sonnet-5-5 | 4 / 4 | $0.0288 | 18.5 s | 2.7 KB script, 352 KB Opus | 1009 ms | 38.4 s | clean (-2.8 dB) | rewrote, $0.0127, 9.5 s |
| neon-snake | A ZzFXM | haiku-5-5 | 3 / 3 | $0.0048 | 39.8 s | 1.1 KB song | 377 ms | 31 s | dip 13.3 dB | patched, $0.0005, 9.3 s |
| neon-snake | A ZzFXM | sonnet-5-5 | 4 / 3 | $0.0315 | 16.4 s | 1.1 KB song | 474 ms | 45.1 s | 0.078 s silent | patched, $0.0108, 14.4 s |
| neon-snake | B synth | haiku-5-5 | 4 / 4 | $0.0042 | 34.3 s | 3.7 KB script, 279 KB Opus | 916 ms | 32 s | clean (0.2 dB) | patched, $0.0004, 4.6 s |
| neon-snake | B synth | sonnet-5-5 | 4 / 4 | $0.0319 | 20.1 s | 2.8 KB script, 281 KB Opus | 1356 ms | 32 s | clean (-8.6 dB) | patched, $0.0045, 4.2 s |
| ocean-memory | A ZzFXM | haiku-5-5 | 5 / 4 | $0.0033 | 27.8 s | 0.4 KB song | 348 ms | 30.6 s | 0.224 s silent | rewrote, $0.0020, 17.9 s |
| ocean-memory | A ZzFXM | sonnet-5-5 | 3 / 4 | $0.0324 | 18.5 s | 0.8 KB song | 482 ms | 53.3 s | 0.168 s silent | rewrote, $0.0153, 17.3 s |
| ocean-memory | B synth | haiku-5-5 | 4 / 4 | $0.0038 | 31.4 s | 3.5 KB script, 312 KB Opus | 1653 ms | 30 s | clean (0.2 dB) | rewrote, $0.0021, 15.1 s |
| ocean-memory | B synth | sonnet-5-5 | 3 / 4 | $0.0274 | 19.9 s | 2.0 KB script, 433 KB Opus | 1132 ms | 36 s | clean (-2 dB) | patched, $0.0101, 9.1 s |

| average score        | first   | after edit |
| -------------------- | ------- | ---------- |
| A · ZzFXM, Haiku     | 3.6     | 3.6        |
| A · ZzFXM, Sonnet    | 3.4     | 3.6        |
| **B · synth, Haiku** | **4.0** | **4.4**    |
| B · synth, Sonnet    | 3.8     | 3.8        |
| C · Lyria 3 Clip     | not run | not run    |

## What we learned

- **B sounds best, and the cheap model did it best.** Haiku 5.5 wrote 3.5–5.6 KB synthesizers with detuned pads, circular reverb and voices that wrap around the loop end. It cost about $0.005 a game, against about $0.03 on Sonnet, and its follow-ups scored 4.4. Haiku's turns were slower (31–63 s against about 19 s for Sonnet).
- **B loops have no gaps.** Nine of the ten scripts write voices modulo the loop length, so tails wrap onto the start; gnome-whack on Haiku doesn't. No B track has silence at either end. The large level steps (gnome-whack, 14–20 dB) are the arrangement getting quieter in its last bar, not a gap.
- **ZzFXM can't wrap a loop.** Its player cuts every ringing note at the end of the sequence, and nothing carries onto the start. When the last rows are rests, the loop ends in silence: 0.08–0.22 s, and 0.65 s on one edit. The song also renders on the main thread at the first tap, a 300–780 ms hitch on this Mac and more on a phone.
- **Follow-ups edit rather than regenerate in both arms.** A patched 6 of 10 and rewrote 4 (rewriting a 1 KB song is cheap). B patched 5, rewrote 4 and edited one in place. The scripts are parameterized (BPM, scale, voices), so "faster" is often a one-line patch: $0.0004–0.02 and 4–20 s per follow-up, re-render included. Lyria could only regenerate: a new prompt and another $0.04.
- **Cost of B in the turn:** the model's tokens plus a render of 0.5–3.4 s (on this Mac; E2B's vCPUs may be slower), then an ffmpeg re-encode of under 1 s. The Opus file is 280–460 KB for 25–38 s.

## Caveats

- **Lyria was not tested.** The comparison is A against B only; the C code path (prompt, `interactions` call, 2 s equal-power cross-fade loop) is in `music/run.ts` but never ran. Choosing B makes it moot.
- **Small sample:** one owner, five games and one run per cell. The ZzFXM skill's example songs were checked for levels and pattern lengths, not tuned by ear, so A might do better with better examples. Its seam limit is structural, though.
- **The optional Python-stdlib comparison was skipped.** Python in the box is out of scope, and Node did the job.
- **Playback seam on the phone is unverified.** The page loops with Web Audio, which is gapless. If the feed plays the file with `<audio loop>`, check on iOS that Opus loops without a gap, or loop it with Web Audio in the scaffold.

## For the build

- The Coder gets the genre and mood in its build spec, writes `music.mjs` in the box and runs it. The harness re-encodes `music.wav` to Opus 64 kbps (ffmpeg is in the E2B image) and stores the Opus with the Revision. The script stays in the workspace, so follow-ups patch it and re-render.
- The B prompt that worked is `PROMPTS.b` in `apps/maker/music/run.ts`: genre and mood, sections, a 20–40 s whole number of bars, no fades or silence at the ends, tails that wrap, only node: built-ins, `music.wav` as the only output, no questions.
- The ZzFXM hook and skill stay on the prototype branch. ZzFX sound effects and stingers are unchanged.

## Reproduce

```bash
pnpm -F maker music --arms a,b
pnpm -F maker exec node music/seam.ts
pnpm -F maker music:listen
```

Run them in `apps/maker` with the gateway keys in `.env`. The last command serves the listening page at http://localhost:8129.
