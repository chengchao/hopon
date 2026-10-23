// The Talker (#122, #128): pi-durable with the Maker's voice and one `build` tool. In production it runs in a Durable
// Object through PiHarness and `build` calls the Coder; here it runs on pi-durable's memory storage, and the caller
// supplies `build`, so the eval can stub the Coder. The prompt is the Talker's real one, from the API Worker.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import {
  createRegistry as createToolRegistry,
  defineExtension,
  defineTool,
  Harness,
  MemoryStorage,
  section,
  watchEvents,
} from "@earendil-works/pi-durable";
import type { AgentEvent } from "@earendil-works/pi-durable";

import { TALKER_PROMPT } from "../../api/src/talker-prompt.ts";
import type { Spec, Thinking } from "./coder.ts";
import { createRegistry, resolve, talkerModelRef } from "./models.ts";

const BuildParameters = Type.Object({
  brief: Type.String(),
  music: Type.Union([Type.String(), Type.Null()]),
  title: Type.String(),
});

export type BuildResult =
  | { ok: true; summary: string }
  | { ok: false; reason: string };

export interface TalkerOptions {
  modelId: string;
  // #116 picked high: its design specs build best (89–94% against ~80% at low), at ~2.6 s to first token.
  thinking?: Thinking;
  // The Coder: the eval's stub, or the real call.
  build: (spec: Spec) => Promise<BuildResult>;
}

export const openTalker = async ({
  modelId,
  build,
  thinking = "high",
}: TalkerOptions) => {
  const context = BACKGROUND_CONTEXT;
  const model = resolve(modelId);
  const registry = createToolRegistry();
  // One build per turn (#122). The eval opens a turn with `submit`; a steer joins the running turn.
  let buildsThisTurn = 0;
  registry.install(
    defineExtension({
      name: "talker",
      sections: [section("preamble", () => TALKER_PROMPT, { tag: false })],
      tools: [
        defineTool({
          description:
            "Have the coder build a new game or change this one. Takes about a minute. Returns the coder's report.",
          execute: async (spec) => {
            buildsThisTurn += 1;
            if (buildsThisTurn > 1) {
              throw new Error(
                "Only one build per message. Tell the Creator you'll do it next."
              );
            }
            const result = await build(spec);
            if (!result.ok) {
              throw new Error(`The build failed: ${result.reason}`);
            }
            return { output: [{ text: result.summary, type: "text" }] };
          },
          name: "build",
          parameters: BuildParameters,
        }),
      ],
    })
  );
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createRegistry(), registry },
    context
  );
  const root = await harness.root(context, {
    agent: {
      model: talkerModelRef(model),
      thinkingLevel: thinking,
    },
  });
  const stream = await watchEvents(harness, root.id, context);
  const listeners = new Set<(event: AgentEvent) => void>();
  stream.start((events) => {
    for (const event of events) {
      for (const listener of listeners) {
        listener(event);
      }
    }
    return Promise.resolve();
  });

  return {
    close: async () => {
      await stream.stop();
      await harness.close(context);
    },
    harness,
    listen: (listener: (event: AgentEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    root,
    // Steers join the running turn and reach the model after the current tool round (after `build` returns).
    steer: (text: string) =>
      root.submit({ content: text, type: "input", whenBusy: "steer" }, context),
    turn: async (text: string) => {
      buildsThisTurn = 0;
      const submission = await root.submit(
        { content: text, type: "input" },
        context
      );
      return await submission.wait(context);
    },
    usage: () => harness.usage(context),
  };
};

export type Talker = Awaited<ReturnType<typeof openTalker>>;
