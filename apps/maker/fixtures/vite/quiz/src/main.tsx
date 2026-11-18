import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

const QUESTIONS = [
  { answer: "4", options: ["3", "4", "5"], question: "2 + 2" },
  { answer: "9", options: ["6", "8", "9"], question: "3 × 3" },
];

const snapshot = () => `${hopon.state}:${hopon.score}`;

const Quiz = () => {
  useSyncExternalStore(hopon.subscribe, snapshot);
  const [index, setIndex] = useState(0);
  useEffect(() => hopon.ready(), []);
  const { answer, options, question } = QUESTIONS[index % QUESTIONS.length];
  hopon.testVars.question = question;
  const choose = (option: string) => {
    if (option === answer) {
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
      {options.map((option) => (
        <button key={option} onClick={() => choose(option)} type="button">
          {option}
        </button>
      ))}
    </main>
  );
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<Quiz />);
}
