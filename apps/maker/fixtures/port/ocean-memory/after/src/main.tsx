import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { CREATURES, flip, hideMiss, newGame } from "./memory";

import "./style.css";

hopon.hint = "Find all 8 pairs";

let round = 0;
let lastState = hopon.state;
hopon.subscribe(() => {
  if (hopon.state === "play" && lastState !== "play") {
    round += 1;
  }
  lastState = hopon.state;
});
const useRound = () => useSyncExternalStore(hopon.subscribe, () => round);
const usePaused = () =>
  useSyncExternalStore(hopon.subscribe, () => hopon.paused);

const MISS_SHOWN_MS = 800;

const Board = () => {
  const [game, setGame] = useState(newGame);
  const paused = usePaused();

  useEffect(() => {
    if (!game.miss || paused) {
      return;
    }
    const id = setTimeout(() => setGame(hideMiss), MISS_SHOWN_MS);
    return () => clearTimeout(id);
  }, [game.miss, paused]);

  const tap = (index: number) => {
    if (hopon.state !== "play") {
      return;
    }
    const next = flip(game, index);
    if (next === game) {
      return;
    }
    setGame(next);
    if (next.found > game.found) {
      hopon.addScore(1);
    }
    if (next.found === CREATURES.length) {
      hopon.gameOver(true);
    }
  };

  hopon.testVars.moves = game.moves;
  hopon.testVars.found = game.found;
  hopon.testVars.faceUp = game.cards.filter(
    (card) => card.side === "up"
  ).length;

  return (
    <main className="game">
      <h1>🌊 Ocean Memory</h1>
      <div className="info">Moves {game.moves}</div>
      <div className="grid">
        {game.cards.map((card, index) => (
          <button
            className={`card ${card.side}`}
            key={card.id}
            onPointerDown={() => tap(index)}
            type="button"
          >
            <span className="face back">🐚</span>
            <span className="face front">{card.creature}</span>
          </button>
        ))}
      </div>
      <div className="msg">
        {game.found === CREATURES.length
          ? `You won in ${game.moves} moves! 🎉`
          : ""}
      </div>
    </main>
  );
};

const App = () => {
  useEffect(() => hopon.ready(), []);
  return <Board key={useRound()} />;
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<App />);
}
