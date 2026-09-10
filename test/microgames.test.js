import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
function game(file) {
  const nodes = new Map();
  const element = () => ({ children: [], classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener(type, fn) { this[type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
  let now = 0;
  const context = vm.createContext({ document: { querySelector(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, createElement: element, body: element(), addEventListener() {} }, performance: { now: () => now }, setInterval() {}, clearInterval() {}, Math });
  vm.runInContext(readFileSync(new URL(`../public/demos/${file}.html`, import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { run: code => vm.runInContext(code, context), time: value => { now = value; } };
}
test('Toast Panic: early input, successful catch, timeout, and restart', () => {
  const g = game('orbit');
  g.run('act();act()'); assert.equal(g.run('state'), 'done'); assert.equal(g.run('command.textContent'), 'Too early!');
  g.run('act()'); g.time(g.run('popAt') + 10); g.run('act()'); assert.equal(g.run('command.textContent'), 'Nice catch!');
  g.run('act()'); g.time(g.run('started+popAt+900')); g.run('tick()'); assert.equal(g.run('command.textContent'), 'Too slow!');
  g.run('act()'); assert.equal(g.run('state'), 'waiting');
});
test('Odd Duck: three correct choices, wrong choice, timeout, and restart', () => {
  const g = game('garden');
  g.run('action.click();pick(odd);pick(odd);pick(odd)'); assert.equal(g.run('command.textContent'), 'Spotted!');
  g.run('action.click();pick((odd+1)%6)'); assert.equal(g.run('command.textContent'), 'Oh, duck!');
  g.run('action.click()'); g.time(6001); g.run('pick(odd)'); assert.equal(g.run('state'), 'done');
  g.run('action.click()'); assert.equal(g.run('score'), 0); assert.equal(g.run('state'), 'playing');
});
