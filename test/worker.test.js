import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import worker from '../worker/index.ts';
import { parseGame, GAME_CSP } from '../worker/game.ts';

// Throwaway RS256 key standing in for the Clerk instance; tokens below are really signed and verified.
const keys = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const CLERK_JWT_KEY = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64')}\n-----END PUBLIC KEY-----`;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function sign(sub, { exp = 60, key = keys.privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'ins_test' })}.${b64({ sub, iat: now, nbf: now, exp: now + exp })}`;
  return `${body}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body))).toString('base64url')}`;
}
const generated = {
  title: '星星小游戏',
  description: '点击星星得分',
  html: '<!doctype html><html><body><button>星星</button><script>document.querySelector("button").onclick=e=>e.target.textContent="1"</script></body></html>',
};
const ORIGINALS = 2; // seeded by migrations/*_originals.sql
const migrations = readdirSync(new URL('../migrations', import.meta.url))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .flatMap((f) => unstable_splitSqlQuery(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')));
// A fresh, in-memory local D1 (workerd) per test, migrated like `wrangler d1 migrations apply`; only AI is faked.
async function setup(t) {
  const proxy = await getPlatformProxy({ persist: false, remoteBindings: false, envFiles: [] });
  t.after(() => proxy.dispose());
  const DB = proxy.env.DB;
  await DB.batch(migrations.map((sql) => DB.prepare(sql)));
  const env = {
    CLERK_JWT_KEY,
    DB,
    AI_MODEL: '@cf/moonshotai/kimi-k2.5',
    AI: { run: async () => ({ choices: [{ message: { content: JSON.stringify(generated) } }] }) },
  };
  const count = async (table) => (await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  const owner = 'user_owner';
  const call = async (path, { method = 'GET', body, user = owner, token, contentType = 'application/json' } = {}) =>
    worker.fetch(
      new Request(`https://hopon.test${path}`, {
        method,
        headers: {
          'Content-Type': contentType,
          ...(user || token ? { Authorization: `Bearer ${token ?? (await sign(user))}` } : {}),
        },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      }),
      env,
    );
  return { call, env, count, owner };
}
test('AI JSON boundary rejects invalid and truncated output', () => {
  assert.deepEqual(parseGame('```json\n' + JSON.stringify(generated) + '\n```'), generated);
  for (const output of [
    undefined,
    'no',
    'null',
    '{}',
    JSON.stringify({ ...generated, title: '' }),
    JSON.stringify({ ...generated, html: '<html><script>' }),
  ])
    assert.throws(() => parseGame(output), { status: 502 });
});
test('generation, private preview, latest draft, owned publish, public discovery, sandbox', async (t) => {
  const { call } = await setup(t);
  assert.deepEqual(
    (await (await call('/api/games')).json()).games.map((g) => g.title),
    ['Odd Duck', 'Toast Panic'],
  );
  assert.equal((await call('/api/drafts/latest', { user: '' })).status, 401);
  assert.deepEqual(await (await call('/api/drafts/latest')).json(), { draft: null });
  const response = await call('/api/games', { method: 'POST', body: { prompt: '点击星星的小游戏' } });
  assert.equal(response.status, 201);
  const draft = await response.json();
  assert.equal((await (await call('/api/games')).json()).games.length, ORIGINALS);
  assert.deepEqual((await (await call('/api/drafts/latest')).json()).draft, draft);
  assert.deepEqual(await (await call('/api/drafts/latest', { user: 'user_other' })).json(), { draft: null });
  assert.equal((await call(`/api/games/${draft.id}/document`, { user: 'user_other' })).status, 404);
  assert.equal((await call(`/api/games/${draft.id}/document`, { user: '' })).status, 404);
  assert.equal((await call(`/api/games/${draft.id}/document`)).status, 200);
  assert.equal((await call(`/api/games/${draft.id}/publish`, { method: 'POST', user: 'user_other' })).status, 404);
  assert.equal((await call(`/api/games/${draft.id}/publish`, { method: 'POST' })).status, 200);
  assert.equal((await call(`/api/games/${draft.id}/publish`, { method: 'POST' })).status, 200);
  const document = await call(`/api/games/${draft.id}/document`, { user: '' });
  assert.equal(document.status, 200);
  assert.equal(document.headers.get('Content-Security-Policy'), GAME_CSP);
  assert.ok(!GAME_CSP.includes('allow-same-origin'));
  assert.ok(GAME_CSP.includes("connect-src 'none'"));
  assert.equal(await document.text(), generated.html);
  assert.deepEqual(await (await call('/api/drafts/latest')).json(), { draft: null });
  const list = await (await call('/api/games')).json();
  assert.equal(list.games.length, ORIGINALS + 1);
  assert.equal(list.games[0].id, draft.id);
  assert.equal(list.games[0].html, undefined);
  assert.equal(list.games[0].owner, undefined);
  const unknown = await call('/index.html');
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'Endpoint not found.' });
});
test('Clerk auth, request validation and atomic per-account quota', async (t) => {
  const { call } = await setup(t);
  const options = { method: 'POST', body: { prompt: '造一个小游戏' } };
  assert.equal((await call('/api/games', { ...options, user: '' })).status, 401);
  assert.equal((await call('/api/games', { ...options, token: 'not.a.jwt' })).status, 401);
  assert.equal((await call('/api/games', { ...options, token: await sign('user_owner', { exp: -120 }) })).status, 401);
  const forger = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  assert.equal(
    (await call('/api/games', { ...options, token: await sign('user_owner', { key: forger.privateKey }) })).status,
    401,
  );
  assert.equal((await call('/api/games', { ...options, body: 'null' })).status, 400);
  assert.equal((await call('/api/games', { ...options, body: '{' })).status, 400);
  assert.equal((await call('/api/games', { ...options, contentType: 'text/plain' })).status, 415);
  assert.equal((await call('/api/games', { ...options, body: 'x'.repeat(12001) })).status, 413);
  assert.equal((await call('/api/games?before=NaN')).status, 400);
  const attempts = await Promise.all(Array.from({ length: 11 }, () => call('/api/games', options)));
  assert.equal(attempts.filter((r) => r.status === 201).length, 10);
  assert.equal(attempts.filter((r) => r.status === 429).length, 1);
  assert.equal((await call('/api/games', { ...options, user: 'user_other' })).status, 201);
});
test('cursor pages have no duplicates; invalid AI never inserts a game', async (t) => {
  const { call, env, count, owner } = await setup(t);
  for (let i = 0; i < 17; i++)
    await env.DB.prepare('INSERT INTO games(owner,title,description,html,published) VALUES (?,?,?,?,1)')
      .bind(owner, 'game ' + i, '', generated.html)
      .run();
  const first = await (await call('/api/games')).json();
  const second = await (await call(`/api/games?before=${first.next}`)).json();
  const third = await (await call(`/api/games?before=${second.next}`)).json();
  assert.equal(new Set([...first.games, ...second.games, ...third.games].map((g) => g.id)).size, 17 + ORIGINALS);
  assert.equal(third.next, null);
  env.AI.run = async () => ({ choices: [{ message: { content: 'bad json' } }] });
  assert.equal((await call('/api/games', { method: 'POST', body: { prompt: '造一个小游戏' } })).status, 502);
  assert.equal(await count('games'), 17 + ORIGINALS);
});

test('offline mode never invokes AI or consumes quota', async (t) => {
  const { call, env, count } = await setup(t);
  env.HOPON_OFFLINE = '1';
  env.AI.run = () => {
    throw new Error('must not call AI');
  };
  assert.equal((await call('/api/games', { method: 'POST', body: { prompt: '造一个小游戏' } })).status, 503);
  assert.equal(await count('generation_limits'), 0);
});

test('generation uses Kimi non-thinking mode with a bounded output budget', async (t) => {
  const { call, env } = await setup(t);
  env.AI.run = async (model, input) => {
    assert.equal(model, '@cf/moonshotai/kimi-k2.5');
    assert.deepEqual(input.chat_template_kwargs, { thinking: false });
    assert.equal(input.max_completion_tokens, 6000);
    return { choices: [{ message: { content: JSON.stringify(generated) } }] };
  };
  assert.equal(
    (await call('/api/games', { method: 'POST', body: { prompt: 'A five-second button game' } })).status,
    201,
  );
});
