# Which CC0 music loops ship as the curated set?

Research for [#114](https://github.com/chengchao/hopon/issues/114), part of map [#111](https://github.com/chengchao/hopon/issues/111). Researched 2026-10-16.

**Question:** Launch music is a curated set picked by mood, not generated. Which 8–12 short (15–40 s), seamlessly looping, instrumental tracks can we redistribute inside the app with no attribution requirement, covering calm, upbeat, tense, retro, spooky and silly? How does the Maker pick one?

**Short answer:** 14 candidates below, all **CC0 1.0** ([deed](https://creativecommons.org/publicdomain/zero/1.0/)), 13 of them inside 15–40 s. Every mood has at least two picks except **silly**, which has no track an author labelled that way; the closest are a swing loop, a bossa-nova elevator loop and a bouncy marimba loop. Every source file is OGG Vorbis, MP3 or WAV at 0.1–6.8 MB; we re-encode each to Opus at 64 kbps (≈ 8 KB/s, so 40 s ≈ 320 KB, 25 s ≈ 200 KB) to meet the 300 KB cap. The Maker picks by writing one `mood` value into `audio.json`; the API maps mood → track list and serves one.

Durations were measured with `ffprobe` on the downloaded source files (not stored in the repo); sizes are as OpenGameArt or freesound report them. Nothing has been listened to for loop seams yet; that is the one check the build ticket must do (see "Caveats").

## Licence rule applied

Only **CC0 1.0** qualifies. OpenGameArt's licence field and freesound's licence field name it explicitly on each page below. Excluded on licence: incompetech (CC-BY), OGA-BY (attribution), everything multi-licensed without CC0. Kenney's [Music Jingles](https://kenney.nl/assets/music-jingles) are CC0 but are 85 one-shot jingles, not loops, so they are excluded on content. Where an author says "credit appreciated", that is a request, not a condition; CC0 waives it.

## Candidates

Mood tags are ours, from the author's description and tags. ★ = inside the 15–40 s window as shipped.

| # | Title | Author | Source | Licence | Dur. | Format, size | Mood |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 ★ | Heavenly Loop | isaiah658 | [OGA](https://opengameart.org/content/heavenly-loop) | CC0 | 33.7 s | OGG 1.2 MB (291 kbps; also FLAC) | calm |
| 2 ★ | Sadness | Kistol | [OGA](https://opengameart.org/content/sadness) | CC0 | 25.0 s | OGG 441 KB | calm |
| 3 ★ | Winter Dust (Short Loops pack) | hernandack | [OGA](https://opengameart.org/content/short-loops-background-music-pack) | CC0 | 23.0 s | OGG 469 KB | calm |
| 4 ★ | quiz game music loop BPM 90 | portwain | [freesound 220060](https://freesound.org/people/portwain/sounds/220060/) | CC0 | 16.0 s | WAV 2.7 MB | calm |
| 5 ★ | Just Saying Tho (Short Loops pack) | hernandack | [OGA](https://opengameart.org/content/short-loops-background-music-pack) | CC0 | 24.1 s | OGG 398 KB | upbeat |
| 6 ★ | Wah Wah Wah Wah | percypersimmon | [freesound 156592](https://freesound.org/people/percypersimmon/sounds/156592/) | CC0 | 32.0 s | MP3 502 KB | upbeat |
| 7 ★ | BirdFish Happy Loop | pinkinblue | [freesound 425971](https://freesound.org/people/pinkinblue/sounds/425971/) | CC0 | 18.1 s | MP3 286 KB | upbeat, silly |
| 8 ★ | Head in the Sand (seamless loop) | congusbongus | [OGA](https://opengameart.org/content/head-in-the-sand-seamless-loop) | CC0 | 38.4 s | OGG 108 KB (Famitracker source included) | retro, upbeat |
| 9 ★ | 8-Bit Bossfight | Volvion | [freesound 265308](https://freesound.org/people/Volvion/sounds/265308/) | CC0 | 20.8 s | MP3 326 KB | retro, tense |
| 10 | Enemy Ship Approaching | yd | [OGA](https://opengameart.org/content/enemy-ship-approaching) | CC0 | 41.7 s | OGG 275 KB (LMMS source included) | tense |
| 11 ★ | Spooky Loop | wipics | [OGA](https://opengameart.org/content/spooky-loop) | CC0 | 32.8 s | MP3 790 KB | spooky |
| 12 ★ | Project Utopia (seamless loop) | congusbongus | [OGA](https://opengameart.org/content/project-utopia-seamless-loop) | CC0 | 18.3 s | OGG 236 KB | spooky, calm |
| 13 ★ | Swinging Sweet (Short Loops pack) | hernandack | [OGA](https://opengameart.org/content/short-loops-background-music-pack) | CC0 | 24.9 s | OGG 405 KB | silly, upbeat |
| 14 ★ | Short Elevator Music Loop | BlondPanda | [freesound 659889](https://freesound.org/people/BlondPanda/sounds/659889/) | CC0 | 27.0 s | WAV 6.8 MB (24-bit) | silly, calm |

Per mood: calm 5 (1, 2, 3, 4, 12), upbeat 5 (5, 6, 7, 8, 13), tense 2 (9, 10), retro 2 (8, 9), spooky 2 (11, 12), silly 3 (7, 13, 14).

Author notes worth keeping: hernandack says the pack was loop-tested in GameMaker, PyGame and HTML5; congusbongus and Kistol label theirs seamless; Volvion tags "seamless"; a commenter on Spooky Loop reports the seamless region is **3.962–19.700 s**, so we ship that 15.7 s cut rather than the full 32.8 s file.

## Considered and dropped

- [Cunning plan](https://opengameart.org/content/cunning-plan-short-seamless-loop) (congusbongus, CC0): 11.1 s, under the window. Good retro fallback if a shorter loop is acceptable.
- [Mysterious Ambience (song21)](https://opengameart.org/content/mysterious-ambience-song21) (cynicmusic): 42.9 s, CC0 among four licences, but the author asks for a pixelsphere.org credit; legally fine, socially awkward. Dropped.
- [Bossa Nova](https://opengameart.org/content/bossa-nova) (Joth, CC0, 59.6 s), [Happy Adventure](https://opengameart.org/content/happy-adventure-loop) (TinyWorlds, CC0, 46.8 s, MP3 with a lead-in gap per comments), [Tense Future Loop](https://opengameart.org/content/tense-future-loop) (gmason, CC0, 59.1 s), [Creepy Ambient Loop](https://opengameart.org/content/creepy-ambient-loop) (epb9000, CC0, 58.9 s), [Void Estate](https://opengameart.org/content/haunting-chiptune-loop-void-estate) (Zane Little, CC0, 86.5 s), [Insistent](https://opengameart.org/content/insistent-background-loop) (yd, CC0, 128.7 s), [Parasite](https://opengameart.org/content/parasite) (Kistol, CC0, 144 s), [Creepy](https://opengameart.org/content/creepy) (TokyoGeisha, CC0, 89.4 s): all over 40 s. Any could be cut to a bar-aligned 16–32 s loop if a mood runs thin; CC0 permits the edit.
- [4 Chiptunes (Adventure)](https://opengameart.org/content/4-chiptunes-adventure) (Juhani Junkala, CC0): full-length tracks in an 8 MB zip; same remark.
- [A Brand New Wisdom](https://opengameart.org/content/short-loops-background-music-pack) (hernandack, CC0, 16.6 s): in range but no clear mood from the tags; keep as a spare.

## How the Maker picks one

`audio.json` in a Draft gets one new field:

```json
{ "mood": "upbeat" }
```

`mood` is one of `calm | upbeat | tense | retro | spooky | silly`; anything else, or absent, means `calm`. The Maker's system prompt lists the six words and tells it to pick the one that fits the game; it never names a track. The API owns the mapping:

```ts
const tracks = {
  calm: [
    "heavenly-loop",
    "sadness",
    "winter-dust",
    "quiz-loop",
    "project-utopia",
  ],
  upbeat: [
    "just-saying-tho",
    "wah-wah",
    "birdfish",
    "head-in-the-sand",
    "swinging-sweet",
  ],
  tense: ["8bit-bossfight", "enemy-ship"],
  retro: ["head-in-the-sand", "8bit-bossfight"],
  spooky: ["spooky-loop", "project-utopia"],
  silly: ["birdfish", "swinging-sweet", "elevator"],
} as const;
```

The API picks `tracks[mood][hash(gameId) % n]` so a game always gets the same track, and serves `/music/<id>.opus` from R2 with a long cache. The track id, not the mood, is frozen into the published Game so later edits to the mapping never change a live game's music. The feed loops it with `<audio loop>`; no gapless trickery is needed if the files are cut on the bar.

## Caveats

1. **Seams are unverified.** Loop quality is claimed by authors, not checked here. The build ticket should play each candidate on repeat once and drop any that click; the "dropped" list has spares.
2. **Silly is thin.** No track is authored as comedic; 7, 13 and 14 are the closest. Worth one more search pass (freesound tags `cartoon`, `comedy`, `kazoo`) or trimming Joth's 8-bit Bossa Nova.
3. **Tense has two, one slightly long.** Enemy Ship Approaching is 1.7 s over the window; ship as is or trim.
4. **Re-encoding is required.** Sources are Vorbis/MP3/WAV; `ffmpeg -c:a libopus -b:a 64k` on each, and trim Spooky Loop to 3.962–19.700 s. Keep the author, source URL and licence next to each file in a `CREDITS` manifest even though CC0 does not require it; it is the audit trail if a licence is later disputed.
5. **freesound downloads need a free account**; OpenGameArt files are direct links.
