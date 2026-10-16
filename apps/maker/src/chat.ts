// pnpm -F maker chat "<prompt>" --model <id> --box local|e2b [--no-images] [--steer "<text>"]
// One Maker session, streamed to the terminal; game.ts, game.js, playtest.png and the transcript land in out/<run>/.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { AssistantMessage } from "@earendil-works/pi-ai";

import { E2BBox, LocalBox } from "./box.ts";
import type { Box } from "./box.ts";
import { createMaker, exportJsonl, MAX_RUNS } from "./maker.ts";

export interface RunOptions {
  prompt: string;
  modelId: string;
  boxKind: "local" | "e2b";
  images?: boolean;
  steer?: string;
  quiet?: boolean;
}

const playtestResult = (text: string) => {
  const line = text
    .split("\n")
    .find(
      (candidate) =>
        candidate.includes('"screenshot":"playtest.png"') ||
        candidate.startsWith('{"errors"')
    );
  return line
    ? (JSON.parse(line) as { ok: boolean; errors: string[] })
    : undefined;
};

export const runOnce = async ({
  prompt,
  modelId,
  boxKind,
  images = true,
  steer,
  quiet = false,
}: RunOptions) => {
  const started = Date.now();
  const slug = prompt
    .toLowerCase()
    .replaceAll(/[^a-z]+/gu, "-")
    .slice(0, 24);
  const dir = path.join(
    import.meta.dirname,
    "..",
    "out",
    `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${modelId}-${slug}`
  );
  mkdirSync(dir, { recursive: true });
  const box: Box =
    boxKind === "e2b" ? await E2BBox.create() : await LocalBox.create();
  const { session } = await createMaker({ box, images, modelId });
  const log = (text: string) => quiet || process.stdout.write(text);

  let runs = 0;
  const playtests: boolean[] = [];
  const errors: string[] = [];
  let imagesSent = 0;
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      log(event.assistantMessageEvent.delta);
    } else if (event.type === "tool_execution_start") {
      if (event.toolName === "run_node") {
        runs += 1;
        if (runs === 1 && steer) {
          // Mid-run steering: delivered after this assistant turn's tool calls finish.
          void session.steer(steer);
        }
        if (runs > MAX_RUNS) {
          void session.abort();
        }
      }
      const detail =
        event.toolName === "run_node"
          ? String(event.args.code).split("\n").slice(-3).join(" ⏎ ")
          : JSON.stringify(event.args);
      log(`\n▶ ${event.toolName} ${detail.slice(0, 160)}\n`);
    } else if (event.type === "tool_execution_end") {
      const content = event.result?.content ?? [];
      const text = content
        .filter((part: { type: string }) => part.type === "text")
        .map((part: { text: string }) => part.text)
        .join("\n");
      imagesSent += content.filter(
        (part: { type: string }) => part.type === "image"
      ).length;
      const result =
        event.toolName === "run_node" ? playtestResult(text) : undefined;
      if (result) {
        playtests.push(result.ok);
      }
      log(
        `◀ ${event.isError ? "error " : ""}${text.slice(0, 300).replaceAll("\n", " ")}\n`
      );
    } else if (
      event.type === "message_end" &&
      event.message.role === "assistant" &&
      (event.message as AssistantMessage).stopReason === "error"
    ) {
      errors.push((event.message as AssistantMessage).errorMessage ?? "error");
      log(`\n✖ ${(event.message as AssistantMessage).errorMessage}\n`);
    }
  });

  await session
    .prompt(prompt)
    .catch((error: unknown) => errors.push(String(error)));
  log("\n");

  const assistant = session.messages.filter(
    (message): message is AssistantMessage => message.role === "assistant"
  );
  const usage = { cost: 0, input: 0, output: 0 };
  for (const { usage: turn } of assistant) {
    usage.cost += turn.cost.total;
    usage.input += turn.input + turn.cacheRead + turn.cacheWrite;
    usage.output += turn.output;
  }
  await Promise.all(
    ["game.ts", "game.js", "playtest.png"].map((file) =>
      box
        .readFile(file)
        .then((bytes) => writeFileSync(path.join(dir, file), bytes))
        // The model never got that far.
        .catch(() => null)
    )
  );
  writeFileSync(path.join(dir, "transcript.jsonl"), exportJsonl(session));
  const summary = {
    dir,
    errors,
    firstPlaytestOk: playtests[0] ?? false,
    imagesSent,
    lastPlaytestOk: playtests.at(-1) ?? false,
    model: modelId,
    playtests: playtests.length,
    prompt,
    reply:
      assistant
        .at(-1)
        ?.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("") ?? "",
    runs,
    seconds: Math.round((Date.now() - started) / 1000),
    turns: assistant.length,
    usage,
  };
  writeFileSync(
    path.join(dir, "result.json"),
    JSON.stringify(summary, null, 2)
  );
  session.dispose();
  if (box instanceof E2BBox) {
    await box.sandbox.kill();
  }
  return summary;
};

if (import.meta.main) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      box: { default: "local", type: "string" },
      model: { default: "claude-haiku-5-5", type: "string" },
      "no-images": { type: "boolean" },
      steer: { type: "string" },
    },
  });
  const summary = await runOnce({
    boxKind: values.box === "e2b" ? "e2b" : "local",
    images: !values["no-images"],
    modelId: values.model,
    prompt: positionals.join(" "),
    steer: values.steer,
  });
  const { reply: _reply, ...rest } = summary;
  console.log(JSON.stringify(rest, null, 2));
}
