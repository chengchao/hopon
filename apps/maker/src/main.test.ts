// The Container's process exits on SIGTERM (#187). As PID 1, node ignores a signal it doesn't handle, so without this
// an idle Coder keeps its instance and, past max_instances, other Drafts' builds get none.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const listening = async () => {
  for (let tries = 0; tries < 100; tries += 1) {
    // oxlint-disable-next-line no-await-in-loop -- polls until the server answers
    const answered = await fetch("http://localhost:8080/").then(
      () => true,
      () => false
    );
    if (answered) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- polls until the server answers
    await sleep(100);
  }
  throw new Error("the Coder's server never answered on :8080");
};

test("the Coder's server exits 0 on SIGTERM", async () => {
  const child = spawn(
    process.execPath,
    [path.join(import.meta.dirname, "main.ts")],
    {
      env: {
        ...process.env,
        DRAFT_ID: "draft-1",
        MAKER_CODER_EFFORT: "low",
        MAKER_CODER_MODEL: "claude-haiku-5-5",
      },
      stdio: "ignore",
    }
  );
  try {
    await listening();
    child.kill("SIGTERM");
    const [code] = await once(child, "exit", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(code, 0);
  } finally {
    child.kill("SIGKILL");
  }
});
