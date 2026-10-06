import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import worker from '../src/index.ts';
import { parseGame, GAME_CSP } from '../src/game.ts';

// Throwaway RS256 key standing in for the Clerk instance; tokens below are really signed and verified.
const keys = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const CLERK_JWT_KEY = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64')}\n-----END PUBLIC KEY-----`;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
// `username` mirrors the Clerk session claim {{user.username}}: null until the user picks a handle.
async function sign(sub, { exp = 60, key = keys.privateKey, username = null } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'ins_test' })}.${b64({ sub, username, iat: now, nbf: now, exp: now + exp })}`;
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
  const call = async (
    path,
    { method = 'GET', body, user = owner, username = 'maya_makes', token, contentType = 'application/json' } = {},
  ) =>
    worker.fetch(
      new Request(`https://hopon.test${path}`, {
        method,
        headers: {
          'Content-Type': contentType,
          ...(user || token ? { Authorization: `Bearer ${token ?? (await sign(user, { username }))}` } : {}),
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
  const nameless = await call(`/api/games/${draft.id}/publish`, { method: 'POST', username: null });
  assert.equal(nameless.status, 400);
  assert.deepEqual(await nameless.json(), { error: 'Pick your name before publishing.' });
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
  assert.equal(list.games[0].author, 'maya_makes'); // the handle from the publisher's token
  assert.deepEqual(
    list.games.slice(1).map((g) => g.author),
    ['hopon', 'hopon'],
  );
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

test('likes: published only, one per user, counted in the feed, removable', async (t) => {
  const { call, env } = await setup(t);
  await assert.rejects(env.DB.prepare("INSERT INTO likes(game_id, user) VALUES (999999, 'x')").run(), /FOREIGN KEY/);
  const [game] = (await (await call('/api/games')).json()).games;
  const like = (id, options) => call(`/api/games/${id}/like`, { method: 'PUT', ...options });
  assert.equal((await like(game.id, { user: '' })).status, 401);
  const draft = await (await call('/api/games', { method: 'POST', body: { prompt: '点击星星的小游戏' } })).json();
  assert.equal((await like(draft.id)).status, 404);
  assert.deepEqual(await (await like(game.id)).json(), { liked: true, likes: 1 });
  assert.deepEqual(await (await like(game.id)).json(), { liked: true, likes: 1 });
  assert.deepEqual(await (await like(game.id, { user: 'user_other' })).json(), { liked: true, likes: 2 });
  const feed = async (user) => (await (await call('/api/games', { user })).json()).games[0];
  assert.deepEqual(await feed(), { ...game, likes: 2, liked: true });
  assert.deepEqual(await feed(''), { ...game, likes: 2, liked: false });
  assert.deepEqual(await (await call('/api/likes/count')).json(), { count: 1 });
  const unlike = await call(`/api/games/${game.id}/like`, { method: 'DELETE' });
  assert.deepEqual(await unlike.json(), { liked: false, likes: 1 });
  assert.deepEqual(await (await call('/api/likes/count')).json(), { count: 0 });
  assert.deepEqual(await (await call('/api/likes/count', { user: 'user_other' })).json(), { count: 1 });
  assert.equal((await call('/api/likes/count', { user: '' })).status, 401);
});
test('comments: anyone reads, posting needs sign-in and a handle, published games only', async (t) => {
  const { call } = await setup(t);
  const [game] = (await (await call('/api/games')).json()).games;
  const post = (id, body, options) => call(`/api/games/${id}/comments`, { method: 'POST', body: { body }, ...options });
  const list = async (id, options) => (await call(`/api/games/${id}/comments`, options)).json();
  assert.deepEqual(await list(game.id, { user: '' }), { comments: [], next: null });
  assert.equal((await post(game.id, 'nice', { user: '' })).status, 401);
  const noHandle = await post(game.id, 'nice', { username: null });
  assert.equal(noHandle.status, 400);
  assert.match((await noHandle.json()).error, /Pick your name/);
  const draft = await (await call('/api/games', { method: 'POST', body: { prompt: '点击星星的小游戏' } })).json();
  assert.equal((await post(draft.id, 'nice')).status, 404);
  assert.equal((await call(`/api/games/${draft.id}/comments`)).status, 404);

  const created = await post(game.id, '  beat 40!\nso good  ');
  assert.equal(created.status, 201);
  const comment = await created.json();
  assert.equal(comment.author, 'maya_makes');
  assert.equal(comment.body, 'beat 40!\nso good');
  assert.equal(comment.canDelete, true);
  assert.equal(typeof comment.id, 'number');
  assert.equal(typeof comment.createdAt, 'string');
  const { comments } = await list(game.id, { user: '' });
  assert.deepEqual(comments, [{ ...comment, canDelete: false }]);
});
test('comments: 1–300 characters after trimming', async (t) => {
  const { call, env } = await setup(t);
  const [game] = (await (await call('/api/games')).json()).games;
  const post = (body) => call(`/api/games/${game.id}/comments`, { method: 'POST', body: { body } });
  // SQLite's length() stops at a NUL, so one would slip past the count.
  for (const bad of ['', '   \n ', 'x'.repeat(301), 'hi\u0000there', 42, undefined])
    assert.equal((await post(bad)).status, 400, String(bad));
  assert.equal((await post('x'.repeat(300))).status, 201);
  // Characters, not UTF-16 units: 300 emoji fit.
  assert.equal((await post('🎮'.repeat(300))).status, 201);
  await assert.rejects(
    env.DB.prepare("INSERT INTO comments(game_id, user, author, body) VALUES (?, 'x', 'x', '')").bind(game.id).run(),
    /CHECK/,
  );
});
test('comments: newest first, 30 per page, no duplicates', async (t) => {
  const { call } = await setup(t);
  const [game] = (await (await call('/api/games')).json()).games;
  for (let i = 1; i <= 31; i++)
    await call(`/api/games/${game.id}/comments`, { method: 'POST', body: { body: `comment ${i}` } });
  const page = async (query = '') => (await call(`/api/games/${game.id}/comments${query}`)).json();
  const first = await page();
  assert.equal(first.comments.length, 30);
  assert.equal(first.comments[0].body, 'comment 31');
  const second = await page(`?before=${first.next}`);
  assert.deepEqual(
    second.comments.map((c) => c.body),
    ['comment 1'],
  );
  assert.equal(second.next, null);
  assert.equal((await call(`/api/games/${game.id}/comments?before=abc`)).status, 400);
});
test('comments: atomic 100 per account per day, separate from the generation quota', async (t) => {
  const { call } = await setup(t);
  const [game] = (await (await call('/api/games')).json()).games;
  const post = (user = 'user_owner') =>
    call(`/api/games/${game.id}/comments`, { method: 'POST', body: { body: 'hi' }, user });
  const attempts = await Promise.all(Array.from({ length: 101 }, () => post()));
  assert.equal(attempts.filter((r) => r.status === 201).length, 100);
  assert.equal(attempts.filter((r) => r.status === 429).length, 1);
  assert.equal((await post('user_other')).status, 201);
  assert.equal((await call('/api/games', { method: 'POST', body: { prompt: '造一个小游戏' } })).status, 201);
});
test("comments: deleted by their author or the game's creator, hidden from everyone else", async (t) => {
  const { call } = await setup(t);
  const draft = await (await call('/api/games', { method: 'POST', body: { prompt: '点击星星的小游戏' } })).json();
  await call(`/api/games/${draft.id}/publish`, { method: 'POST' });
  const post = async (user, body) =>
    (await call(`/api/games/${draft.id}/comments`, { method: 'POST', body: { body }, user, username: user })).json();
  const first = await post('user_fan', 'first');
  const second = await post('user_fan', 'second');
  const list = async (user) => (await (await call(`/api/games/${draft.id}/comments`, { user })).json()).comments;
  assert.deepEqual(
    (await list('user_owner')).map((c) => [c.body, c.canDelete]),
    [
      ['second', true],
      ['first', true],
    ],
  );
  assert.deepEqual(
    (await list('user_stranger')).map((c) => c.canDelete),
    [false, false],
  );
  const remove = (id, user) => call(`/api/comments/${id}`, { method: 'DELETE', user });
  assert.equal((await remove(first.id, '')).status, 401);
  assert.equal((await remove(first.id, 'user_stranger')).status, 404);
  assert.equal((await remove(first.id, 'user_owner')).status, 204);
  assert.equal((await remove(second.id, 'user_fan')).status, 204);
  assert.equal((await remove(second.id, 'user_fan')).status, 404);
  assert.deepEqual(await list(''), []);
});
test('comments: counted in the feed', async (t) => {
  const { call } = await setup(t);
  const feed = async () => (await (await call('/api/games', { user: '' })).json()).games[0];
  const game = await feed();
  assert.equal(game.comments, 0);
  const posted = await (
    await call(`/api/games/${game.id}/comments`, { method: 'POST', body: { body: 'nice' } })
  ).json();
  await call(`/api/games/${game.id}/comments`, { method: 'POST', body: { body: 'again' } });
  assert.equal((await feed()).comments, 2);
  await call(`/api/comments/${posted.id}`, { method: 'DELETE' });
  assert.equal((await feed()).comments, 1);
});
test('saves: sign-in, published only, one per user, flagged in the feed, removable', async (t) => {
  const { call, env, count } = await setup(t);
  await assert.rejects(env.DB.prepare("INSERT INTO saves(game_id, user) VALUES (999999, 'x')").run(), /FOREIGN KEY/);
  const [game] = (await (await call('/api/games')).json()).games;
  const save = (id, options) => call(`/api/games/${id}/save`, { method: 'PUT', ...options });
  assert.equal((await save(game.id, { user: '' })).status, 401);
  assert.equal((await call(`/api/games/${game.id}/save`, { method: 'DELETE', user: '' })).status, 401);
  assert.equal((await call('/api/saves', { user: '' })).status, 401);
  assert.equal((await call('/api/saves/count', { user: '' })).status, 401);
  const draft = await (await call('/api/games', { method: 'POST', body: { prompt: '点击星星的小游戏' } })).json();
  assert.equal((await save(draft.id)).status, 404);
  assert.equal((await save(999999)).status, 404);
  assert.deepEqual(await (await save(game.id)).json(), { saved: true });
  assert.deepEqual(await (await save(game.id)).json(), { saved: true });
  assert.equal(await count('saves'), 1);
  const feed = async (user) => (await (await call('/api/games', { user })).json()).games[0];
  assert.deepEqual(await feed(), { ...game, saved: true });
  assert.deepEqual(await feed(''), { ...game, saved: false });
  assert.deepEqual(await (await call('/api/saves/count')).json(), { count: 1 });
  const { games, next } = await (await call('/api/saves')).json();
  assert.equal(next, null);
  assert.equal(games.length, 1);
  assert.equal(typeof games[0].saveId, 'number');
  assert.deepEqual(games[0], { ...game, saved: true, saveId: games[0].saveId });
  const unsave = await call(`/api/games/${game.id}/save`, { method: 'DELETE' });
  assert.deepEqual(await unsave.json(), { saved: false });
  assert.equal(await count('saves'), 0);
  assert.deepEqual(await (await call('/api/saves/count')).json(), { count: 0 });
  assert.deepEqual(await (await call('/api/saves')).json(), { games: [], next: null });
});
test('saves: private to the person who saved', async (t) => {
  const { call } = await setup(t);
  const [game] = (await (await call('/api/games')).json()).games;
  await call(`/api/games/${game.id}/save`, { method: 'PUT', user: 'user_a' });
  assert.deepEqual(await (await call('/api/saves', { user: 'user_b' })).json(), { games: [], next: null });
  assert.deepEqual(await (await call('/api/saves/count', { user: 'user_b' })).json(), { count: 0 });
  const feed = async (user) => (await (await call('/api/games', { user })).json()).games[0];
  assert.equal((await feed('user_b')).saved, false);
  assert.equal((await feed('user_a')).saved, true);
  // Unsaving someone else's save only touches your own (absent) row.
  await call(`/api/games/${game.id}/save`, { method: 'DELETE', user: 'user_b' });
  assert.deepEqual(await (await call('/api/saves/count', { user: 'user_a' })).json(), { count: 1 });
});
test('saves: newest save first, 8 per page, no duplicates', async (t) => {
  const { call, env, owner } = await setup(t);
  for (let i = 0; i < 17; i++)
    await env.DB.prepare('INSERT INTO games(owner,title,description,html,published) VALUES (?,?,?,?,1)')
      .bind(owner, 'game ' + i, '', generated.html)
      .run();
  // Save newest game first, then the older ones: save order, not game order, decides the list.
  const ids = (await env.DB.prepare('SELECT id FROM games ORDER BY id DESC').all()).results.map((r) => r.id);
  for (const id of ids) await call(`/api/games/${id}/save`, { method: 'PUT' });
  const page = async (query = '') => (await call(`/api/saves${query}`)).json();
  const first = await page();
  const second = await page(`?before=${first.next}`);
  const third = await page(`?before=${second.next}`);
  assert.equal(third.next, null);
  const listed = [...first.games, ...second.games, ...third.games];
  assert.deepEqual(
    listed.map((g) => g.id),
    [...ids].reverse(),
  );
  assert.equal(first.games.length, 8);
  assert.ok(listed.every((g) => g.saved));
  assert.equal(first.next, first.games[7].saveId);
  assert.equal((await call('/api/saves?before=abc')).status, 400);
  // The saved feed opens at a tapped game with before = its saveId + 1.
  const tapped = second.games[2];
  assert.equal((await page(`?before=${tapped.saveId + 1}`)).games[0].id, tapped.id);
});
