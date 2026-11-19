import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

const QUESTIONS = [
  { answer: "4", options: ["3", "4", "5"], question: "2 + 2" },
  { answer: "9", options: ["6", "8", "9"], question: "3 × 3" },
];

const snapshot = () => `${hopon.state}:${hopon.score}`;

// Each option a full-width band 120 px apart from y = 200, where a test taps it.
const option = (index: number) =>
  ({
    height: 100,
    left: 0,
    position: "absolute",
    top: 200 + index * 120,
    width: "100%",
  }) as const;

const Quiz = () => {
  useSyncExternalStore(hopon.subscribe, snapshot);
  const [index, setIndex] = useState(0);
  useEffect(() => hopon.ready(), []);
  const { answer, options, question } = QUESTIONS[index % QUESTIONS.length];
  hopon.testVars.question = question;
  const choose = (choice: string) => {
    if (choice === answer) {
      hopon.addScore();
    }
    if (index + 1 === QUESTIONS.length) {
      hopon.gameOver(hopon.score === QUESTIONS.length);
    }
    setIndex(index + 1);
  };
  return (
    <main style={{ color: "#fff", font: "24px system-ui", padding: 24 }}>
      <h1>{question}</h1>
      {options.map((choice, at) => (
        <button
          key={choice}
          onClick={() => choose(choice)}
          style={option(at)}
          type="button"
        >
          {choice}
        </button>
      ))}
    </main>
  );
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<Quiz />);
}
