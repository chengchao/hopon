// The Vite games' scaffold (hopon.js, served at /hopon/v1.js), a global the game's modules read.
// A sound effect: the pitch glides from freq to `to` Hz over ms; noise is band-passed noise.
interface HoponSound {
  freq: number;
  to?: number;
  ms: number;
  wave?: OscillatorType | "noise";
  volume?: number;
  // Start this long after the call, for the second note of a jingle.
  delayMs?: number;
}
interface Hopon {
  // Plays a sound effect, silent when muted, while paused and before the first touch.
  play: (sound: HoponSound) => void;
  score: number;
  best: number;
  state: "start" | "play" | "over";
  won: boolean;
  // The feed scrolled the game away; the game stops its clock until it's false.
  paused: boolean;
  muted: boolean;
  // The start screen's lines: the title defaults to the page's <title>.
  title: string;
  hint: string;
  // The over screen's words, English by default: a game in another language sets them.
  text: {
    win: string;
    over: string;
    score: string;
    best: string;
    again: string;
  };
  // What the game's tests read, set by the game.
  testVars: Record<string, unknown>;
  loaded: boolean;
  addScore: (points?: number) => void;
  gameOver: (won?: boolean) => void;
  start: () => void;
  // Calls the listener after each change to the score, the state, paused or muted; returns the unsubscribe.
  subscribe: (listener: (hopon: Hopon) => void) => () => void;
  ready: () => void;
}
declare const hopon: Hopon;
