// `pnpm -F api smoke:coder [--music]`, with `pnpm -F api dev:coder` running: posts one build job for a new Draft to its
// Coder through the dev route, prints each event as it arrives, then kills the Draft's box. A real model and a real
// E2B box: about a minute and a cent.
const base = process.env.CODER_URL ?? "http://localhost:8787";
const draftId = `smoke-${Date.now()}`;
const music = process.argv.includes("--music");
const job = {
  draftId,
  revision: 0,
  source: {},
  spec: {
    brief:
      "Stars fall from the top. Tap left or right to move a basket and catch them; one point each. Miss three and the game is over. Night sky, gold stars, a wooden basket.",
    music: music ? "calm lo-fi, 90 bpm" : null,
    title: "Star Catcher",
  },
};

const started = Date.now();
const seconds = () => ((Date.now() - started) / 1000).toFixed(1);
const response = await fetch(`${base}/__coder/${draftId}/jobs/smoke-1`, {
  body: JSON.stringify(job),
  method: "POST",
});
if (!response.ok || !response.body) {
  console.error(`${response.status} ${await response.text()}`);
  process.exit(1);
}

let last;
let buffer = "";
for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines.filter(Boolean)) {
    last = JSON.parse(line);
    // Files as their sizes: music.opus alone is hundreds of KB of base64.
    const shown = last.files
      ? {
          ...last,
          files: Object.fromEntries(
            Object.entries(last.files).map(([file, text]) => [
              file,
              text.length,
            ])
          ),
        }
      : last;
    console.log(seconds(), JSON.stringify(shown));
  }
}

const killed = await fetch(`${base}/__coder/${draftId}/box`, {
  method: "DELETE",
});
console.log(seconds(), `DELETE /box ${killed.status}`);
process.exit(last?.type === "done" && killed.ok ? 0 : 1);
