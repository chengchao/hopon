// hopon's plain-DOM scaffold, served at /dom/v2.js before game.js (by the Worker and the box's playtest, the same
// bytes). It only keeps the score and the game's state, which the playtest reads; the game draws its own screens. The
// frame counter is the playtest's clock: it stops when the page's main thread hangs.
/* oxlint-disable no-unused-vars -- globals for game.js */
// The ringer switch silences the game, as it does other apps' game sounds, and the player's own music plays on under
// it, as in the LittleJS scaffold.
if (navigator.audioSession) {
  navigator.audioSession.type = "ambient";
}
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
  },
  // music.js sets it when the game has music.
  music: "",
  restart() {
    hopon.score = 0;
    hopon.won = false;
    hopon.state = "play";
  },
  score: 0,
  state: "play",
  won: false,
};

let hoponFrames = 0;
const hoponTick = () => {
  hoponFrames += 1;
  requestAnimationFrame(hoponTick);
};
requestAnimationFrame(hoponTick);
const hoponClock = () => hoponFrames / 60;

// The music: music.js, which the harness puts between this scaffold and the game when it has some, sets hopon.music to
// an Opus loop in base64. iOS lets audio start only from a touch, so it starts at the first one, and each later touch
// resumes it in case that one didn't count. It follows the app's pause, resume and mute, as the LittleJS scaffold does.
let hoponAudio;
let hoponAway = false;
let hoponMuted = false;
const hoponAudioSync = () => {
  if (!hoponAudio) {
    return;
  }
  hoponAudio.gain.gain.value = hoponMuted ? 0 : 1;
  if (hoponAway) {
    hoponAudio.context.suspend();
  } else {
    hoponAudio.context.resume();
  }
};
const hoponMusicStart = async () => {
  if (hoponAudio) {
    hoponAudioSync();
    return;
  }
  if (!hopon.music) {
    return;
  }
  const context = new AudioContext();
  const gain = context.createGain();
  gain.connect(context.destination);
  hoponAudio = { context, gain };
  hoponAudioSync();
  try {
    const bytes = Uint8Array.from(atob(hopon.music), (c) => c.codePointAt(0));
    const source = context.createBufferSource();
    source.buffer = await context.decodeAudioData(bytes.buffer);
    source.loop = true;
    source.connect(gain);
    source.start();
  } catch (error) {
    console.warn("hopon: the music didn't decode", error);
  }
};
for (const type of ["pointerdown", "touchend", "keydown"]) {
  addEventListener(type, hoponMusicStart, { capture: true });
}
// The app posts to window on iOS and to document on Android.
const hoponMessage = (event) => {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (message?.type === "pause" || message?.type === "resume") {
    hoponAway = message.type === "pause";
  } else if (message?.type === "mute") {
    hoponMuted = Boolean(message.on);
  } else {
    return;
  }
  hoponAudioSync();
};
addEventListener("message", hoponMessage);
document.addEventListener("message", hoponMessage);
