// The Maker's session: pi-coding-agent with its built-in tools off, an in-memory transcript, and two custom tools.
// run_node sends model-written code to a Box; load_skill returns a skill from skills/ (pi only lists skills when a
// read or bash tool is active, so without one the model needs its own way to load them).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { InMemoryCredentialStore, Type } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  parseSessionEntries,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { Box } from "./box.ts";

export const SKILLS_DIR = path.join(import.meta.dirname, "..", "skills");
export const MAX_RUNS = 12;
const OUTPUT_LIMIT = 6000;

const SYSTEM_PROMPT = `You are the Maker in hopon, an app where people make small games for their phones by chatting. You turn the Creator's idea into a playable game and change it when they ask.

You work through the run_node tool: it runs a JavaScript ES module (Node, top-level await) in the game's workspace, with these globals: read(path), write(path, text), patch(path, oldText, newText), await playtest(), await minify(). console.log whatever you need to see. You cannot reach the network.

How to work:
1. Call load_skill with "littlejs-api" before writing any game code.
2. Write the whole game to game.ts and run \`await playtest()\` in the same run_node call.
3. Read the result and look at the screenshot. Fix every error and anything that looks wrong (patch for small changes), then playtest again.
4. When playtest is ok and the screenshot shows the game, stop. Tell the Creator in one or two short sentences what you made and how to play. Never show code to the Creator.

Use at most ${MAX_RUNS} run_node calls per message.`;

// Every model goes through one Cloudflare AI Gateway: Claude on Unified Billing, Kimi on Workers AI (the same
// @cf/moonshotai/kimi-k2.5 the API's Make uses today). One token, plus CLOUDFLARE_ACCOUNT_ID and
// CLOUDFLARE_GATEWAY_ID, which pi-ai reads from the env.

// K2.5 left pi-ai's catalog when K2.6 arrived; Workers AI still serves it. Prices: Workers AI pricing page.
const KIMI_K2_5 = {
  ...getBuiltinModel(
    "cloudflare-ai-gateway",
    "workers-ai/@cf/moonshotai/kimi-k2.6"
  ),
  cost: { cacheRead: 0.1, cacheWrite: 0, input: 0.6, output: 3 },
  id: "workers-ai/@cf/moonshotai/kimi-k2.5",
  name: "Kimi K2.5",
} as Model<Api>;

export const MODELS: Record<string, Model<Api>> = {
  // The gateway's Unified Billing covers Sonnet 5.5 and Haiku 4.5 but not Haiku 5.5 yet: that call reaches
  // Anthropic without a key (401 "x-api-key header is required"). Haiku 4.5 stands in until it does.
  "claude-haiku-4-5": getBuiltinModel(
    "cloudflare-ai-gateway",
    "claude-haiku-4-5"
  ),
  "claude-haiku-5-5": getBuiltinModel(
    "cloudflare-ai-gateway",
    "claude-haiku-5-5"
  ),
  "claude-sonnet-5-5": getBuiltinModel(
    "cloudflare-ai-gateway",
    "claude-sonnet-5-5"
  ),
  "kimi-k2.5": KIMI_K2_5,
};

const GATEWAY_ENV = [
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
];

const clip = (text: string) =>
  text.length > OUTPUT_LIMIT
    ? `${text.slice(0, OUTPUT_LIMIT)}\n… ${text.length - OUTPUT_LIMIT} more chars`
    : text;

const stripFrontmatter = (text: string) =>
  text.replace(/^---\n[\s\S]*?\n---\n/u, "");

export interface MakerOptions {
  box: Box;
  modelId: string;
  // A transcript from exportJsonl() to continue.
  jsonl?: string;
  // Attach playtest.png to run_node results (off to test models without image input).
  images?: boolean;
}

export const createMaker = async ({
  box,
  modelId,
  jsonl,
  images = true,
}: MakerOptions) => {
  const model = MODELS[modelId];
  if (!model) {
    throw new Error(
      `unknown model ${modelId}; one of ${Object.keys(MODELS).join(", ")}`
    );
  }
  const missing = GATEWAY_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} missing from apps/maker/.env`);
  }
  // An empty cwd and agentDir: nothing to discover, and anything pi writes would show up here.
  const cwd = mkdtempSync(path.join(tmpdir(), "hopon-maker-"));
  const agentDir = path.join(cwd, ".pi");
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
  });
  await modelRuntime.setRuntimeApiKey(
    model.provider,
    process.env.CLOUDFLARE_API_KEY ?? ""
  );
  const resourceLoader = new DefaultResourceLoader({
    additionalSkillPaths: [SKILLS_DIR],
    agentDir,
    cwd,
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    systemPrompt: SYSTEM_PROMPT,
  });
  await resourceLoader.reload();
  const { skills } = resourceLoader.getSkills();

  const loadSkill = defineTool({
    description: `Load a skill's instructions. Skills: ${skills.map((skill) => `${skill.name} (${skill.description})`).join("; ")}`,
    execute: (_id, { name }) => {
      const skill = skills.find((candidate) => candidate.name === name);
      if (!skill) {
        throw new Error(`no skill named ${name}`);
      }
      return Promise.resolve({
        content: [
          {
            text: stripFrontmatter(readFileSync(skill.filePath, "utf-8")),
            type: "text",
          },
        ],
        details: undefined,
      });
    },
    label: "Load skill",
    name: "load_skill",
    parameters: Type.Object({ name: Type.String() }),
  });

  const runNode = defineTool({
    description:
      "Run a JavaScript ES module in the game's workspace. Globals: read, write, patch, playtest, minify. Returns exit code, stdout and stderr; after playtest(), the screenshot.",
    execute: async (_id, { code }) => {
      const result = await box.run(code);
      const text = `exit ${result.exitCode}\n${clip(result.stdout)}${result.stderr ? `\nstderr:\n${clip(result.stderr)}` : ""}`;
      const screenshot =
        images && result.files.includes("playtest.png")
          ? [
              {
                data: Buffer.from(await box.readFile("playtest.png")).toString(
                  "base64"
                ),
                mimeType: "image/png",
                type: "image" as const,
              },
            ]
          : [];
      return {
        content: [{ text, type: "text" as const }, ...screenshot],
        details: { exitCode: result.exitCode, files: result.files },
      };
    },
    label: "Run node",
    name: "run_node",
    parameters: Type.Object({
      code: Type.String({ description: "An ES module to run" }),
    }),
  });

  const sessionManager = jsonl
    ? SessionManager.inMemory(cwd, undefined, parseSessionEntries(jsonl))
    : SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    agentDir,
    customTools: [runNode, loadSkill],
    cwd,
    model,
    modelRuntime,
    noTools: "builtin",
    resourceLoader,
    sessionManager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
    }),
    thinkingLevel: "off",
  });
  return { cwd, session };
};

export type MakerSession = Awaited<ReturnType<typeof createMaker>>["session"];

// The transcript as JSONL (header line, then entries), like a session file.
export const exportJsonl = (session: MakerSession) => {
  const manager = session.sessionManager;
  return [manager.getHeader(), ...manager.getEntries()]
    .map((entry) => JSON.stringify(entry))
    .join("\n");
};
