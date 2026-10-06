import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import vm from "node:vm";
// The originals live only in the seed migration; test exactly what gets deployed.
const db = new DatabaseSync(":memory:");
for (const f of readdirSync(new URL("../migrations", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
}
const html = (title) =>
  db.prepare("SELECT html FROM games WHERE title = ?").get(title).html;
function game(title) {
  const nodes = new Map();
  const element = () => ({
    addEventListener(type, fn) {
      this[type] = fn;
    },
    append(child) {
      this.children.push(child);
    },
    children: [],
    classList: { add() {}, remove() {} },
    replaceChildren() {
      this.children = [];
    },
    setAttribute() {},
  });
  let now = 0;
  const context = vm.createContext({
    Math,
    clearInterval() {},
    document: {
      addEventListener() {},
      body: element(),
      createElement: element,
      querySelector(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
      },
    },
    performance: { now: () => now },
    setInterval() {},
  });
  vm.runInContext(
    html(title).match(/<script>([\s\S]*?)<\/script>/)[1],
    context
  );
  return {
    run: (code) => vm.runInContext(code, context),
    time: (value) => {
      now = value;
    },
  };
}
test("Toast Panic: early input, successful catch, timeout, and restart", () => {
  const g = game("Toast Panic");
  g.run("act();act()");
  assert.equal(g.run("state"), "done");
  assert.equal(g.run("command.textContent"), "Too early!");
  g.run("act()");
  g.time(g.run("popAt") + 10);
  g.run("act()");
  assert.equal(g.run("command.textContent"), "Nice catch!");
  g.run("act()");
  g.time(g.run("started+popAt+900"));
  g.run("tick()");
  assert.equal(g.run("command.textContent"), "Too slow!");
  g.run("act()");
  assert.equal(g.run("state"), "waiting");
});
test("Odd Duck: three correct choices, wrong choice, timeout, and restart", () => {
  const g = game("Odd Duck");
  g.run("action.click();pick(odd);pick(odd);pick(odd)");
  assert.equal(g.run("command.textContent"), "Spotted!");
  g.run("action.click();pick((odd+1)%6)");
  assert.equal(g.run("command.textContent"), "Oh, duck!");
  g.run("action.click()");
  g.time(6001);
  g.run("pick(odd)");
  assert.equal(g.run("state"), "done");
  g.run("action.click()");
  assert.equal(g.run("score"), 0);
  assert.equal(g.run("state"), "playing");
});

test("originals carry no index labels", () => {
  for (const title of ["Toast Panic", "Odd Duck"]) {
    assert.ok(!html(title).includes("MICRO /"), title);
  }
});
