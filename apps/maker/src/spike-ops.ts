// pnpm -F maker spike:ops [--cycles 10] — per-call overhead of pi's tools through E2B operations vs run_node, on
// one sandbox: a no-op bash exec, a 10-line read, a write, an edit (two RPCs), an ls, versus box.run of an empty
// module (write + exec + changed-files read). Needs E2B_API_KEY.
import { parseArgs } from "node:util";

import { E2BBox } from "./box.ts";
import { createE2BTools } from "./ops.ts";

const { values } = parseArgs({
  options: { cycles: { default: "10", type: "string" } },
});
const cycles = Number(values.cycles);

const box = await E2BBox.create();
const tools = createE2BTools(box.cwd, { localRoots: [], sandbox: box.sandbox });
const tool = (name: string) => {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`no tool ${name}`);
  }
  return found;
};
const call = (name: string, args: Record<string, unknown>) =>
  tool(name).execute(
    "spike",
    args,
    undefined,
    undefined,
    // pi passes the session context; these tools only read cwd from it.
    { cwd: box.cwd } as never
  );

const timed = async (label: string, run: () => Promise<unknown>) => {
  const samples: number[] = [];
  for (let index = 0; index < cycles; index += 1) {
    const started = performance.now();
    // oxlint-disable-next-line no-await-in-loop -- sequential by design
    await run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) => Math.round(samples[Math.floor(q * (cycles - 1))]);
  console.log(
    `| ${label} | ${at(0.5)} ms | ${at(0.9)} ms | ${Math.round(samples.at(-1) ?? 0)} ms |`
  );
};

await box.writeFile(
  "ten.txt",
  Array.from({ length: 10 }, () => "x").join("\n")
);
// Warm node once so the cold start lands outside the samples.
await box.run("");

console.log("| call | p50 | p90 | max |\n|---|---|---|---|");
await timed("ops bash `true`", () => call("bash", { command: "true" }));
await timed("ops bash `node -e 0`", () =>
  call("bash", { command: "node -e 0" })
);
await timed("ops read (10 lines)", () => call("read", { path: "ten.txt" }));
await timed("ops write", () =>
  call("write", { content: "hello\n", path: "w.txt" })
);
let counter = 0;
await box.writeFile("counter.txt", "n=0\n");
await timed("ops edit (read + write)", () => {
  counter += 1;
  return call("edit", {
    edits: [{ newText: `n=${counter}`, oldText: `n=${counter - 1}` }],
    path: "counter.txt",
  });
});
await timed("ops ls", () => call("ls", {}));
await timed("run_node empty module", () => box.run(""));
await timed("run_node read+log", () => box.run(`console.log(read("ten.txt"))`));

await box.sandbox.kill();
