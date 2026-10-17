# ElevenLabs Music for game loops: terms, looping, pricing, latency

Research for [#124](https://github.com/chengchao/hopon/issues/124), part of map [#111](https://github.com/chengchao/hopon/issues/111). Researched 2026-10-16. Primary sources only (ElevenLabs docs, pricing, terms); no API calls were made.

**Question:** Each game gets one ~30 s looping instrumental track generated from a mood prompt by a Cloudflare Worker, stored in R2 and served same-origin. What does it cost, which plan lets us ship it commercially, can we redistribute the audio, does the API give us a loop, how long does it take, is the sound-effects endpoint useful for ambience, and what must #52's AI disclosure say?

**Short answer:**

| Question | Answer |
| --- | --- |
| Cost per 30 s track | **$0.075** at the API rate of $0.15/min ([API pricing](https://elevenlabs.io/pricing/api)); 450 credits at 900 credits/min if drawn from a subscription's credit pool ([pricing FAQ](https://elevenlabs.io/pricing)). |
| Plan for commercial use | Any paid plan grants commercial use, but Starter, Creator and Pro are "For Individual Use Only"; an entity with fewer than 10 employees needs **Scale ($299/mo)** ([Music Terms, Exhibit A](https://elevenlabs.io/music-terms)). Games are covered as "Indie Games" while the game is under $500k lifetime revenue and the developer under $1M/yr; above that, "Studio Game" rights need Enterprise Music. |
| Redistribution in the app | Yes. We retain all rights in Output (Music Terms §2.2; [Terms of Use](https://elevenlabs.io/terms-of-use) §4(c)(ii)) and may use it outside the Services (ToU §4(a)). Media rights cover "any digital or non-digital media" except film, TV, radio and Studio Games. We may not compile a library of Output for third parties (§4.2). |
| Attribution / C2PA | No attribution on paid plans (Free requires "Created in collaboration with ElevenLabs"). `sign_with_c2pa` is optional, default false, MP3-only ([compose](https://elevenlabs.io/docs/api-reference/music/compose)). §3.4: ElevenLabs' marking does not satisfy our own disclosure duties. |
| Loopable output | **Not documented** for `POST /v1/music`. There is no loop flag; `force_instrumental` only guarantees no vocals. The inpainting guide shows a two-call "glue chunk" plan on `music_v2_5` that it calls a smooth transition, not a guaranteed seamless loop. Plan on an ffmpeg cross-fade (§4). |
| Latency | **Not documented** anywhere on elevenlabs.io for music. Must be measured. Treat generation as asynchronous in the Worker (background job, not a request-response path). |
| Sound-effects `loop` | Yes for ambience beds: `loop: true` on `eleven_text_to_sound_v2`, 0.5–30 s, "can be played on repeat without perceptible start/end points" ([sound effects](https://elevenlabs.io/docs/overview/capabilities/sound-effects)). $0.12/min at the API rate, so a 30 s bed is $0.06. |
| #52 disclosure | See §7: name ElevenLabs as the processor of the mood prompt and generated audio; data is stored in the US; ElevenLabs may use inputs and outputs to train models unless we opt out. |

## 1. The compose endpoint

`POST /v1/music` ([API reference](https://elevenlabs.io/docs/api-reference/music/compose)):

- `prompt` (string) **or** `composition_plan`, not both.
- `music_length_ms`: 3,000–600,000 ms, only with `prompt`; omitted, the model picks a length. We send `30000` (or `34000`, see §4).
- `model_id`: `music_v1` (default during the transition), `music_v2`, `music_v2_5`. The models page calls v2.5 "our most advanced music model" and v1 "outclassed" ([models](https://elevenlabs.io/docs/overview/models)). Use `music_v2_5`.
- `force_instrumental` (default false): true "guarantees that the generated song will be instrumental." Only with `prompt`. The prompting guide also says to add "instrumental only" to the prompt ([best practices](https://elevenlabs.io/docs/overview/capabilities/music/best-practices)).
- `output_format` query param: default `auto` (= `mp3_48000_192` for v2 models). Opus is offered directly: `opus_48000_32`, `_64`, `_96`, `_128`, `_192`. The capabilities page still says "MP3 ... and WAV formats"; the API reference is the more specific source. The curated set (#114) is Opus 64 kbps, so `opus_48000_64` matches, but see §4 on why we may transcode anyway.
- `sign_with_c2pa` (default false): "Applies only to MP3 output." Added in the [2025-12-08 changelog](https://elevenlabs.io/docs/changelog/2025/12/8).
- `store_for_inpainting` (default false): needed only to reference the song in a later composition plan.
- `enable_logging=false` (zero retention) is enterprise-only.
- Response: the audio file; the song id is in the response headers.

Prompt restrictions (Music Terms §2.1): no artist, songwriter, song, album, publisher or label names, and no substantial lyrics. Mood prompts like "calm lo-fi, 80 BPM, instrumental only, no vocals" are fine.

## 2. Cost

Two price lists exist and they do not match exactly:

- **API pricing page** ([/pricing/api](https://elevenlabs.io/pricing/api)): API usage "is billed in US dollars." Music: **$0.15 per minute**, 5-minute limit. Included music minutes per plan: Starter 40, Creator 147, Pro 660, Scale 1,993, Business 6,600. Sound effects: $0.12 per minute. One 30 s track = **$0.075**.
- **Subscription pricing page** ([/pricing](https://elevenlabs.io/pricing)) FAQ: "Eleven Music 900 credits per minute" from the shared credit pool. 30 s = 450 credits. Starter $6/30k credits ≈ 66 tracks ($0.09 each); Creator $22/121k ≈ 269 tracks ($0.082); Pro $99/600k ≈ 1,333 tracks ($0.074); Scale $299/1.8M = 4,000 tracks ($0.075).

Either way a track is about 7–9 cents. At 10 games/day/account the music line is small next to the Maker's model and sandbox spend.

**Download caps bind before credits do** on small plans. The Music Commercial Rights table caps monthly downloads: Starter 30 min (60 tracks), Creator 250 min (500), Pro 500 min (1,000), Scale 1,500 min (3,000), Business 4,000 min (8,000). The terms do not say whether API output counts as a "download"; assume it does, since the API returns a file.

Sound-effects pricing is inconsistent across pages (11, 20 or 40 credits/s with a set duration; 100 credits flat when the duration is left to the model; the help page says cost "is not influenced by the text input"). Budget from the $0.12/min API figure.

## 3. Commercial use and redistribution

[Eleven Music Terms](https://elevenlabs.io/music-terms), last updated 09 October 2026, Exhibit A "Music Commercial Rights table":

|  | Free | Starter | Creator | Pro | Scale | Business | Enterprise Music |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Eligibility | Individual | Individual | Individual | Individual | Individuals or entities < 10 employees | < 50 employees | None |
| Media rights | All online/offline commercial use except film, TV, radio, Studio Games | same | same | same | same | same | All |
| Monthly download | Not permitted | 30 min | 250 min | 500 min | 1,500 min | 4,000 min | Custom |
| Attribution | Required | No | No | No | No | No | No |
| API access | No | Yes | Yes | Yes | Yes | Yes | Yes |
| Music concurrency | 0 | 2 | 2 | 2 | 5 | 5 | 10+ |

- **Ownership:** "as between you and ElevenLabs, you retain any and all rights in and to your Input and Output" (§2.2; ToU §4(c)(ii)). ToU §4(d) grants ElevenLabs a perpetual licence to use our Content to provide and improve the Services, with a training opt-out in the account's "Data use" menu (§4(i)).
- **Free tier is non-commercial** (ToU §1(c)(i)) and has 0 music concurrency, so it is unusable even for development.
- **Entity vs individual:** §1.4 "Plan enrollment is restricted to eligible users as set out in the Music Commercial Rights Table." Starter–Pro are "For Individual Use Only"; the terms do not define "individual" or address sole proprietors. If hopon ships as a company, Scale is the first eligible plan. Owner's call; flagged in the resolution.
- **Games:** a "Studio Game" is "a video game or other interactive or playable experience made available to the public," excluding Indie Games (§4.8(j)). An Indie Game has under $500k revenue since first release and a developer with under $1M game revenue in the last financial year (§4.8(c)). Lose that status and there are 60 days to move to a plan permitting Studio Game use (§4.7), which is Enterprise Music only.
- **Not a library:** §4.2 prohibits compiling Output into a library made available to third parties. Generating one track per game, frozen into that game, is use in media, not a library. Letting Creators browse and reuse previously generated tracks across games would edge toward one; keep the mood → generate → freeze flow.
- **Reseller / pure-play:** §4.6 co-branding applies to Authorized Resellers and "Pure-play Music AI Creation Companies" whose primary product is generating recordings. hopon is a game maker, not that.
- **Marking:** §3.4 "ElevenLabs may mark Output as AI-generated but does not warrant that any Output carries a watermark or provenance signal, and no marking ElevenLabs applies satisfies your disclosure obligations." C2PA signing is therefore optional for us and irrelevant to Opus output.

## 4. Looping

Nothing on elevenlabs.io promises a seamless loop from `POST /v1/music`:

- The compose reference has no loop parameter. The capabilities and best-practices pages do not mention seamless loops; the only loop advice is prompt-shaped ("four bars, no melody — just drums"; "For loops, the negative space is the prompt").
- The [inpainting guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/inpainting) has "Create a loop with a glue chunk": store the song (`store_for_inpainting`), then compose a plan of [reference slice, 3 s generated glue, same reference slice] on `music_v2_5`. It describes "a smooth transition", not a guaranteed seam, costs a second generation, and needs the stored song id. Not worth it at launch.
- Conclusion: **post-process with ffmpeg**. workerd has no ffmpeg, so this runs where the audio is already re-encoded (the Coder container or a build step), not in the Worker. Ask for 34 s, cross-fade the last 4 s into the first 4 s, keep 30 s:

```sh
ffmpeg -i in.mp3 -filter_complex \
  "[0:a]asplit[a][b];
   [a]atrim=0:4,asetpts=PTS-STARTPTS[head];
   [b]atrim=4:34,asetpts=PTS-STARTPTS[body];
   [body][head]acrossfade=d=4:c1=tri:c2=tri" \
  -c:a libopus -b:a 64k loop.opus
```

The output starts at original t=4 and ends on the original t=0–4 blended under the tail, so wrapping to the start is continuous. Untested on ElevenLabs output; a track with a hard intro or long reverb tail will still be audible at the seam, so the eval should listen to a few per mood. Play it with Web Audio `AudioBufferSourceNode.loop = true` (sample-accurate; `decodeAudioData` also strips Opus pre-skip correctly) rather than `<audio loop>`.

Because of the transcode step, requesting `mp3_48000_192` or `pcm_48000` and encoding Opus ourselves is as cheap as requesting Opus; pick whichever keeps the pipeline simplest.

## 5. Latency and rate limits

- **Latency:** no figure anywhere on elevenlabs.io for music or sound-effects generation; the [latency concept page](https://elevenlabs.io/docs/eleven-api/concepts/latency/llms.txt) covers speech only and says "measure from your application." _Secondary:_ a reseller ([Magnific](https://docs.magnific.com/api-reference/music-generation/overview)) quotes 30–90 s depending on length, under a minute for 10–30 s tracks. Design for tens of seconds: generate during the Maker's build, not on tap.
- **Concurrency:** music is 2 concurrent generations on Starter–Pro and 5 on Scale/Business ([models](https://elevenlabs.io/docs/overview/models); same numbers in the Music Terms). The general 429 help page's 2/3/5/10/15 figures are for speech. Over the limit, requests queue by plan priority (Starter 4, Creator–Business 5).
- **Errors:** 429 with `rate_limit_exceeded` (back off exponentially), `concurrent_limit_exceeded` (wait for in-flight requests), or `system_busy` ("if you retry the request, it will succeed") ([errors](https://elevenlabs.io/docs/eleven-api/resources/errors)). No `Retry-After` header is documented. No per-minute request limit is documented.
- With 2 concurrent slots and ~1 min per track, the ceiling is ~120 tracks/hour, enough for launch; the curated CC0 set (#114) is the fallback when the queue or the API fails.

## 6. Sound-effects endpoint for ambience beds

`POST /v1/sound-generation` ([API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)): `text`, `loop` (default false, "Whether to create a sound effect that loops smoothly", `eleven_text_to_sound_v2` only), `duration_seconds` 0.5–30, `prompt_influence` 0–1 (default 0.3), `output_format` incl. `opus_48000_128`. The capabilities page sells exactly our case: "Generate 30s of 'soft rain' then loop it endlessly for atmosphere in ... games" and "Perfect for atmospheric sounds, ambient textures, and background elements." It is cheaper than music ($0.12/min, so $0.06 per 30 s bed) and the loop is a first-class flag. Licence: the API pricing page calls sound effects royalty-free, and the Music Terms do not apply to it (the general ToU does, with the same paid-plan commercial-use rule). Worth using for spooky/tense/ambient moods where a texture beats a tune; it does not replace music for upbeat/silly. This is a music-track alternative, not the out-of-scope "generated sound effects" feature.

## 7. What #52's disclosure must say

Facts to disclose, each sourced:

- ElevenLabs is a processor: the [DPA](https://elevenlabs.io/dpa) (updated 8 April 2026) appoints ElevenLabs "as a Processor" acting on documented instructions; subprocessors are listed at compliance.elevenlabs.io/subprocessors.
- Data sent: only the mood prompt the app composes and (back) the generated audio. No player identity is in the request. ElevenLabs logs requests by default (`enable_logging` true; zero retention is enterprise-only).
- Location: "Wherever you are, your personal information will be transferred to the United States for storage" ([privacy policy](https://elevenlabs.io/privacy-policy)).
- Training: inputs and outputs may be used to "research, build, train and improve our AI models" unless opted out in the account's Data use menu (privacy policy; ToU §4(i)). Opt out on the hopon account before launch.
- Our duty to label AI content is ours, not satisfied by any ElevenLabs marking (Music Terms §3.4).

Suggested sentence for the listing / privacy disclosure:

> Background music in games is AI-generated by ElevenLabs (ElevenLabs Inc., United States), which processes the short text mood description hopon sends and returns the audio; no information about you is included in that request.

If hopon's account has not opted out of training, add: "ElevenLabs may use that text and audio to improve its models."

## Open items

- Owner: confirm whether hopon subscribes as an individual (Starter/Creator/Pro eligible) or an entity (Scale required). Legal reading, not a doc question.
- Measure real latency and listen to the ffmpeg seam on 3–5 tracks per mood during the eval.
- Whether API output counts toward the Monthly Download Limit is unstated; ask ElevenLabs support before relying on Starter's 30 min.
