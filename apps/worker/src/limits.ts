// A message's limits (ADR 0009): steps, builds and a loose ceiling on its time, checked before each tool call of its
// run. Past a limit tools are refused, but a run that published nothing may still call `build` once, so a finished
// game reaches the Creator whichever limit stopped the work around it.
import { MAX_BUILDS, MAX_STEPS, RUN_CEILING_MS } from "../../maker/src/job.ts";

export interface RunCounts {
  startedAt: number;
  // Tool calls but `build` and reads of the skill, and `build` calls.
  steps: number;
  builds: number;
  // The Revision the run last published.
  published?: number;
  // The one `build` a run may call past a limit was called.
  finalBuild?: true;
}

export type Limit = "steps" | "builds" | "ceiling";
// What the refusal tells the agent to do: reply about the Revision it published, publish a finished game with its
// one last `build`, or reply that nothing of this message was published.
export type After = "kept" | "last-build" | "give-up";

export const checkLimits = <S extends RunCounts>(
  state: S,
  building: boolean,
  now: number,
  // A read of the skill or one of its references: no step, so a skill split into more files costs no more of them.
  reading = false
): { next: S; refused?: { limit: Limit; after: After } } => {
  const next = {
    ...state,
    builds: state.builds + (building ? 1 : 0),
    steps: state.steps + (building || reading ? 0 : 1),
  };
  let limit: Limit | undefined;
  if (next.builds > MAX_BUILDS) {
    limit = "builds";
  } else if (next.steps > MAX_STEPS) {
    limit = "steps";
  } else if (now - state.startedAt > RUN_CEILING_MS) {
    limit = "ceiling";
  }
  if (!limit) {
    return { next };
  }
  const lastBuild =
    limit !== "builds" &&
    state.published === undefined &&
    state.finalBuild === undefined;
  if (building && lastBuild) {
    return { next: { ...next, finalBuild: true } };
  }
  let after: After = "give-up";
  if (state.published !== undefined) {
    after = "kept";
  } else if (lastBuild) {
    after = "last-build";
  }
  return { next, refused: { after, limit } };
};
