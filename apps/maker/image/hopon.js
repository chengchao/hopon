// hopon's scaffold for Vite games (React, Phaser, r3f), served at /hopon/v2.js as a classic script before the game's
// module, by the Worker and the box's playtest, the same bytes. It draws on no engine: it keeps the score and the state,
// shows the start and over screens as a DOM overlay above whatever the game draws, plays the music, and carries the
// feed's pause, resume and mute. The game calls addScore and gameOver, and follows the rest with subscribe.
// A module can't set a global by declaring it, so the game's test variables go in hopon.testVars.
(() => {
  // Sound plays with the ringer switch on silent and pauses the player's own music, as in the other scaffolds.
  if (navigator.audioSession) {
    navigator.audioSession.type = "playback";
  }
  // A touch on the over screen this soon after the game ends is the last move's, not a restart.
  const RESTART_AFTER_MS = 500;
  const hopon = {
    best: 0,
    // Set by ready(), which the game calls once it has drawn its first screen, so the playtest knows it loaded.
    loaded: false,
    muted: false,
    paused: false,
    score: 0,
    state: "start",
    testVars: {},
    won: false,
  };
  // The screens' words: the start screen's title and hint, and the over screen's, which a game in another language
  // replaces. A game may set them after the overlay first draws (from an effect, after a load), so each one redraws it.
  const words = {
    hint: "Tap to start",
    text: {
      again: "Tap to play again",
      best: "Best",
      over: "Game over",
      score: "Score",
      win: "You win",
    },
    title: "",
  };
  const listeners = new Set();
  let overAt = 0;

  // The playtest's clock: it stops when the page's main thread hangs.
  let frames = 0;
  const tick = () => {
    frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  globalThis.hoponClock = () => frames / 60;

  const overlay = document.createElement("div");
  overlay.id = "hopon-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;box-sizing:border-box;background:radial-gradient(circle at 50% 40%,rgba(0,0,0,.35),rgba(0,0,0,.72));color:#fff;font:700 24px system-ui,sans-serif;text-align:center;overflow-wrap:anywhere;word-break:break-word;text-shadow:0 2px 6px rgba(0,0,0,.6);touch-action:none;user-select:none;-webkit-user-select:none";
  const draw = () => {
    overlay.style.display = hopon.state === "play" ? "none" : "flex";
    const lines =
      hopon.state === "start"
        ? [[hopon.title || document.title, 32], [hopon.hint]]
        : [
            [hopon.won ? hopon.text.win : hopon.text.over, 32],
            [`${hopon.text.score} ${hopon.score}`],
            [`${hopon.text.best} ${hopon.best}`, 16],
            [hopon.text.again],
          ];
    overlay.replaceChildren(
      ...lines.map(([text, size]) => {
        const element = document.createElement("div");
        element.textContent = text;
        if (size) {
          element.style.fontSize = `${size}px`;
        }
        return element;
      })
    );
  };
  for (const name of Object.keys(words)) {
    Object.defineProperty(hopon, name, {
      enumerable: true,
      get: () => words[name],
      set(value) {
        words[name] = value;
        draw();
      },
    });
  }
  const mount = () => {
    document.body.append(overlay);
    draw();
  };
  if (document.body) {
    mount();
  } else {
    addEventListener("DOMContentLoaded", mount);
  }

  // The music: the page names its Opus loop on this script's data-music, fetched from the start. iOS lets audio start
  // only from a touch, so it starts at the first one, and each later touch resumes it in case that one didn't count.
  const musicSrc = document.currentScript?.dataset.music;
  const loadMusic = async () => {
    try {
      const response = await fetch(musicSrc);
      return await response.arrayBuffer();
    } catch (error) {
      console.warn("hopon: the music didn't load", error);
    }
  };
  const musicFile = musicSrc ? loadMusic() : undefined;
  let audio;
  const syncAudio = () => {
    if (!audio) {
      return;
    }
    audio.gain.gain.value = hopon.muted ? 0 : 1;
    if (hopon.paused) {
      audio.context.suspend();
    } else {
      audio.context.resume();
    }
  };
  // The game's sound effects play through the same context, so they follow the mute and the pause with the music.
  const startAudio = async () => {
    if (audio) {
      syncAudio();
      return;
    }
    const context = new AudioContext();
    const gain = context.createGain();
    gain.connect(context.destination);
    audio = { context, gain };
    syncAudio();
    if (!musicFile) {
      return;
    }
    try {
      const source = context.createBufferSource();
      source.buffer = await context.decodeAudioData(await musicFile);
      source.loop = true;
      source.connect(gain);
      source.start();
    } catch (error) {
      console.warn("hopon: the music didn't load", error);
    }
  };
  // iOS lets audio start only at a touch's end, so pointerup and touchend; other browsers at its start.
  for (const type of ["pointerdown", "pointerup", "touchend", "keydown"]) {
    addEventListener(type, startAudio, { capture: true });
  }

  // A sound effect, synthesized: an oscillator or band-passed noise whose pitch glides from freq to `to` Hz over ms,
  // with a short attack and an exponential fade. Silent until the first touch, and while paused.
  let noise;
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- the IIFE keeps it off the page's globals
  const whiteNoise = (context) => {
    const buffer = context.createBuffer(
      1,
      context.sampleRate,
      context.sampleRate
    );
    const data = buffer.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < data.length; i += 1) {
      seed = (seed * 16_807) % 2_147_483_647;
      data[i] = (seed / 2_147_483_647) * 2 - 1;
    }
    return buffer;
  };
  const play = ({
    freq,
    to = freq,
    ms,
    wave = "square",
    volume = 0.3,
    delayMs = 0,
  }) => {
    if (!audio || hopon.paused) {
      return;
    }
    const { context } = audio;
    const start = context.currentTime + delayMs / 1000;
    const end = start + ms / 1000;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(audio.gain);
    let source;
    if (wave === "noise") {
      noise ??= whiteNoise(context);
      source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(freq, start);
      filter.frequency.exponentialRampToValueAtTime(to, end);
      source.connect(filter).connect(envelope);
    } else {
      source = context.createOscillator();
      source.type = wave;
      source.frequency.setValueAtTime(freq, start);
      source.frequency.exponentialRampToValueAtTime(to, end);
      source.connect(envelope);
    }
    source.start(start);
    source.stop(end + 0.02);
  };

  const changed = () => {
    for (const listener of listeners) {
      listener(hopon);
    }
    syncAudio();
    draw();
  };
  Object.assign(hopon, {
    addScore(points = 1) {
      if (hopon.state === "play") {
        hopon.score += points;
        changed();
      }
    },
    gameOver(won = false) {
      if (hopon.state !== "play") {
        return;
      }
      hopon.state = "over";
      hopon.won = won;
      hopon.best = Math.max(hopon.best, hopon.score);
      overAt = performance.now();
      changed();
    },
    play,
    ready() {
      hopon.loaded = true;
      draw();
    },
    start() {
      hopon.score = 0;
      hopon.won = false;
      hopon.state = "play";
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  // The tap that starts a round is the overlay's alone. The overlay hides on its press, so the release and the click
  // after it would land on the game: each is swallowed once, before the game's own listeners. A browser may not send
  // them all, so the next press ends the swallowing too. A touchend goes to the overlay, where its touch started, so
  // it passes: Phaser reads it on window to free the touch's pointer, and without it ignored every later tap on iOS,
  // which gives each touch a new identifier (/hopon/v1.js swallowed it).
  const RELEASES = ["pointerup", "mouseup", "click"];
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- the IIFE keeps it off the page's globals
  const swallow = (event) => {
    event.stopImmediatePropagation();
    removeEventListener(event.type, swallow, { capture: true });
  };
  const disarm = () => {
    for (const type of RELEASES) {
      removeEventListener(type, swallow, { capture: true });
    }
  };
  addEventListener("pointerdown", disarm, { capture: true });
  overlay.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (
      hopon.state === "over" &&
      performance.now() - overAt < RESTART_AFTER_MS
    ) {
      return;
    }
    for (const type of RELEASES) {
      addEventListener(type, swallow, { capture: true });
    }
    hopon.start();
  });

  // The feed's bridge: the app posts {type: "pause" | "resume"} as the game scrolls away and back, and
  // {type: "mute", on} as the feed mutes. It posts to window on iOS and to document on Android.
  const message = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data?.type === "pause" || data?.type === "resume") {
      hopon.paused = data.type === "pause";
    } else if (data?.type === "mute") {
      hopon.muted = Boolean(data.on);
    } else {
      return;
    }
    changed();
  };
  addEventListener("message", message);
  document.addEventListener("message", message);
  globalThis.hopon = hopon;
})();
