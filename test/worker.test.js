import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { parseGame, GAME_CSP } from '../src/worker.js';

const generated = { title: '星星小游戏', description: '点击星星得分', html: '<!doctype html><html><body><button>星星</button><script>document.querySelector("button").onclick=e=>e.target.textContent="1"</script></body></html>' };
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_games.sql', import.meta.url), 'utf8'));
  const env = { AI_MODEL: '@cf/moonshotai/kimi-k2.5', AI: { run: async () => ({ choices: [{ message: { content: JSON.stringify(generated) } }] }) }, DB: { prepare(sql) { return { bind(...values) { const statement = db.prepare(sql); return { first: async () => statement.get(...values) || null, all: async () => ({ results: statement.all(...values) }) } } } } } };
  const owner = crypto.randomUUID();
  const call = (path, { method = 'GET', body, cookie = owner, origin = 'https://hopon.test', ip = '1.2.3.4', contentType = 'application/json' } = {}) => worker.fetch(new Request(`https://hopon.test${path}`, { method, headers: { Cookie: `hopon_session=${cookie}`, Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': contentType }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env);
  return { call, env, db, owner };
}
test('AI JSON boundary rejects invalid and truncated output', () => {
  assert.deepEqual(parseGame('```json\n' + JSON.stringify(generated) + '\n```'), generated);
  for (const output of [undefined, 'no', 'null', '{}', JSON.stringify({ ...generated, title: '' }), JSON.stringify({ ...generated, html: '<html><script>' })]) assert.throws(() => parseGame(output), { status: 502 });
});
test('session, generation, private preview, owned publish, public discovery, sandbox', async () => {
  const { call, db } = setup();
  const session = await call('/api/session', { cookie: '' });
  assert.match(session.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(session.headers.get('set-cookie'), /Secure/);
  const response = await call('/api/games', { method: 'POST', body: { prompt: '点击星星的小游戏' } });
  assert.equal(response.status, 201); const draft = await response.json();
  assert.deepEqual((await (await call('/api/games')).json()).games, []);
  assert.equal((await call(`/api/games/${draft.id}/document`, { cookie: crypto.randomUUID() })).status, 404);
  assert.equal((await call(`/api/games/${draft.id}/publish`, { method: 'POST', cookie: crypto.randomUUID() })).status, 404);
  assert.equal((await call(`/api/games/${draft.id}/publish`, { method: 'POST' })).status, 200);
  assert.equal((await call(`/api/games/${draft.id}/publish`, { method: 'POST' })).status, 200);
  const document = await call(`/api/games/${draft.id}/document`, { cookie: '' });
  assert.equal(document.status, 200); assert.equal(document.headers.get('Content-Security-Policy'), GAME_CSP);
  assert.ok(!GAME_CSP.includes('allow-same-origin')); assert.ok(GAME_CSP.includes("connect-src 'none'"));
  assert.equal(await document.text(), generated.html);
  const list = await (await call('/api/games')).json(); assert.equal(list.games.length, 1); assert.equal(list.games[0].html, undefined); assert.equal(list.games[0].owner, undefined);
  db.close();
});
test('request validation, CSRF and atomic network quota', async () => {
  const { call, db } = setup(); const options = { method: 'POST', body: { prompt: '造一个小游戏' } };
  assert.equal((await call('/api/games', { ...options, origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/api/games', { ...options, cookie: '' })).status, 401);
  assert.equal((await call('/api/games', { ...options, body: 'null' })).status, 400);
  assert.equal((await call('/api/games', { ...options, body: '{' })).status, 400);
  assert.equal((await call('/api/games', { ...options, contentType: 'text/plain' })).status, 415);
  assert.equal((await call('/api/games', { ...options, body: 'x'.repeat(12001) })).status, 413);
  assert.equal((await call('/api/games?before=NaN')).status, 400);
  const attempts = await Promise.all(Array.from({ length: 11 }, () => call('/api/games', { ...options, cookie: crypto.randomUUID() })));
  assert.equal(attempts.filter(r => r.status === 201).length, 10); assert.equal(attempts.filter(r => r.status === 429).length, 1);
  db.close();
});
test('cursor pages have no duplicates; invalid AI never inserts a game', async () => {
  const { call, env, db, owner } = setup();
  for (let i = 0; i < 17; i++) db.prepare('INSERT INTO games(owner,title,description,html,published) VALUES (?,?,?,?,1)').run(owner, 'game '+i, '', generated.html);
  const first = await (await call('/api/games')).json(); const second = await (await call(`/api/games?before=${first.next}`)).json(); const third = await (await call(`/api/games?before=${second.next}`)).json();
  assert.equal(new Set([...first.games, ...second.games, ...third.games].map(g => g.id)).size, 17); assert.equal(third.next, null);
  env.AI.run = async () => ({ choices: [{ message: { content: 'bad json' } }] });
  assert.equal((await call('/api/games', { method: 'POST', body: { prompt: '造一个小游戏' } })).status, 502);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM games').get().n, 17);
  db.close();
});

test('offline mode never invokes AI or consumes quota', async () => {
  const { call, env, db } = setup();
  env.HOPON_OFFLINE = '1';
  env.AI.run = () => { throw new Error('must not call AI'); };
  assert.equal((await call('/api/games', { method: 'POST', body: { prompt: '造一个小游戏' } })).status, 503);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM generation_limits').get().n, 0);
  db.close();
});

test('generation uses Kimi non-thinking mode with a bounded output budget', async () => {
  const { call, env, db } = setup();
  env.AI.run = async (model, input) => {
    assert.equal(model, '@cf/moonshotai/kimi-k2.5');
    assert.deepEqual(input.chat_template_kwargs, { thinking: false });
    assert.equal(input.max_completion_tokens, 6000);
    return { choices: [{ message: { content: JSON.stringify(generated) } }] };
  };
  assert.equal((await call('/api/games', { method: 'POST', body: { prompt: 'A five-second button game' } })).status, 201);
  db.close();
});
