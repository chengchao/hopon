import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// @cloudflare/containers registers a class's outbound handlers in static setters on Container. A class field
// (`static outboundHandlers = {…}`) defines the subclass's own property instead, so the setter never runs and
// `setOutboundByHost` throws "not found in outboundHandlers" at runtime; only a real container shows it. Assign them
// in a static block: `static { this.outboundHandlers = {…}; }`.
// ponytail: a regex over the source, like sql-subqueries.test.js; parse with oxc if it ever misreads one.
export const outboundFields = (source) =>
  [
    ...source.matchAll(
      /\bstatic\s+(?<name>outbound(?:Handlers|ByHost|Proxies|Proxy)?)\s*[:=]/gu
    ),
  ].map((m) => m.groups.name);

test("Container classes assign their outbound handlers in a static block", () => {
  const src = new URL("../src/", import.meta.url);
  for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    assert.deepEqual(
      outboundFields(readFileSync(new URL(file, src), "utf-8")),
      [],
      `${file}: assign it in \`static { this.outboundHandlers = {…}; }\``
    );
  }
});

test("the check flags the class field that left the Coder's models handler unregistered", () => {
  assert.deepEqual(
    outboundFields(
      "class Coder extends Container {\n  static outboundHandlers = {\n"
    ),
    ["outboundHandlers"]
  );
  assert.deepEqual(
    outboundFields("  static {\n    this.outboundHandlers = {\n"),
    []
  );
});
