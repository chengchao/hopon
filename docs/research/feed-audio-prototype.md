# Feed audio and SSE prototype

A throwaway spike on branch `prototype/feed-audio`, for the Maker plan's game runtime (served `/runtime/v1.js` with LittleJS and a scaffold, ZzFX, and one looping music track per game) and the Make tab's SSE stream. Run 2026-10-15 on the iOS 26.3 simulator (iPhone 16e, Xcode 26.3) in Expo Go (SDK 57, react-native-webview 13.16.1), against `wrangler dev` offline. Logs are in [`feed-audio-prototype/`](feed-audio-prototype/). Each `[audio]` line is a message the page sent back through `window.ReactNativeWebView`, tagged with the game id and whether the app treated that card as active.

"Plays" below means the page reported `music.paused: false` with `currentTime` advancing and the AudioContext `running` at gain 0.3. Nothing was checked by ear, because the simulator's audio goes to the Mac.

## Answers

1. **Serving works, and the CSP needs only the two loosenings in the plan.** Under the old `GAME_CSP` the page reported exactly two violations: `script-src-elem` for `/runtime/v1.js` and `media-src` for `/api/games/:id/assets/music.mp3`. Adding `'self'` to `script-src` and `media-src` fixed both. With the engine running, nothing else was reported, and `'self'` still matches the Worker's origin even though `sandbox allow-scripts` gives the document an opaque origin. One surprise: the pinned `littlejs.min.js` is **488 KB (151 KB gzipped)**, not the ~40 KB the plan assumed.
2. **No tap is needed, whichever way `mediaPlaybackRequiresUserAction` is set.** react-native-webview's iOS `postMessage` runs `evaluateJavaScript`, which WebKit treats as a user gesture, so the app's `{type:'resume'}` starts the `<audio>` and the AudioContext by itself. With the prop `true` (the repo's current value), a page's own `play()` is refused with `NotAllowedError`, so only the app can start sound. **Keep it `true`.** `allowsInlineMediaPlayback` makes no difference for `<audio>`. ZzFX plays on a tap in both settings.
3. **The bridge works.** Off-screen cards stay silent and the active card resumes where it left off. Mute holds across cards, including ones mounted later. The prototype also found one gap, now fixed in the scaffold: a screen over the feed, or the app going to the background, did not stop the `<audio>` element. **The ringer switch is untested**, because the simulator has no ring/silent switch. It needs a real device.
4. **expo/fetch streams on iOS**, so react-native-sse isn't needed (it works too). About 6 s after the app went to the background, the stream ended with a clean EOF, not an error. Reconnecting with `Last-Event-ID` resumed it with no gap and no duplicates. The simulator never suspended the app, so the device behaviour is still unknown.

## 1. Serving a LittleJS game from the Worker

**What was built.**

- [`apps/api/src/runtime/files.ts`](../../apps/api/src/runtime/files.ts) concatenates `littlejsengine/dist/littlejs.min.js` (pinned exactly to `1.27.2`) with [`scaffold.js`](../../apps/api/src/runtime/scaffold.js), both imported as text through wrangler `rules` in `wrangler.jsonc`. `index.ts` imports it lazily, because Node, which runs `test/worker.test.js`, can't load `.mp3` or text modules. [`v1.ts`](../../apps/api/src/runtime/v1.ts) holds the marker, the injected tags and `RUNTIME_CSP`.
- `GET /runtime/v1.js` serves the result with `Cache-Control: public, max-age=31536000, immutable`.
- `GET /api/games/:id/assets/music.mp3` serves [`apps/api/fixtures/music.mp3`](../../apps/api/fixtures/music.mp3), an 8 s, 64 KB loop synthesised with ffmpeg's `aevalsrc` for this spike. It's original output, so there's no licence question.
- `/document` swaps the marker `<!-- hopon:runtime v1 -->` in a game's `<body>` for three things:
  - an inline CSP-violation reporter;
  - `<script src="/runtime/v1.js">`;
  - `<audio data-hopon-music loop preload="auto" src="/api/games/:id/assets/music.mp3">`.

  A document with the marker gets `RUNTIME_CSP`; any other document keeps `GAME_CSP`.

- [`apps/api/fixtures/audio-game.html`](../../apps/api/fixtures/audio-game.html) is the fixture game: plain LittleJS globals (`engineInit`, `drawRect`, `mouseWasPressed`, `zzfx`). Three copies with different hues were seeded into local D1 as games 3–5.

**CSP, exactly what was needed** ([log](feed-audio-prototype/4-csp-unchanged-game-csp.log), served with the unchanged `GAME_CSP`):

```
5 ACTIVE {"event":"csp","directive":"script-src-elem","uri":"http://localhost:8787/runtime/v1.js"}
5 ACTIVE {"event":"csp","directive":"media-src","uri":"http://localhost:8787/api/games/5/assets/music.mp3"}
```

```
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;
media-src 'self' data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts
```

None of the runs with this policy reported a violation, including WebGL drawing and ZzFX through Web Audio.

**Range requests: not required, but iOS asks for them.** AVFoundation first sends `Range: bytes=0-1` and then `bytes=0-64616`. The route answers with 206s. The route was also switched to return a plain 200 with no `Accept-Ranges` header. The 64 KB track still played and looped ([log](feed-audio-prototype/5-no-range-support.log)). Keep Range support anyway for longer tracks; R2's `get` takes a range directly.

**Other findings.**

- **Runtime size.** `/runtime/v1.js` is 490,737 bytes. The game WebView is `incognito`, so it uses a non-persistent data store, and its HTTP cache lasts only as long as the app process. `immutable` therefore saves the download on each card, but not on each cold start. Before shipping, build the runtime from LittleJS's `src/` without the plugins, or drop `incognito`; the sandbox's opaque origin already denies storage.
- **The global middleware sets `Cache-Control: no-store` on every response.** The prototype changed it to set the header only when a route hasn't.
- **pnpm added `littlejsengine@1.27.2` to `minimumReleaseAgeExclude`**, because the release is newer than the repo's minimum release age. Pin a release that has aged instead.
- **The asset and runtime routes are unauthenticated.** react-native-webview documents `source.headers` as applying to the first request only (not checked here), so subresources can't carry the Clerk token. Unpublished drafts will need a capability URL, or assets scoped by revision.

## 2. Autoplay and WebView props

The runtime decides what the scaffold does at load and on a message.

- **At load:** it starts paused whenever `window.ReactNativeWebView` exists. It applies that state at script start, sets the master gain to 0, and suspends the AudioContext.
- **On `resume`:** it calls `audio.play()` and `audioResume()` synchronously inside the message handler.

A probe also called `play()` on a detached `new Audio(src)` at `load`, outside any gesture or message.

| `mediaPlaybackRequiresUserAction` | Page's own `play()` at load | `play()` inside the app's `resume` message | ZzFX after a tap |
| --- | --- | --- | --- |
| `false` | **plays**, even on an off-screen card ([log](feed-audio-prototype/3a-gesture-not-required.log)) | plays | plays |
| `true` (repo default) | `NotAllowedError` ([log](feed-audio-prototype/3b-gesture-required.log)) | **plays, with no tap** | plays |

```
4 offscreen {"event":"probe-play-rejected","error":"NotAllowedError",...}
5 ACTIVE {"event":"got-resume","ctx":"interrupted",...,"music":{"paused":false,"ready":0,"t":0},"tapped":false}
5 ACTIVE {"event":"music-play-ok","ctx":"running",...,"tapped":false}
4 ACTIVE {"event":"sfx","taps":1,"ctx":"running","gain":0.30000001192092896,...}
```

**Why the `resume` message counts as a gesture.** On iOS, `RNCWebViewImpl.postMessage` injects `window.dispatchEvent(new MessageEvent('message', …))` through `evaluateJavaScript`, and WKWebView runs that with a user gesture. A game can't start sound by itself; only the app's message can. This holds only if the scaffold calls `play()` and `resume()` synchronously in the handler; a `play()` after an `await` would lose the gesture.

**Props.**

- `mediaPlaybackRequiresUserAction`: leave it `true`. With `false`, any game can autoplay from an off-screen neighbour, and the scaffold's start-paused rule is the only thing stopping it.
- `allowsInlineMediaPlayback`: not needed for `<audio>`. Set to `false`, the track still played ([log](feed-audio-prototype/3c-no-inline-playback.log)). It's harmless, so it stays.

## 3. The feed bridge

**How it was wired.** [`game-view.tsx`](../../apps/mobile/components/game-view.tsx) takes `active` and `muted` and sends:

- `{type:'pause'|'resume'}` when `active` changes;
- `{type:'mute', on}` when `muted` changes;
- both again on `onLoadEnd`, so a card that mounts late gets the current state.

[`feed.tsx`](../../apps/mobile/components/feed.tsx) passes `active={index === active}` and one `muted` state shared by every card. It also adds prototype pills, Mute and `gesture: required`; the second flips `mediaPlaybackRequiresUserAction` and remounts the WebViews.

The scaffold listens for messages on both `window` (iOS) and `document` (Android). It applies the state like this:

- **pause:** `setPaused(true)`, `audio.pause()`, and suspend the AudioContext;
- **mute:** set `soundVolume` to 0, which the engine copies to the master gain, and set `audio.muted`.

Mute doesn't suspend the context, because LittleJS calls `audioResume()` on every input event; a tap would unmute.

**Swiping** ([log](feed-audio-prototype/1-swipe.log)). The card that leaves pauses with `currentTime` frozen, the new one resumes, and swiping back continues from the saved position:

```
5 offscreen {"event":"got-pause","ctx":"running","gain":0,"music":{"paused":true,"ready":4,"t":1.4},...}
4 ACTIVE {"event":"got-resume",...} → {"event":"music-play-ok","ctx":"running",...}
5 offscreen {"event":"tick","ctx":"interrupted","gain":0,"music":{"paused":true,"ready":4,"t":1.4},...}
   … swipe back …
5 ACTIVE {"event":"got-resume","ctx":"suspended",...,"t":1.4} → {"event":"music-play-ok","ctx":"running",...}
```

Notes from the swipe runs:

- The feed mounts only cards within one of the active card, so at most two off-screen WebViews exist at once.
- A paused card's AudioContext goes to `interrupted` when another WebView starts playing. `resume()` brings it back to `running`, as seen above.
- The first scaffold applied its state only on `load`. Before that, an off-screen card briefly had a running context at gain 0.3. Applying at script start closed that window.

**Mute** ([log](feed-audio-prototype/2-mute.log), [screenshot](feed-audio-prototype/2-muted-card.png)). Mute reached both mounted cards. A tap while muted ran ZzFX at gain 0. Card 3, mounted after the swipe, got `muted: true` on load, and card 4 resumed muted:

```
5 ACTIVE {"event":"sfx","taps":2,"ctx":"running","gain":0,...,"muted":true,...}
3 offscreen {"event":"got-mute",...,"muted":true,"paused":true,...}
4 ACTIVE {"event":"tick","ctx":"running","gain":0,"music":{"paused":false,...},"muted":true,...}
```

Mute is React state in `Feed`. It lasts as long as the feed is mounted, not across app restarts.

**Found and fixed: the feed's music played under other screens and in the background.**

- **The gap.** With the sse-test screen pushed over Discover, the active card's `currentTime` kept advancing. LittleJS suspends its AudioContext on `visibilitychange`, but an `<audio>` element ignores it.
- **The fix.** The scaffold now pauses the music when `document.hidden` and resumes it on `visible`, unless the card is paused. A WKWebView whose screen is covered reports hidden, and so does a backgrounded app.
- **Verified** with both gesture settings ([log](feed-audio-prototype/7-visibility.log), [gesture required](feed-audio-prototype/7b-visibility-gesture-required.log)):

```
5 ACTIVE {"event":"hidden","ctx":"running",...,"music":{"paused":true,"ready":4,"t":6},...}
5 ACTIVE {"event":"visible",...,"music":{"paused":false,"ready":4,"t":6},...}
5 ACTIVE {"event":"hidden","ctx":"interrupted",...,"music":{"paused":true,"ready":4,"t":7.6},...}   ← HOME
```

**Ringer switch: not tested.**

- The simulator has no ring/silent switch. The iPhone 16e's Action Button, whose default action is Silent Mode, appears under Device → Action Button, but the menu item was disabled in this session (the device was streamed headless).
- expo-av is gone in SDK 57, so the prototype calls expo-audio's `setAudioModeAsync({ playsInSilentMode: false })` instead. The call succeeds; the log reads `[audio] setAudioModeAsync playsInSilentMode=false`.
- **Doubt about whether that call reaches WebView audio.** macOS showed the simulator's audio device held by `com.apple.WebKit.GPU`, WebKit's own process. The app's AVAudioSession category may therefore not govern WebView audio.
- **Device check:**
  1. With the switch on silent, does the `<audio>` track play? Does ZzFX?
  2. If either plays, try `navigator.audioSession.type = 'ambient'` in the scaffold (WebKit's Audio Session API, Safari 16.4+).

  LittleJS already sets `navigator.audioSession.type` to `'auto'` (its `soundIgnoreSilentSwitch` is false), but that affects Web Audio only.

## 4. SSE through the Worker

**What was built.**

- `GET /api/sse-test?n=&ms=` (Hono `streamSSE`) sends `n` `tick` events `ms` apart, each with an `id`, then a `done` event. It resumes after `Last-Event-ID`.
- [`app/sse-test.tsx`](../../apps/mobile/app/sse-test.tsx) (`exp://127.0.0.1:8081/--/sse-test`) reads the stream two ways:
  - with expo/fetch, reading `response.body.getReader()` and parsing by hand, then reconnecting with `Last-Event-ID` until `done`;
  - with react-native-sse.

**expo/fetch streams on iOS.** All 10 events arrive in real time, 500 ms apart ([log](feed-audio-prototype/6a-sse-expo-fetch.log)):

```
05:53.881 fetch connect #1 Last-Event-ID=-
05:54.470 fetch event tick id=1
05:54.942 fetch event tick id=2   … 500 ms apart …
05:58.949 fetch event tick id=10
05:58.950 fetch done
```

react-native-sse (XHR) also streamed in real time ([log](feed-audio-prototype/6d-sse-react-native-sse.log)). It isn't needed.

**Backgrounded for 30 s mid-stream.**

- **The 10-event stream** finished all its events in the background ([log](feed-audio-prototype/6b-sse-expo-fetch-background-short.log)), so the run was repeated with 60 events, 1 s apart.
- **The 60-event stream** ([log](feed-audio-prototype/6c-sse-expo-fetch-background-30s.log)) was sent to the background after event 5:

  ```
  07:32.883 AppState background
  07:37.818 fetch event tick id=11
  07:38.581 fetch stream ended before done      ← clean EOF, ~6 s after backgrounding, not an error
  07:39.817 fetch connect #2 Last-Event-ID=11
  07:40.917 fetch event tick id=12               ← no gap, no duplicate
  …
  08:02.512 AppState active
  08:28.904 fetch done
  ```

  On the server, the log shows `sse open, Last-Event-ID 0`, then `sse open, Last-Event-ID 11`, then `sse closed after 60`. The first connection never logged `onAbort` or a close in `wrangler dev`.

**What follows for the Make tab.**

- The client must treat an EOF without `done` as a dropped connection, and reconnect with `Last-Event-ID`.
- The server must give events ids and replay after `Last-Event-ID`. The Maker plan's events need ids for this.
- The simulator kept running the app in the background, so it reconnected and kept receiving events for the whole 30 s. A device will suspend the app. Also reconnect on `AppState` `active`, and on a device check what a suspended `fetch` does: error, hang, or EOF.
- The Worker didn't notice the first client going away in local dev, so check `onAbort` against the deployed Worker before relying on it for cleanup.

## The diff kept for reuse

**API**

- `apps/api/src/runtime/{files.ts,v1.ts,scaffold.js,modules.d.ts}`: the runtime, the CSP, and the marker injection. `scaffold.js` is the part worth keeping.
- `apps/api/src/index.ts`: `/runtime/v1.js`, the asset route with Range support, `/api/sse-test`, the marker branch in `/document`, and `Cache-Control` set only when a route hasn't set one.
- `apps/api/wrangler.jsonc`: `rules` for the text and data imports.
- `apps/api/fixtures/`: the fixture game and music.

**App**

- `apps/mobile/components/game-view.tsx`: the bridge (`active` and `muted` props, `onLoadEnd` sync, an `onMessage` logger).
- `apps/mobile/components/feed.tsx`: passes `active` and `muted`, sets the audio mode, and adds the prototype pills.
- `apps/mobile/app/sse-test.tsx`: the SSE client.

The committed code, with `mediaPlaybackRequiresUserAction` back to `true` and the probes removed, was rerun on the simulator: resume, music and swipe-pause all work ([log](feed-audio-prototype/8-final-build.log)). `pnpm check` passes.

**Before shipping, drop:**

- the per-tick and `onMessage` reporting;
- the gesture toggle (keep `mediaPlaybackRequiresUserAction`);
- the pills, the fixture route behaviour (every game gets `music.mp3`) and `/api/sse-test`.

**Still open**

- Ringer switch and SSE suspension on a real device.
- A smaller LittleJS build.
- How unpublished drafts' assets are authorised.
- Whether to keep `incognito` given the runtime's cache.
