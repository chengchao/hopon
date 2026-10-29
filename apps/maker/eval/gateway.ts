// The Coder's dollars and output tokens per e2e build, from the AI Gateway's analytics (#179). A Preview doesn't report
// them, but the Worker tags each of the Coder's model calls with its job, `<draftId>-<build call id>`, which e2e records
// as `gatewayJob`. The gateway logs no thinking count for these calls; output tokens stand in, being mostly thinking.
// GraphQL takes wrangler's OAuth token; the gateway's REST logs API refuses it and the eval's key alike.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { CoderRecord } from "./coder.ts";

const MINUTE = 60_000;
const WORKER = path.join(import.meta.dirname, "../../worker");

interface Row {
  count: number;
  sum: { cost: number };
  dimensions: { agent: string; job: string; tokensOut: number };
}

const coderCalls = async (from: Date, to: Date) => {
  const { stdout } = await promisify(execFile)(
    "npx",
    ["wrangler", "auth", "token"],
    { cwd: WORKER }
  );
  const token = stdout.trim().split("\n").at(-1);
  const query = `{ viewer { accounts(filter: {accountTag: "${process.env.CLOUDFLARE_ACCOUNT_ID}"}) { aiGatewayRequestsAdaptiveGroups(limit: 10000, filter: {datetime_geq: "${from.toISOString()}", datetime_leq: "${to.toISOString()}"}) { count sum { cost } dimensions { agent: metadataValue(key: "agent") job: metadataValue(key: "jobId") tokensOut } } } } }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    body: JSON.stringify({ query }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const json = (await response.json()) as {
    data?: {
      viewer: { accounts: { aiGatewayRequestsAdaptiveGroups: Row[] }[] };
    };
    errors?: { message: string }[];
  };
  if (!json.data) {
    throw new Error(json.errors?.map((error) => error.message).join("; "));
  }
  return json.data.viewer.accounts[0].aiGatewayRequestsAdaptiveGroups.filter(
    (row) => row.dimensions.agent === "coder"
  );
};

// Fills `cost` and `outputTokens` on root's e2e builds that still hold null. Analytics trail by a minute or so, so a
// build the gateway hasn't logged yet keeps null, and running the same e2e again (every chat already done) retries.
export const fillFromGateway = async (root: string) => {
  const pending = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === "result.json")
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return {
        file,
        record: JSON.parse(readFileSync(file, "utf-8")) as CoderRecord,
      };
    })
    .filter(
      ({ record }) =>
        record.agent === "coder" && record.gatewayJob && record.cost === null
    );
  if (pending.length === 0) {
    return;
  }
  // A build's calls all come in the minutes before its result.json is written, within the 150 s music deadline.
  const written = pending.map(({ file }) => statSync(file).mtimeMs);
  const calls = Map.groupBy(
    await coderCalls(
      new Date(Math.min(...written) - 5 * MINUTE),
      new Date(Math.max(...written) + MINUTE)
    ),
    (row) => row.dimensions.job
  );
  let filled = 0;
  for (const { file, record } of pending) {
    const rows = calls.get(record.gatewayJob ?? "");
    if (rows) {
      record.cost = rows.reduce((sum, row) => sum + row.sum.cost, 0);
      record.outputTokens = rows.reduce(
        (sum, row) => sum + row.dimensions.tokensOut * row.count,
        0
      );
      writeFileSync(file, JSON.stringify(record, null, 2));
      filled += 1;
    }
  }
  console.log(
    `gateway: dollars and output tokens for ${filled} of ${pending.length} builds`
  );
};
