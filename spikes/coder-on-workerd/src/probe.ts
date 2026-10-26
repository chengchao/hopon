/* oxlint-disable complexity, no-await-in-loop, no-empty-function, no-promise-executor-return, no-void, promise/avoid-new, promise/prefer-await-to-callbacks, promise/prefer-await-to-then, promise/prefer-catch -- throwaway spike */
// openSession from apps/maker/src/coder.ts, rebuilt to see each tool's own result on workerd.
import { InMemoryCredentialStore, Type } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Sandbox } from "e2b";

import { CANDIDATES } from "../../../apps/maker/src/models.ts";
import { createE2BTools } from "../../../apps/maker/src/ops.ts";

export const probe = async (sandbox: Sandbox) => {
  const model = CANDIDATES["claude-haiku-5-5"]();
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
  });
  await modelRuntime.setRuntimeApiKey(model.provider, "placeholder");
  const home = "/tmp/maker/agent-home";
  const resourceLoader = new DefaultResourceLoader({
    agentDir: `${home}/.pi`,
    cwd: home,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    systemPrompt: "You test tools. Do exactly what you are told.",
  });
  await resourceLoader.reload();
  const ping = defineTool({
    description: "Says pong",
    execute: () =>
      Promise.resolve({
        content: [{ text: "pong", type: "text" }],
        details: undefined,
      }),
    label: "Ping",
    name: "ping",
    parameters: Type.Object({}),
  });
  const { session } = await createAgentSession({
    agentDir: `${home}/.pi`,
    customTools: [
      ...createE2BTools("/workspace", { localRoots: [home], sandbox }),
      ping,
    ],
    cwd: "/workspace",
    model,
    modelRuntime,
    noTools: "builtin",
    resourceLoader,
    sessionManager: SessionManager.inMemory("/workspace"),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
    }),
    thinkingLevel: "low",
  });
  const ends: unknown[] = [];
  session.subscribe((event) => {
    if (event.type === "tool_execution_end") {
      ends.push({
        isError: event.isError,
        result: JSON.stringify(event.result).slice(0, 300),
        tool: event.toolName,
      });
    }
  });
  await session.prompt(
    "One tool call per turn, in this order: ping; bash `echo hi`; write /workspace/x.txt with `hello`; read /workspace/x.txt; bash `ffmpeg -loglevel error -f lavfi -i testsrc=s=360x640 -frames:v 1 /workspace/big.png`; read /workspace/big.png. Then say what the image shows."
  );
  session.dispose();
  return ends;
};

// pi's read tool on a PNG with autoResizeImages off (ops.ts leaves it on), straight to execute: no model.
export const readPng = async (sandbox: Sandbox) => {
  const { createReadToolDefinition } =
    await import("@earendil-works/pi-coding-agent");
  const tool = createReadToolDefinition("/workspace", {
    autoResizeImages: false,
    operations: {
      access: async () => {},
      detectImageMimeType: () => Promise.resolve("image/png"),
      readFile: async (file: string) =>
        Buffer.from(
          (await sandbox.files.read(file, { format: "bytes" })) as Uint8Array
        ),
    },
  });
  await sandbox.commands.run(
    "ffmpeg -loglevel error -y -f lavfi -i testsrc=s=360x640 -frames:v 1 /workspace/small.png"
  );
  const result = await tool.execute(
    "t1",
    { path: "/workspace/small.png" },
    undefined,
    undefined,
    undefined as never
  );
  return JSON.stringify(result).slice(0, 300);
};
