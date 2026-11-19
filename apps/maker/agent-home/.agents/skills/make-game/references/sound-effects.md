# Sound effects

Every sound is synthesized with the Web Audio API in `src/sfx.ts`: no files, nothing to load. The scaffold plays the music. This file plays the effects, goes silent when the feed mutes the game, and stops while the feed has it paused.

## src/sfx.ts

Copy it as it is.

```ts
type Wave = OscillatorType | "noise";

export interface Sound {
  // Start and end pitch in Hz; the pitch glides from one to the other.
  freq: number;
  to?: number;
  ms: number;
  wave?: Wave;
  volume?: number;
  // Start this long after the call, for the second note of a jingle.
  delayMs?: number;
}

let context: AudioContext | undefined;
let out: GainNode | undefined;
let noise: AudioBuffer | undefined;

const follow = () => {
  if (!(context && out)) {
    return;
  }
  out.gain.value = hopon.muted ? 0 : 1;
  if (hopon.paused) {
    void context.suspend();
  } else {
    void context.resume();
  }
};

// Browsers start audio only from a touch, and iOS only from a touch's end, never its pointerdown, so the context is
// made, and resumed, as the first touch lifts.
const unlock = () => {
  if (!context) {
    context = new AudioContext();
    out = context.createGain();
    out.connect(context.destination);
  }
  follow();
};
for (const type of ["pointerup", "touchend"]) {
  addEventListener(type, unlock, { capture: true });
}
hopon.subscribe(follow);

const whiteNoise = (audio: AudioContext) => {
  const buffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 16_807) % 2_147_483_647;
    data[i] = (seed / 2_147_483_647) * 2 - 1;
  }
  return buffer;
};

export const play = ({
  freq,
  to = freq,
  ms,
  wave = "square",
  volume = 0.3,
  delayMs = 0,
}: Sound) => {
  if (!(context && out) || hopon.paused) {
    return;
  }
  const start = context.currentTime + delayMs / 1000;
  const end = start + ms / 1000;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(out);
  let source: AudioScheduledSourceNode;
  if (wave === "noise") {
    noise ??= whiteNoise(context);
    const buffer = context.createBufferSource();
    buffer.buffer = noise;
    buffer.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, start);
    filter.frequency.exponentialRampToValueAtTime(to, end);
    buffer.connect(filter).connect(gain);
    source = buffer;
  } else {
    const oscillator = context.createOscillator();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(freq, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, end);
    oscillator.connect(gain);
    source = oscillator;
  }
  source.start(start);
  source.stop(end + 0.02);
};

export const sfx = {
  tap: () => play({ freq: 520, ms: 50, volume: 0.15, wave: "triangle" }),
  flip: () =>
    play({ freq: 700, ms: 70, to: 1100, volume: 0.12, wave: "triangle" }),
  coin: () => {
    play({ freq: 990, ms: 70, volume: 0.2 });
    play({ delayMs: 70, freq: 1320, ms: 140, volume: 0.2 });
  },
  jump: () => play({ freq: 280, ms: 160, to: 620, volume: 0.2 }),
  shoot: () =>
    play({ freq: 900, ms: 110, to: 220, volume: 0.15, wave: "sawtooth" }),
  hit: () => play({ freq: 1200, ms: 220, to: 200, volume: 0.4, wave: "noise" }),
  explosion: () =>
    play({ freq: 600, ms: 600, to: 60, volume: 0.6, wave: "noise" }),
  wrong: () =>
    play({ freq: 220, ms: 220, to: 150, volume: 0.25, wave: "sawtooth" }),
  win: () =>
    [523, 659, 784, 1047].forEach((freq, i) =>
      play({ delayMs: i * 110, freq, ms: 160, volume: 0.22 })
    ),
  lose: () =>
    play({ freq: 440, ms: 700, to: 110, volume: 0.3, wave: "sawtooth" }),
};
```

## Using it

- `import { sfx, play } from "./sfx";` then call `sfx.coin()` when a coin is caught, `sfx.hit()` when the player is hit, `sfx.win()` or `sfx.lose()` next to `hopon.gameOver(...)`.
- Make a new sound with `play({...})` or by adding one to `sfx`. Pitch: 80 to 200 Hz thuds and booms, 300 to 700 jumps and taps, 800 to 2000 coins and sparkles. A rising glide (`to` above `freq`) sounds like a jump or a power-up; a falling one sounds like a hit or a loss. `square` and `sawtooth` are bright and retro, `triangle` and `sine` soft, `noise` is hits, whooshes and explosions.
- Keep effects short: under 300 ms for frequent ones, up to 1 s for the win and the loss.
- Every player action gets a sound, and so do points, hits, the win and the loss. That is what makes a game feel finished.
- Play a sound when something happens, never every frame: a sound started in an update loop without a guard plays 60 times a second.
- The loudest sounds are rare ones (a crash, the win). A sound heard every second stays at 0.1 to 0.2.
- When the Creator asked for silence ("silent", "no sound", "mute", "quiet"), the game has no `sfx.ts` and plays nothing.
