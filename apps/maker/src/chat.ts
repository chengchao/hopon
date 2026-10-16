// pnpm -F maker chat "<prompt>" --model <id> --mode run_node|ops --box local|e2b [--no-images] [--steer "<text>"]
// One Maker session, streamed to the terminal; game.ts, game.js, playtest.png, the system prompt and the transcript
// land in out/<run>/.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { AssistantMessage } from "@earendil-works/pi-ai";

import { E2BBox, LocalBox } from "./box.ts";
import type { Box } from "./box.ts";
import { createMaker, exportJsonl, MAX_RUNS } from "./maker.ts";
import type { Mode } from "./maker.ts";

export interface RunOptions {
  prompt: string;
  modelId: string;
  mode?: Mode;
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

const callDetail = (toolName: string, args: Record<string, unknown>) =>
  (toolName === "run_node"
    ? String(args.code).split("\n").slice(-3).join(" ⏎ ")
    : JSON.stringify(args).replaceAll("\\n", " ⏎ ")
  ).slice(0, 160);

const resultParts = (content: { type: string; text?: string }[]) => ({
  images: content.filter((part) => part.type === "image").length,
  text: content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n"),
});

export const runOnce = async ({
  prompt,
  modelId,
  mode = "run_node",
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
    `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${mode}-${modelId}-${slug}`
  );
  mkdirSync(dir, { recursive: true });
  const box: Box =
    boxKind === "e2b" ? await E2BBox.create() : await LocalBox.create();
  const { session } = await createMaker({ box, images, mode, modelId });
  const log = (text: string) => quiet || process.stdout.write(text);
  writeFileSync(path.join(dir, "system-prompt.md"), session.systemPrompt);

  // The step that runs code: run_node, or bash in ops mode.
  const runner = mode === "ops" ? "bash" : "run_node";
  let runs = 0;
  const playtests: boolean[] = [];
  const errors: string[] = [];
  let imagesSent = 0;
  // Wall time per tool call, by tool: the E2B round trips are the cost of ops mode.
  const toolMs: Record<string, number[]> = {};
  const startedAt = new Map<string, number>();
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      log(event.assistantMessageEvent.delta);
    } else if (event.type === "tool_execution_start") {
      startedAt.set(event.toolCallId, Date.now());
      if (event.toolName === runner) {
        runs += 1;
        if (runs === 1 && steer) {
          // Mid-run steering: delivered after this assistant turn's tool calls finish.
          void session.steer(steer);
        }
        if (runs > MAX_RUNS) {
          void session.abort();
        }
      }
      log(`\n▶ ${event.toolName} ${callDetail(event.toolName, event.args)}\n`);
    } else if (event.type === "tool_execution_end") {
      (toolMs[event.toolName] ??= []).push(
        Date.now() - (startedAt.get(event.toolCallId) ?? Date.now())
      );
      const { images: count, text } = resultParts(event.result?.content ?? []);
      imagesSent += count;
      const result =
        event.toolName === runner ? playtestResult(text) : undefined;
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
    mode,
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
    toolMs,
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
      mode: { default: "run_node", type: "string" },
      model: { default: "claude-haiku-5-5", type: "string" },
      "no-images": { type: "boolean" },
      steer: { type: "string" },
    },
  });
  const summary = await runOnce({
    boxKind: values.box === "e2b" ? "e2b" : "local",
    images: !values["no-images"],
    mode: values.mode === "ops" ? "ops" : "run_node",
    modelId: values.model,
    prompt: positionals.join(" "),
    steer: values.steer,
  });
  const { reply: _reply, ...rest } = summary;
  console.log(JSON.stringify(rest, null, 2));
}
