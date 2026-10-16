// pnpm -F maker spike:sdk [--model <id>]
// Answers the pi-coding-agent questions: which tools reach the model, whether anything is written under cwd or
// ~/.pi, whether an exported JSONL transcript continues in a new process, and how steer() / followUp() land.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { LocalBox } from "./box.ts";
import { createMaker, exportJsonl } from "./maker.ts";
import type { MakerSession } from "./maker.ts";

const { values } = parseArgs({
  options: {
    model: { default: "claude-haiku-5-5", type: "string" },
    resume: { type: "string" },
  },
});
const modelId = values.model;

// Every request body the provider SDK sends, to see the tool list the model actually gets.
const requests: { tools: string[]; system: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof init?.body === "string" && init.body.includes('"messages"')) {
    const body = JSON.parse(init.body) as {
      tools?: { name?: string; function?: { name: string } }[];
      system?: string | { text: string }[];
      messages: { role: string; content: unknown }[];
    };
    requests.push({
      system:
        typeof body.system === "string"
          ? body.system
          : (body.system ?? []).map((part) => part.text).join("\n"),
      tools: (body.tools ?? []).map(
        (tool) => tool.name ?? tool.function?.name ?? "?"
      ),
    });
  }
  return realFetch(input, init);
};

const lastText = (session: MakerSession) => {
  const message = session.messages.findLast(
    (candidate) => candidate.role === "assistant"
  );
  return message?.role === "assistant"
    ? message.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
    : "";
};

const listFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name))
    : [];

const out = path.join(import.meta.dirname, "..", "out", "sdk");
mkdirSync(out, { recursive: true });
const box = await LocalBox.create();

if (values.resume) {
  // Second process: continue the exported transcript.
  const { session } = await createMaker({
    box,
    jsonl: readFileSync(values.resume, "utf-8"),
    modelId,
  });
  console.log("restored messages:", session.messages.length);
  await session.prompt(
    "What was the secret word I gave you? Answer with just the word."
  );
  console.log("resumed answer:", JSON.stringify(lastText(session)));
  process.exit(0);
}

const piHome = path.join(homedir(), ".pi");
const piHomeBefore = existsSync(piHome) ? statSync(piHome).mtimeMs : undefined;
const { session, cwd } = await createMaker({ box, modelId });
console.log("active tools:", session.getActiveToolNames());

await session.prompt(
  "The secret word is 'pumpkin'. Run console.log(6 * 7) with run_node, then reply with the number."
);
console.log("tools sent to the model:", [
  ...new Set(requests.flatMap((request) => request.tools)),
]);
console.log(
  "system prompt mentions read/bash/edit/write tools:",
  /\b(?:read|bash|edit|write) tool\b/u.test(requests[0]?.system ?? "")
);
console.log(
  "system prompt sections:",
  [...(requests[0]?.system ?? "").matchAll(/^<(?<section>\w+)>$/gmu)].map(
    (match) => match.groups?.section
  )
);
console.log("first answer:", JSON.stringify(lastText(session)));

// steer() during a tool call lands after that turn's tool results; followUp() waits for the run to finish.
const order: string[] = [];
session.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    order.push(`tool:${event.toolName}`);
    if (order.length === 1) {
      void session.steer("Steer: also tell me the word STEERED.");
      void session.followUp("Follow-up: now say FOLLOWED.");
    }
  } else if (
    event.type === "message_end" &&
    (event.message.role === "user" || event.message.role === "assistant")
  ) {
    const text =
      event.message.role === "assistant"
        ? lastText(session)
        : JSON.stringify(event.message.content).slice(0, 60);
    order.push(`${event.message.role}:${text.slice(0, 80)}`);
  }
});
await session.prompt(
  "Run `await new Promise(r => setTimeout(r, 1500)); console.log('slow done')` with run_node, then say DONE."
);
console.log(`steer/followUp order:\n  ${order.join("\n  ")}`);

console.log("files under cwd:", listFiles(cwd));
console.log(
  "~/.pi touched:",
  existsSync(piHome) ? statSync(piHome).mtimeMs !== piHomeBefore : "absent"
);

const file = path.join(out, "transcript.jsonl");
writeFileSync(file, exportJsonl(session));
console.log("exported", session.messages.length, "messages to", file);
session.dispose();

const child = spawnSync(
  process.execPath,
  [import.meta.filename, "--model", modelId, "--resume", file],
  {
    encoding: "utf-8",
    env: process.env,
  }
);
console.log(`--- new process ---\n${child.stdout}${child.stderr}`);
