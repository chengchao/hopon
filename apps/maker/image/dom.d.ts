// The plain-DOM scaffold (dom.js); game.ts also gets the DOM library.
declare const hopon: {
  score: number;
  best: number;
  state: "play" | "over";
  won: boolean;
  addScore: (points?: number) => void;
  gameOver: (won?: boolean) => void;
  restart: () => void;
};
