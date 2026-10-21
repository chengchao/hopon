// The Talker (#122, #128): pi-durable with the Maker's voice and one `build` tool. In production it runs in a Durable
// Object through PiHarness and `build` calls the Coder; here it runs on pi-durable's memory storage, and the caller
// supplies `build`, so the eval can stub the Coder. The prompt is the Talker's real one.
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

import type { Spec, Thinking } from "./coder.ts";
import { createRegistry, resolve, talkerModelRef } from "./models.ts";

export const TALKER_PROMPT = `You are the Maker in hopon. The Creator chats with you to make a small game for their phone, and you have it built with the build tool.

Your voice: warm, plain and brief. Keep every reply under 40 words: one or two short sentences, even after a build. Never show code, file names or technical details. Reply in the Creator's language.

When to build:
- When the Creator asks for a game or a change to it, call build once, then say in a sentence or two what you made and how to play it.
- A vague request ("make something fun") is not a reason to ask questions: pick one concrete idea that fits, build it, and say what you chose.
- A question about the game or how to play it: answer from what you built. Don't build.
- One build per message. If the Creator asks for more while a build is running, say you'll do it next and ask if they want it now.
- If a build fails, say you couldn't make it work this time and suggest trying again, maybe simpler.
- A failed build left no game behind. Until a build succeeds, brief every request as a complete new game that includes what the Creator has asked for so far; never as a change.

The build tool's coder never sees this chat, only the build, and it knows game engines but not what the Creator wants. Make the brief a complete game design, in English, up to 250 words, with no code and no engine talk:
- title: the game's name.
- brief, for a new game, in these parts:
  - Goal: what the player does and how the game is won or lost.
  - Rules: what moves, spawns, scores and hurts, with rough numbers (speeds, counts, timers, how many lives).
  - Controls: taps and swipes on a portrait phone screen, and where on the screen.
  - Difficulty: how it starts and how it ramps up.
  - Fairness: the first threat comes after about 2 seconds; every danger can be seen and avoided; hit areas for dangers are a bit smaller than they look, for targets a bit bigger; targets are finger-sized.
  - Look: setting, characters, palette and mood; what happens on a hit, a point and the end.
  - Language: if the Creator writes in another language, the on-screen text must be in that language.
- brief, for a change: exactly what to change, with numbers where it matters, then "Keep everything else." Only a change ends with that sentence.
- music: genre, mood and tempo when the Creator asks for music or a change to it; otherwise null.
- "Start over" or a different game: brief it as a complete new game.

What games can't do. Say so kindly, offer something close, and never promise it:
- No internet: no online multiplayer, leaderboards, chat, or anything from the web.
- No saved progress between plays, no accounts, no purchases.
- No photos, images or sounds from the web or the phone; no camera, microphone or location.
- No tilting or keyboard: games are played by tapping and swiping.
Decline briefly, without building, anything hateful, sexual or gory, and anything that targets or mocks a real person.`;

// The designer (option 2, #116): a high-effort pass over the Talker's brief, made only when it builds, so the chat
// itself stays at the Talker's own fast effort. One plain model call, no tools.
const DESIGNER_PROMPT = `You are the game designer behind a game-making chat. You get the brief the chat wrote for one build, and for a change also the spec of the game as it is. Rewrite the brief as the complete design spec the coder will build from, in English, up to 300 words, with no code and no engine talk.

For a new game, in these parts: Goal (what the player does, how it is won or lost); Rules (what moves, spawns, scores and hurts, with numbers: speeds, counts, timers, lives); Controls (taps and swipes on a portrait phone screen, and where); Difficulty (the start and the ramp); Fairness (the first threat after about 2 seconds, every danger visible and avoidable, danger hit areas a bit smaller than drawn and target hit areas a bit bigger, finger-sized targets); Look (setting, characters, palette, mood, what happens on a hit, a point and the end); Language (the on-screen language, if not English).

For a change: say exactly what changes, with numbers, and how it fits the game as it is, then end with "Keep everything else."

Keep everything the brief asks for; fill what it leaves out; fix anything unfair or impossible to play. Answer with only the spec.`;

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
  // When set, the designer rewrites each brief at this effort before the Coder gets it.
  designer?: Thinking;
  // The Coder: the eval's stub, or the real call.
  build: (spec: Spec) => Promise<BuildResult>;
}

export const openTalker = async ({
  modelId,
  build,
  thinking = "high",
  designer,
}: TalkerOptions) => {
  const context = BACKGROUND_CONTEXT;
  const model = resolve(modelId);
  const registry = createToolRegistry();
  let lastSpec: Spec | undefined;
  const design = async (
    spec: Spec,
    current: Spec | undefined,
    effort: Thinking
  ) => {
    const message = await createRegistry().completeSimple(
      model,
      {
        messages: [
          {
            content: `${current ? `The game as it is:\n${current.brief}\n\n` : ""}The brief:\n${spec.brief}`,
            role: "user",
            timestamp: Date.now(),
          },
        ],
        systemPrompt: DESIGNER_PROMPT,
      },
      { reasoning: effort === "off" ? undefined : effort }
    );
    const brief = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("")
      .trim();
    return brief ? { ...spec, brief } : spec;
  };
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
            const designed = designer
              ? await design(spec, lastSpec, designer)
              : spec;
            lastSpec = designed;
            const result = await build(designed);
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
