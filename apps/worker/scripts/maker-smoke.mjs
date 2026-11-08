// `pnpm -F worker smoke:maker [--music]`, with `pnpm -F worker dev:maker` running: one build for a new Draft, through
// a real Maker (both agents on their real models) and a real sandbox in Docker, by the dev route. It adds the Draft's
// row to the local D1, asks the main agent for a game, prints the sub agent's steps and the turn's end as they come,
// then deletes the Draft, which destroys its box. About a minute and a cent.
import { spawnSync } from "node:child_process";

const base = process.env.MAKER_URL ?? "http://localhost:8787";
const API = new URL("..", import.meta.url).pathname;
const draftId = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");
const music = process.argv.includes("--music");
const ask = `Make this game now, without asking anything: Stars fall from the top. Tap left or right to move a basket and catch them; one point each. Miss three and the game is over. Night sky, gold stars, a wooden basket.${music ? " With calm lo-fi music." : ""}`;

const started = Date.now();
const seconds = () => ((Date.now() - started) / 1000).toFixed(1);
const wrangler = (...args) => {
  const { status, stderr } = spawnSync("npx", ["wrangler", ...args], {
    cwd: API,
    encoding: "utf-8",
  });
  if (status !== 0) {
    throw new Error(`wrangler ${args.join(" ")}: ${stderr}`);
  }
};
const maker = (path, body) =>
  fetch(`${base}/__maker/${draftId}/${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    method: "POST",
  });

// The build checks the owner's Allowance on the Draft's row.
wrangler("d1", "migrations", "apply", "DB", "--local");
wrangler(
  "d1",
  "execute",
  "DB",
  "--local",
  "--command",
  `INSERT INTO drafts (id, owner) VALUES ('${draftId}', 'user_smoke')`
);

const socket = new WebSocket(
  `${base.replace(/^http/u, "ws")}/__maker/${draftId}/ws`
);
const opened = Promise.withResolvers();
socket.addEventListener("open", opened.resolve, { once: true });
socket.addEventListener("error", opened.reject, { once: true });
await opened.promise;
let built = false;
const ended = Promise.withResolvers();
socket.addEventListener("message", ({ data }) => {
  const frame = JSON.parse(data);
  if (frame.type === "turn_done" || frame.type === "turn_failed") {
    console.log(seconds(), JSON.stringify(frame));
    ended.resolve(frame.type);
    return;
  }
  for (const event of frame.type === "batch" ? frame.data : []) {
    if (event.type === "tool_execution_update") {
      console.log(seconds(), "step", JSON.stringify(event.output));
    } else if (event.type === "tool_execution_end") {
      const [result] = event.entry.model;
      built ||= result.toolName === "build" && !result.isError;
      console.log(
        seconds(),
        result.toolName,
        result.isError ? "failed" : "done",
        JSON.stringify(result.content)
      );
    } else if (
      event.type === "message_end" &&
      event.entry.kind === "pi.assistant"
    ) {
      const text = event.entry.model[0].content.flatMap((block) =>
        block.type === "text" ? [block.text] : []
      );
      console.log(seconds(), "main agent:", text.join(""));
    }
  }
});

const sent = await maker("message", { text: ask });
console.log(seconds(), `message ${sent.status}`);
const outcome = await ended.promise;
socket.close();

const deleted = await maker("delete");
console.log(seconds(), `delete ${deleted.status}`);
wrangler(
  "d1",
  "execute",
  "DB",
  "--local",
  "--command",
  `DELETE FROM drafts WHERE id = '${draftId}'`
);
process.exit(outcome === "turn_done" && built && deleted.ok ? 0 : 1);
