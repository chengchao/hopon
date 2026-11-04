#!/usr/bin/env node
// Prints a Clerk-shaped session JWT for <user>, signed with the run's key (launch.sh), valid for an hour.
// <handle> becomes the `username` claim, the Handle; leave it out for an account that hasn't picked one.
// Usage: node .agents/skills/verify-hopon/scripts/token.mjs <run-dir> <user_id> [handle]
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const [run, sub, username = null] = process.argv.slice(2);
if (!run || !sub) {
  console.error("usage: token.mjs <run-dir> <user_id> [handle]");
  process.exit(2);
}
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const body = `${b64({ alg: "RS256", kid: "ins_verify", typ: "JWT" })}.${b64({ exp: now + 3600, iat: now, nbf: now, sub, username })}`;
const signature = createSign("RSA-SHA256")
  .update(body)
  .sign(readFileSync(`${run}/state/jwt.key`))
  .toString("base64url");
console.log(`${body}.${signature}`);
