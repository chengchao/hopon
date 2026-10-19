// The hopon scaffold (scaffold.js), appended to the narrowed engine declarations.
declare const hopon: {
  title: string;
  hint: string;
  score: number;
  best: number;
  state: "start" | "play" | "over";
  won: boolean;
  addScore: (points?: number) => void;
  gameOver: (won?: boolean) => void;
};
