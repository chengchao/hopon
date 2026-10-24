// hopon scaffold: appended to LittleJS in the runtime, before the game's script. The game defines the five
// LittleJS hooks as globals and calls hopon.addScore / hopon.gameOver; the scaffold owns the start screen,
// score, game over and restart, and the feed's bridge. Hooks are looked up by name at call time, so `function` and
// `const` both work. The engine unlocks audio on the first tap and has ZzFX built in.
/* oxlint-disable no-undef, func-style -- a classic script sharing LittleJS's globals */
const hopon = {
  addScore(points = 1) {
    if (hopon.state === "play") {
      hopon.score += points;
    }
  },
  best: 0,
  gameOver(won = false) {
    if (hopon.state !== "play") {
      return;
    }
    hopon.state = "over";
    hopon.won = won;
    hopon.best = Math.max(hopon.best, hopon.score);
    setPaused(true);
  },
  hint: "Tap to start",
  // Set by music.js, when the game has music.
  music: "",
  score: 0,
  state: "start",
  title: "",
  won: false,
};

// The feed's bridge: the app posts {type: "pause" | "resume"} as the game scrolls away and back, and
// {type: "mute", on} as the feed mutes. Away, the clock stops and the audio is suspended; muted, it's silent.
let hoponAway = false;
let hoponVolume = soundVolume;

// The clock runs only in play, and never while the game is scrolled away.
const hoponSync = () => {
  setPaused(hoponAway || hopon.state !== "play");
  if (hoponAway) {
    audioContext?.suspend();
  } else {
    audioResume();
  }
};

const hoponMessage = (event) => {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (message?.type === "pause" || message?.type === "resume") {
    hoponAway = message.type === "pause";
    hoponSync();
  } else if (message?.type === "mute") {
    if (message.on && soundVolume > 0) {
      hoponVolume = soundVolume;
    }
    setSoundVolume(message.on ? 0 : hoponVolume);
  }
};
// iOS delivers the app's postMessage on window, Android on document.
addEventListener("message", hoponMessage);
document.addEventListener("message", hoponMessage);

// Music (#146): a game with music loads music.js between the runtime and game.js, which sets hopon.music to an Opus
// loop in base64; GAME_CSP allows no fetch, so the bytes come in as a script. It's decoded at load and starts on the
// first tap. Web Audio loops the buffer to the sample, so the seam has no gap. It plays through the engine's context
// and master gain, so away (or a hidden page) pauses it and mute silences it, with the effects.
const hoponMusicDecode = async () => {
  if (!hopon.music || !audioContext) {
    return;
  }
  const bytes = Uint8Array.from(atob(hopon.music), (char) =>
    char.codePointAt(0)
  );
  try {
    return await audioContext.decodeAudioData(bytes.buffer);
  } catch (error) {
    console.warn("hopon: the music didn't decode", error);
  }
};
// The decoding, then the decoded loop (undefined without music).
let hoponMusic;
let hoponMusicStarted = false;
const hoponMusicStart = async () => {
  if (hoponMusicStarted) {
    return;
  }
  hoponMusicStarted = true;
  const buffer = await hoponMusic;
  if (buffer) {
    const loop = audioContext.createBufferSource();
    loop.buffer = buffer;
    loop.loop = true;
    loop.connect(audioMasterGain);
    loop.start();
  }
};

const hoponCall = (hook) => {
  // typeof on an undeclared name is safe; a game may leave any hook out.
  const hooks = {
    gameInit: typeof gameInit === "function" ? gameInit : undefined,
    gameRender: typeof gameRender === "function" ? gameRender : undefined,
    gameRenderPost:
      typeof gameRenderPost === "function" ? gameRenderPost : undefined,
    gameUpdate: typeof gameUpdate === "function" ? gameUpdate : undefined,
    gameUpdatePost:
      typeof gameUpdatePost === "function" ? gameUpdatePost : undefined,
  };
  hooks[hook]?.();
};

const hoponTapped = () =>
  mouseWasPressed(0) || keyWasPressed("Space") || keyWasPressed("Enter");

const hoponBegin = () => {
  engineObjectsDestroy();
  hopon.score = 0;
  hopon.won = false;
  hoponCall("gameInit");
};

const hoponOverlay = (lines) => {
  const center = mainCanvasSize.scale(0.5);
  drawRect(center, mainCanvasSize, rgb(0, 0, 0, 0.55), 0, true, true);
  for (const [index, [text, size]] of lines.entries()) {
    drawTextScreen(
      text,
      center.add(vec2(0, (index - 1) * 48)),
      size,
      WHITE,
      4,
      BLACK
    );
  }
};

setShowSplashScreen(false);
addEventListener("load", () => {
  engineInit(
    () => {
      // The ringer switch silences the game, as it does other apps' game sounds, and the player's own music plays on
      // under it. The engine's own setting ("auto", from engineInit) leaves the choice to WebKit.
      if (navigator.audioSession) {
        navigator.audioSession.type = "ambient";
      }
      hoponMusic = hoponMusicDecode();
      hoponBegin();
      hoponSync();
    },
    () => hoponCall("gameUpdate"),
    () => {
      hoponCall("gameUpdatePost");
      if (hopon.state !== "play" && hoponTapped()) {
        if (hopon.state === "over") {
          hoponBegin();
        }
        hopon.state = "play";
        hoponSync();
        hoponMusicStart();
      }
    },
    () => hoponCall("gameRender"),
    () => {
      hoponCall("gameRenderPost");
      if (hopon.state === "play") {
        // Top-left corner, so it never lands on a game's own centred HUD (a timer, say).
        drawTextScreen(
          `★ ${hopon.score}`,
          vec2(14, 26),
          28,
          WHITE,
          4,
          BLACK,
          "left"
        );
      } else if (hopon.state === "start") {
        hoponOverlay([
          [hopon.title, 40],
          [hopon.hint, 24],
        ]);
      } else {
        hoponOverlay([
          [hopon.won ? "You win!" : "Game over", 40],
          [`Score ${hopon.score}  Best ${hopon.best}`, 24],
          ["Tap to play again", 22],
        ]);
      }
    }
  );
});
