// hopon's plain-DOM scaffold, served at /dom/v1.js before game.js (by the Worker and the box's playtest, the same
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
