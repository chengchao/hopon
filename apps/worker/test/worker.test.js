import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { drizzle } from "drizzle-orm/d1";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

import worker from "../src/api.ts";
import { GAME_CSP } from "../src/game.ts";
import { charge, pruneLimits, week } from "../src/storage.ts";

// Throwaway RS256 key standing in for the Clerk instance; tokens below are really signed and verified.
const keys = await crypto.subtle.generateKey(
  {
    hash: "SHA-256",
    modulusLength: 2048,
    name: "RSASSA-PKCS1-v1_5",
    publicExponent: new Uint8Array([1, 0, 1]),
  },
  true,
  ["sign", "verify"]
);
const CLERK_JWT_KEY = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey)).toString("base64")}\n-----END PUBLIC KEY-----`;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
// `username` mirrors the Clerk session claim {{user.username}}: null until the user picks a handle.
const sign = async (
  sub,
  { exp = 60, key = keys.privateKey, username = null } = {}
) => {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "RS256", kid: "ins_test", typ: "JWT" })}.${b64({ exp: now + exp, iat: now, nbf: now, sub, username })}`;
  return `${body}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body))).toString("base64url")}`;
};
// Read a pending response's status or JSON body with one await.
const status = async (pending) => {
  const response = await pending;
  return response.status;
};
const json = async (pending) => {
  const response = await pending;
  return response.json();
};
// A plain-DOM game as the Maker leaves it: its index.html, title and description.
const made = {
  description: "点击星星得分",
  html: '<!doctype html><html><body><button>星星</button><script>document.querySelector("button").onclick=e=>e.target.textContent="1"</script></body></html>',
  title: "星星小游戏",
};
// A runtime game's index.html, which loads its game.js.
const INDEX_HTML =
  '<!doctype html><html><body><script src="/runtime/v2.js"></script><script src="game.js"></script></body></html>';
const OPERATOR_PASSWORD = "test-operator-password-of-32-chars!";
const PREVIEW_SECRET = "test-preview-secret-of-32-chars!!";
// Seeded by migrations/*_originals.sql and *_runtime_original.sql.
const ORIGINALS = 3;
const migrations = readdirSync(new URL("../migrations", import.meta.url))
  .filter((f) => f.endsWith(".sql"))
  .toSorted()
  .flatMap((f) =>
    unstable_splitSqlQuery(
      readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf-8")
    )
  );
// A fresh, in-memory local D1 (workerd) per test, migrated like `wrangler d1 migrations apply`; only AI is faked.
const setup = async (t) => {
  const proxy = await getPlatformProxy({
    configPath: new URL("wrangler.jsonc", import.meta.url).pathname,
    envFiles: [],
    persist: false,
    remoteBindings: false,
  });
  t.after(() => proxy.dispose());
  const { DB } = proxy.env;
  await DB.batch(migrations.map((sql) => DB.prepare(sql)));
  // Workers AI is only Llama Guard's verdict for Screening. Tests swap it.
  const ai = {
    screen: () => Promise.resolve({ response: { categories: [], safe: true } }),
  };
  // Each Draft's Talker, faked: it records what the Worker forwards (src/talker.ts is checked under wrangler, in
  // test/talker.test.js). A ticket is good once, for its own Draft only. A test sets `talker.busy` for a running turn.
  const forwarded = [];
  const talker = { busy: false };
  const answer = (draft, request, init) => {
    if (request instanceof Request) {
      forwarded.push({ action: "upgrade", draft });
      return new Response("socket", { status: 200 });
    }
    const action = new URL(request).pathname.slice(1);
    const body = JSON.parse(init.body);
    forwarded.push({ action, draft, ...body });
    const minted = forwarded.filter((f) => f.action === "ticket").length;
    const redeemed = forwarded.filter(
      (f) =>
        f.action === "redeem" && f.draft === draft && f.ticket === body.ticket
    ).length;
    if (action === "ticket") {
      return Response.json({ ticket: `${draft}:${minted}` });
    }
    if (action === "redeem") {
      const valid = body.ticket.startsWith(`${draft}:`) && redeemed === 1;
      return new Response(null, { status: valid ? 204 : 404 });
    }
    if (action === "message") {
      return Response.json({ id: "op" }, { status: 202 });
    }
    if (action === "busy") {
      return Response.json({ busy: talker.busy });
    }
    // As on Cloudflare: destroy() resets the Talker before its 204 gets back.
    if (action === "delete") {
      throw Object.assign(new Error("destroyed"), { durableObjectReset: true });
    }
    return new Response(null, { status: 204 });
  };
  const TALKER = {
    getByName: (draft) => ({
      fetch: (request, init) => Promise.try(answer, draft, request, init),
    }),
    newUniqueId: () => ({ toString: () => randomBytes(32).toString("hex") }),
  };
  // Each Draft's Coder, faked: only `DELETE /box` is the Worker's to call. A test sets `coder.status` to make it fail.
  const coder = { status: 204 };
  const CODER = {
    getByName: (draft) => ({
      fetch: (url, init) => {
        forwarded.push({
          action: `${init.method} ${new URL(url).pathname}`,
          draft,
        });
        return Promise.resolve(new Response(null, { status: coder.status }));
      },
    }),
  };
  const env = {
    AI: {
      run: (model, input) => {
        assert.equal(model, "@cf/meta/llama-guard-3-8b");
        return ai.screen(input);
      },
    },
    CLERK_JWT_KEY,
    CODER,
    DB,
    FILES: proxy.env.FILES,
    MAKER_WEEKLY_TOKENS: "3000000",
    OPERATOR_PASSWORD,
    PREVIEW_SECRET,
    TALKER,
  };
  const count = async (table) => {
    const { n } = await DB.prepare(
      `SELECT COUNT(*) AS n FROM ${table}`
    ).first();
    return n;
  };
  const owner = "user_owner";
  // Work handed to `waitUntil`; `settled` waits for it, as the runtime would after the response.
  const background = [];
  const ctx = {
    passThroughOnException: () => {},
    waitUntil: (promise) => background.push(promise),
  };
  const settled = () => Promise.all(background);
  const call = async (
    path,
    {
      method = "GET",
      body,
      user = owner,
      username = "maya_makes",
      token,
      contentType = "application/json",
    } = {}
  ) =>
    worker.fetch(
      new Request(`https://hopon.test${path}`, {
        headers: {
          "Content-Type": contentType,
          ...(user || token
            ? {
                Authorization: `Bearer ${token ?? (await sign(user, { username }))}`,
              }
            : {}),
        },
        method,
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
      env,
      ctx
    );
  // The Operator's browser on /operator: Basic credentials with any username (none when `password` is null), and on
  // a write the headers a same-origin form post carries under `Referrer-Policy: no-referrer`.
  const operate = (
    path,
    {
      method = "GET",
      origin = "null",
      password = OPERATOR_PASSWORD,
      site = "same-origin",
    } = {}
  ) =>
    worker.fetch(
      new Request(`https://hopon.test${path}`, {
        headers: {
          ...(password === null
            ? {}
            : {
                Authorization: `Basic ${Buffer.from(`anyone:${password}`).toString("base64")}`,
              }),
          ...(method === "GET"
            ? {}
            : {
                "Content-Type": "application/x-www-form-urlencoded",
                Origin: origin,
                "Sec-Fetch-Site": site,
              }),
        },
        method,
        redirect: "manual",
      }),
      env,
      ctx
    );
  // A Draft of `user`'s with one Revision, `1/`, as the Talker leaves it after a build: its files in R2, and the
  // Maker's title and description on its row.
  const draft = async ({
    description = made.description,
    files = { "index.html": made.html },
    title = made.title,
    user = owner,
  } = {}) => {
    const created = await call("/api/drafts", {
      body: { text: "A star game" },
      method: "POST",
      user,
    });
    const { id } = await created.json();
    await DB.prepare(
      "UPDATE drafts SET title = ?, description = ? WHERE id = ?"
    )
      .bind(title, description, id)
      .run();
    await Promise.all(
      Object.entries(files).map(([name, body]) =>
        proxy.env.FILES.put(`drafts/${id}/1/${name}`, body)
      )
    );
    return id;
  };
  // A published Game: a Draft of `user`'s, published as `username`. Its id.
  const publish = async ({
    user = owner,
    username = "maya_makes",
    ...options
  } = {}) => {
    const id = await draft({ user, ...options });
    const published = await call(`/api/drafts/${id}/publish`, {
      method: "POST",
      user,
      username,
    });
    assert.equal(published.status, 201);
    const game = await published.json();
    return game.id;
  };
  return {
    ai,
    call,
    coder,
    count,
    draft,
    env,
    forwarded,
    operate,
    owner,
    publish,
    settled,
    talker,
  };
};
// The ids /api/drafts lists for `user` (the owner by default).
const draftIds = async (call, user) => {
  const { drafts } = await json(call("/api/drafts", user ? { user } : {}));
  return drafts.map((d) => d.id);
};
// Every key in R2 under `prefix`.
const filesIn = async (env, prefix) => {
  const { objects } = await env.FILES.list({ prefix });
  return objects.map((object) => object.key);
};

test("publish: every file of the current Revision becomes the Game's, the row keeps the Draft's id, and the Draft is Deleted", async (t) => {
  const { call, draft, env, forwarded } = await setup(t);
  const { games } = await json(call("/api/games"));
  assert.deepEqual(
    games.map((g) => g.title),
    ["Bubble Pop", "Odd Duck", "Toast Panic"]
  );
  const art = new Uint8Array([0, 255, 128, 7]);
  const id = await draft({
    files: {
      "art.bin": art,
      "game.js": "engineInit();",
      "index.html": INDEX_HTML,
      "music.js": "hopon.music('T2dnUw==');",
    },
  });
  const publish = (options) =>
    call(`/api/drafts/${id}/publish`, { method: "POST", ...options });
  assert.equal(await status(publish({ user: "" })), 401);
  const theirs = await publish({ user: "user_other" });
  assert.equal(theirs.status, 404);
  assert.deepEqual(await theirs.json(), { error: "Draft not found." });
  const nameless = await publish({ username: null });
  assert.equal(nameless.status, 400);
  assert.deepEqual(await nameless.json(), {
    error: "Pick your name before publishing.",
  });
  forwarded.length = 0;
  const published = await publish();
  assert.equal(published.status, 201);
  const { id: gameId } = await published.json();
  assert.deepEqual(forwarded, [
    { action: "busy", draft: id },
    { action: "delete", draft: id },
    { action: "DELETE /box", draft: id },
  ]);
  // The Draft is gone: its row, its files, and every route.
  assert.deepEqual(await draftIds(call), []);
  assert.deepEqual(await filesIn(env, "drafts/"), []);
  assert.equal(await status(publish()), 404);
  const row = await env.DB.prepare("SELECT * FROM games WHERE id = ?")
    .bind(gameId)
    .first();
  assert.deepEqual(
    { ...row, created_at: undefined },
    {
      author: "maya_makes",
      created_at: undefined,
      description: made.description,
      draft_id: id,
      id: gameId,
      owner: "user_owner",
      runtime: "v2",
      title: made.title,
    }
  );
  assert.deepEqual(await filesIn(env, `games/${gameId}/`), [
    `games/${gameId}/art.bin`,
    `games/${gameId}/game.js`,
    `games/${gameId}/index.html`,
    `games/${gameId}/music.js`,
  ]);
  // Public, under the game CSP, each file typed by its extension.
  const file = (name) => call(`/games/${gameId}/${name}`, { user: "" });
  const page = await file("index.html");
  assert.equal(page.status, 200);
  assert.equal(await page.text(), INDEX_HTML);
  assert.match(page.headers.get("Content-Type"), /^text\/html/u);
  assert.equal(page.headers.get("Content-Security-Policy"), GAME_CSP);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.ok(!GAME_CSP.includes("allow-same-origin"));
  assert.ok(GAME_CSP.includes("connect-src 'none'"));
  // 'self' lets a game load /runtime/v2.js and its own files.
  assert.match(GAME_CSP, /script-src 'self'/u);
  assert.match(GAME_CSP, /media-src 'self'/u);
  for (const name of ["game.js", "music.js"]) {
    // oxlint-disable-next-line no-await-in-loop -- one file at a time
    const script = await file(name);
    assert.match(script.headers.get("Content-Type"), /^text\/javascript/u);
    assert.equal(script.headers.get("Content-Security-Policy"), GAME_CSP);
  }
  const binary = await file("art.bin");
  assert.equal(binary.headers.get("Content-Type"), "application/octet-stream");
  assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), art);
  const missing = await file("nope.js");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "File not found." });
  const list = await json(call("/api/games"));
  assert.equal(list.games.length, ORIGINALS + 1);
  assert.equal(list.games[0].id, gameId);
  assert.equal(list.games[0].owner, undefined);
  // The handle from the publisher's token.
  assert.equal(list.games[0].author, "maya_makes");
  assert.deepEqual(
    list.games.slice(1).map((g) => g.author),
    Array.from({ length: ORIGINALS }, () => "hopon")
  );
  // A plain-DOM game loads no runtime.
  const plain = await draft();
  const { id: plainId } = await json(
    call(`/api/drafts/${plain}/publish`, { method: "POST" })
  );
  const { runtime } = await env.DB.prepare(
    "SELECT runtime FROM games WHERE id = ?"
  )
    .bind(plainId)
    .first();
  assert.equal(runtime, null);
  const unknown = await call("/index.html");
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "Endpoint not found." });
});

test("publish: refused before the first Revision or while a turn runs; the Draft stays as it is", async (t) => {
  const { call, count, draft, env, forwarded, talker } = await setup(t);
  const { id: empty } = await json(
    call("/api/drafts", { body: { text: "A dog game" }, method: "POST" })
  );
  const id = await draft();
  const publish = (draftId) =>
    call(`/api/drafts/${draftId}/publish`, { method: "POST" });
  const none = await publish(empty);
  assert.equal(none.status, 409);
  assert.deepEqual(await none.json(), { error: "This Draft has no game yet." });
  talker.busy = true;
  const busy = await publish(id);
  assert.equal(busy.status, 409);
  assert.deepEqual(await busy.json(), {
    error: "Wait for the Maker to finish, then publish.",
  });
  assert.equal(
    forwarded.some((f) => f.action === "delete"),
    false
  );
  const listed = await draftIds(call);
  assert.deepEqual(listed.toSorted(), [empty, id].toSorted());
  assert.deepEqual(await filesIn(env, `drafts/${id}/`), [
    `drafts/${id}/1/index.html`,
  ]);
  assert.equal(await count("games"), ORIGINALS);
  talker.busy = false;
  assert.equal(await status(publish(id)), 201);
});

test("publish: a failed Delete leaves the Draft listed, and a retry finishes it with the same Game", async (t) => {
  const { call, coder, count, draft, env } = await setup(t);
  const id = await draft();
  coder.status = 502;
  const publish = () => call(`/api/drafts/${id}/publish`, { method: "POST" });
  assert.equal(await status(publish()), 500);
  assert.deepEqual(await draftIds(call), [id]);
  coder.status = 204;
  const { id: gameId } = await json(publish());
  assert.deepEqual(await draftIds(call), []);
  assert.equal(await count("games"), ORIGINALS + 1);
  assert.deepEqual(await filesIn(env, "games/"), [
    `games/${gameId}/index.html`,
  ]);
});

test("Clerk auth and request validation", async (t) => {
  const { call } = await setup(t);
  const options = { body: { text: "造一个小游戏" }, method: "POST" };
  assert.equal(
    await status(call("/api/drafts", { ...options, user: "" })),
    401
  );
  assert.equal(
    await status(call("/api/drafts", { ...options, token: "not.a.jwt" })),
    401
  );
  assert.equal(
    await status(
      call("/api/drafts", {
        ...options,
        token: await sign("user_owner", { exp: -120 }),
      })
    ),
    401
  );
  const forger = await crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"]
  );
  assert.equal(
    await status(
      call("/api/drafts", {
        ...options,
        token: await sign("user_owner", { key: forger.privateKey }),
      })
    ),
    401
  );
  assert.equal(
    await status(call("/api/drafts", { ...options, body: "null" })),
    400
  );
  // Hono's own malformed-JSON refusal still renders as `{ error }`, unlike the responses basicAuth and csrf carry.
  const malformed = await call("/api/drafts", { ...options, body: "{" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: "Malformed JSON in request body",
  });
  assert.equal(
    await status(
      call("/api/drafts", { ...options, contentType: "text/plain" })
    ),
    415
  );
  assert.equal(
    await status(call("/api/drafts", { ...options, body: "x".repeat(12_001) })),
    413
  );
  assert.equal(await status(call("/api/games?before=NaN")), 400);
  assert.equal(await status(call("/api/drafts", options)), 201);
});
test("cursor pages have no duplicates", async (t) => {
  const { call, env, owner } = await setup(t);
  const insert = env.DB.prepare(
    "INSERT INTO games(owner,title,description) VALUES (?,?,?)"
  );
  await env.DB.batch(
    Array.from({ length: 17 }, (_, i) => insert.bind(owner, `game ${i}`, ""))
  );
  const first = await json(call("/api/games"));
  const second = await json(call(`/api/games?before=${first.next}`));
  const third = await json(call(`/api/games?before=${second.next}`));
  assert.equal(
    new Set([...first.games, ...second.games, ...third.games].map((g) => g.id))
      .size,
    17 + ORIGINALS
  );
  assert.equal(third.next, null);
});

test("offline mode never invokes AI: messages to the Maker and comments go unscreened", async (t) => {
  const { call, env } = await setup(t);
  env.HOPON_OFFLINE = "1";
  env.AI.run = () => {
    throw new Error("must not call AI");
  };
  assert.equal(
    await status(
      call("/api/drafts", { body: { text: "造一个小游戏" }, method: "POST" })
    ),
    201
  );
  // Offline mode is local dev only.
  const {
    games: [game],
  } = await json(call("/api/games"));
  assert.equal(
    await status(
      call(`/api/games/${game.id}/comments`, {
        body: { body: "hi" },
        method: "POST",
      })
    ),
    201
  );
});

const REFUSED = {
  error:
    "This looks like it breaks hopon's rules. Please change it and try again.",
};
// Flags every text but the default Handle, so the verdict lands on the prompt, comment or game text, not on
// `handle_rejected`. `flagOnly` aims at named texts instead.
const flag =
  (...categories) =>
  ({ messages: [{ content }] }) =>
    Promise.resolve({
      response:
        content === "maya_makes"
          ? { categories: [], safe: true }
          : { categories, safe: false },
    });

// Flags exactly the texts given, so a test picks which of a route's checks refuses.
const flagOnly =
  (...texts) =>
  ({ messages: [{ content }] }) =>
    Promise.resolve({
      response: texts.includes(content)
        ? { categories: ["S10"], safe: false }
        : { categories: [], safe: true },
    });
test("screening: a flagged message to the Maker is refused before it starts a Draft and costs nothing", async (t) => {
  const { ai, call, count } = await setup(t);
  const screened = [];
  ai.screen = (input) => {
    screened.push(input);
    return flag("S1")(input);
  };
  const response = await call("/api/drafts", {
    body: { text: "A game about hurting people" },
    method: "POST",
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), REFUSED);
  assert.deepEqual(screened, [
    {
      messages: [{ content: "A game about hurting people", role: "user" }],
      response_format: { type: "json_object" },
    },
  ]);
  assert.equal(await count("drafts"), 0);
  assert.equal(await count("generation_limits"), 0);
});

test("screening: a flagged comment is refused, saves nothing and counts toward the daily limit", async (t) => {
  const { ai, call, count, env } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  ai.screen = flagOnly("a slur");
  const response = await call(`/api/games/${game.id}/comments`, {
    body: { body: "a slur" },
    method: "POST",
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), REFUSED);
  assert.equal(await count("comments"), 0);
  const { spent } = await env.DB.prepare(
    "SELECT count AS spent FROM generation_limits WHERE bucket LIKE 'comment:user_owner:%'"
  ).first();
  assert.equal(spent, 1);
});

test("screening: a flag only in S6, S8 or S13 is let through", async (t) => {
  const { ai, call } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const comment = (body) =>
    call(`/api/games/${game.id}/comments`, { body: { body }, method: "POST" });
  ai.screen = flag("S6", "S8", "S13");
  assert.equal(await status(comment("see a doctor about it")), 201);
  ai.screen = flag("S13", "S1");
  assert.deepEqual(await json(comment("mixed")), REFUSED);
  ai.screen = flag();
  assert.deepEqual(await json(comment("no category")), REFUSED);
});

test("screening: a call that stalls past 3 s is asked again", async (t) => {
  const { ai, call } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  // The comment and its Handle are screened in parallel; each stalls twice, then answers.
  const calls = new Map();
  ai.screen = async ({ messages: [{ content }] }) => {
    calls.set(content, (calls.get(content) ?? 0) + 1);
    if (calls.get(content) < 3) {
      await sleep(3500);
    }
    return { response: { categories: [], safe: true } };
  };
  assert.equal(
    await status(
      call(`/api/games/${game.id}/comments`, {
        body: { body: "hello" },
        method: "POST",
      })
    ),
    201
  );
  assert.deepEqual([...calls.values()], [3, 3]);
});

test("screening: fails closed when it errors, answers oddly or stalls 3 times", async (t) => {
  const { ai, call, count } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const comment = (body = "hello") =>
    json(
      call(`/api/games/${game.id}/comments`, {
        body: { body },
        method: "POST",
      })
    );
  const tryAgain = {
    error: "We couldn't check your text just now. Please try again.",
  };
  ai.screen = () => Promise.reject(new Error("AI down"));
  assert.deepEqual(await comment(), tryAgain);
  assert.equal(
    await status(
      call("/api/drafts", { body: { text: "造一个小游戏" }, method: "POST" })
    ),
    503
  );
  // Odd answers, keyed by the comment that gets them.
  const odd = {
    "a null verdict": { response: null },
    "a string": { response: "safe" },
    nothing: undefined,
  };
  ai.screen = ({ messages: [{ content }] }) => Promise.resolve(odd[content]);
  assert.deepEqual(
    await Promise.all(Object.keys(odd).map((body) => comment(body))),
    Object.keys(odd).map(() => tryAgain)
  );
  ai.screen = async () => {
    await sleep(3500);
    return { response: { safe: true } };
  };
  const started = Date.now();
  assert.deepEqual(await comment(), tryAgain);
  assert.ok(Date.now() - started < 9400);
  assert.equal(await count("comments"), 0);
});

const HANDLE_REJECTED = {
  code: "handle_rejected",
  error: "Your name breaks hopon's rules. Pick a different one.",
};

test("screening: a flagged title or description refuses Publish and leaves the Draft as it is", async (t) => {
  const { ai, call, count, draft, env, forwarded } = await setup(t);
  const id = await draft();
  const screened = [];
  ai.screen = (input) => {
    screened.push(input.messages[0].content);
    return flagOnly(`${made.title}\n${made.description}`)(input);
  };
  const response = await call(`/api/drafts/${id}/publish`, {
    method: "POST",
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error:
      "This game's title or description breaks hopon's rules. Ask the Maker to change it.",
  });
  assert.deepEqual(screened.toSorted(), [
    "maya_makes",
    `${made.title}\n${made.description}`,
  ]);
  // Still listed with the title and description Publish's confirm sheet shows.
  const { drafts } = await json(call("/api/drafts"));
  assert.deepEqual(
    drafts.map(({ description, title }) => ({ description, title })),
    [{ description: made.description, title: made.title }]
  );
  assert.deepEqual(await filesIn(env, `drafts/${id}/`), [
    `drafts/${id}/1/index.html`,
  ]);
  assert.deepEqual(await filesIn(env, "games/"), []);
  assert.equal(await count("games"), ORIGINALS);
  assert.equal(
    forwarded.some((f) => f.action === "delete"),
    false
  );
});

test("screening: a flagged Handle refuses publishing and commenting with handle_rejected", async (t) => {
  const { ai, call, count, draft } = await setup(t);
  const id = await draft();
  const {
    games: [game],
  } = await json(call("/api/games"));
  ai.screen = flagOnly("bad_name");
  const publish = await call(`/api/drafts/${id}/publish`, {
    method: "POST",
    username: "bad_name",
  });
  assert.equal(publish.status, 422);
  assert.deepEqual(await publish.json(), HANDLE_REJECTED);
  assert.deepEqual(await draftIds(call), [id]);
  const comment = await call(`/api/games/${game.id}/comments`, {
    body: { body: "nice" },
    method: "POST",
    username: "bad_name",
  });
  assert.equal(comment.status, 422);
  assert.deepEqual(await comment.json(), HANDLE_REJECTED);
  assert.equal(await count("comments"), 0);
});

test("screening: when the text and the Handle are both flagged, the response says the Handle", async (t) => {
  const { ai, call, count, draft } = await setup(t);
  const id = await draft();
  const {
    games: [game],
  } = await json(call("/api/games"));
  ai.screen = flagOnly(
    "bad_name",
    "a slur",
    `${made.title}\n${made.description}`
  );
  const publish = await call(`/api/drafts/${id}/publish`, {
    method: "POST",
    username: "bad_name",
  });
  assert.deepEqual(await publish.json(), HANDLE_REJECTED);
  const comment = await call(`/api/games/${game.id}/comments`, {
    body: { body: "a slur" },
    method: "POST",
    username: "bad_name",
  });
  assert.deepEqual(await comment.json(), HANDLE_REJECTED);
  // A Handle check that can't answer doesn't hide the text's refusal.
  ai.screen = (input) =>
    input.messages[0].content === "maya_makes"
      ? Promise.reject(new Error("AI down"))
      : flagOnly("a slur")(input);
  assert.deepEqual(
    await json(
      call(`/api/games/${game.id}/comments`, {
        body: { body: "a slur" },
        method: "POST",
      })
    ),
    REFUSED
  );
  assert.equal(await count("comments"), 0);
  assert.deepEqual(await draftIds(call), [id]);
});

test("likes: games only, one per user, counted in the feed, removable", async (t) => {
  const { call, env } = await setup(t);
  await assert.rejects(
    env.DB.prepare(
      "INSERT INTO likes(game_id, user) VALUES (999999, 'x')"
    ).run(),
    /FOREIGN KEY/u
  );
  const {
    games: [game],
  } = await json(call("/api/games"));
  const like = (id, options) =>
    call(`/api/games/${id}/like`, { method: "PUT", ...options });
  assert.equal(await status(like(game.id, { user: "" })), 401);
  assert.equal(await status(like(999_999)), 404);
  assert.deepEqual(await json(like(game.id)), {
    liked: true,
    likes: 1,
  });
  assert.deepEqual(await json(like(game.id)), {
    liked: true,
    likes: 1,
  });
  assert.deepEqual(await json(like(game.id, { user: "user_other" })), {
    liked: true,
    likes: 2,
  });
  const feed = async (user) => {
    const { games } = await json(call("/api/games", { user }));
    return games[0];
  };
  assert.deepEqual(await feed(), { ...game, liked: true, likes: 2 });
  assert.deepEqual(await feed(""), { ...game, liked: false, likes: 2 });
  assert.deepEqual(await json(call("/api/likes/count")), { count: 1 });
  const unlike = await call(`/api/games/${game.id}/like`, { method: "DELETE" });
  assert.deepEqual(await unlike.json(), { liked: false, likes: 1 });
  assert.deepEqual(await json(call("/api/likes/count")), { count: 0 });
  assert.deepEqual(
    await json(call("/api/likes/count", { user: "user_other" })),
    { count: 1 }
  );
  assert.equal(await status(call("/api/likes/count", { user: "" })), 401);
});
test("comments: anyone reads, posting needs sign-in and a handle, games only", async (t) => {
  const { call } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const post = (id, body, options) =>
    call(`/api/games/${id}/comments`, {
      body: { body },
      method: "POST",
      ...options,
    });
  const list = (id, options) =>
    json(call(`/api/games/${id}/comments`, options));
  assert.deepEqual(await list(game.id, { user: "" }), {
    comments: [],
    next: null,
  });
  assert.equal(await status(post(game.id, "nice", { user: "" })), 401);
  const noHandle = await post(game.id, "nice", { username: null });
  assert.equal(noHandle.status, 400);
  const { error } = await noHandle.json();
  assert.match(error, /Pick your name/u);
  assert.equal(await status(post(999_999, "nice")), 404);
  assert.equal(await status(call("/api/games/999999/comments")), 404);

  const created = await post(game.id, "  beat 40!\nso good  ");
  assert.equal(created.status, 201);
  const comment = await created.json();
  assert.equal(comment.author, "maya_makes");
  assert.equal(comment.body, "beat 40!\nso good");
  assert.equal(comment.canDelete, true);
  assert.equal(typeof comment.id, "number");
  assert.equal(typeof comment.createdAt, "string");
  const { comments } = await list(game.id, { user: "" });
  assert.deepEqual(comments, [{ ...comment, canDelete: false, mine: false }]);
});
test("comments: 1–300 characters after trimming", async (t) => {
  const { call, env } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const post = (body) =>
    call(`/api/games/${game.id}/comments`, { body: { body }, method: "POST" });
  // SQLite's length() stops at a NUL, so one would slip past the count.
  const invalid = [
    "",
    "   \n ",
    "x".repeat(301),
    "hi\u0000there",
    42,
    undefined,
  ];
  assert.deepEqual(
    await Promise.all(invalid.map((body) => status(post(body)))),
    invalid.map(() => 400)
  );
  assert.equal(await status(post("x".repeat(300))), 201);
  // Characters, not UTF-16 units: 300 emoji fit.
  assert.equal(await status(post("🎮".repeat(300))), 201);
  await assert.rejects(
    env.DB.prepare(
      "INSERT INTO comments(game_id, user, author, body) VALUES (?, 'x', 'x', '')"
    )
      .bind(game.id)
      .run(),
    /CHECK/u
  );
});
test("comments: newest first, 30 per page, no duplicates", async (t) => {
  const { call } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  for (let i = 1; i <= 31; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- posted in order so "newest first" has a known answer
    await call(`/api/games/${game.id}/comments`, {
      body: { body: `comment ${i}` },
      method: "POST",
    });
  }
  const page = (query = "") =>
    json(call(`/api/games/${game.id}/comments${query}`));
  const first = await page();
  assert.equal(first.comments.length, 30);
  assert.equal(first.comments[0].body, "comment 31");
  const second = await page(`?before=${first.next}`);
  assert.deepEqual(
    second.comments.map((c) => c.body),
    ["comment 1"]
  );
  assert.equal(second.next, null);
  assert.equal(
    await status(call(`/api/games/${game.id}/comments?before=abc`)),
    400
  );
});
test("comments: atomic 100 per account per day, separate from the Allowance", async (t) => {
  const { call, env } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const post = (user = "user_owner") =>
    call(`/api/games/${game.id}/comments`, {
      body: { body: "hi" },
      method: "POST",
      user,
    });
  const attempts = await Promise.all(Array.from({ length: 101 }, () => post()));
  assert.equal(attempts.filter((r) => r.status === 201).length, 100);
  assert.equal(attempts.filter((r) => r.status === 429).length, 1);
  assert.equal(await status(post("user_other")), 201);
  // The Maker's Allowance is the account's own weekly bucket (src/storage.ts), which comments never touch.
  const { results } = await env.DB.prepare(
    "SELECT bucket FROM generation_limits ORDER BY bucket"
  ).all();
  assert.deepEqual(
    results.map((r) => r.bucket.split(":").slice(0, 2).join(":")),
    ["comment:user_other", "comment:user_owner"]
  );
});
test("week: ISO weeks start Monday 00:00 UTC, and the last days of a year can be the next year's", () => {
  assert.deepEqual(week(Date.parse("2026-10-29T12:00:00Z")), {
    key: "2026-W44",
    resetsAt: "2026-11-02T00:00:00.000Z",
  });
  assert.equal(week(Date.parse("2026-11-01T23:59:59Z")).key, "2026-W44");
  assert.equal(week(Date.parse("2026-11-02T00:00:00Z")).key, "2026-W45");
  assert.equal(week(Date.parse("2027-01-03T12:00:00Z")).key, "2026-W53");
  assert.equal(week(Date.parse("2027-01-04T00:00:00Z")).key, "2027-W01");
  assert.equal(week(Date.parse("2025-12-29T00:00:00Z")).key, "2026-W01");
});

test("pruneLimits: past days' comment quotas and past weeks' Allowances go; today's and this week's stay", async (t) => {
  const { env } = await setup(t);
  const buckets = [
    "comment:user_a:2026-10-29",
    "comment:user_a:2026-10-30",
    "user_a:2026-W43",
    "user_a:2026-W44",
    // The old daily build count's, from before ADR 0004.
    "user_b:2026-10-01",
  ];
  await env.DB.batch(
    buckets.map((bucket) =>
      env.DB.prepare(
        "INSERT INTO generation_limits (bucket, count) VALUES (?, 1)"
      ).bind(bucket)
    )
  );
  await pruneLimits(drizzle(env.DB), Date.parse("2026-10-30T00:00:00Z"));
  const { results } = await env.DB.prepare(
    "SELECT bucket FROM generation_limits ORDER BY bucket"
  ).all();
  assert.deepEqual(
    results.map((r) => r.bucket),
    ["comment:user_a:2026-10-30", "user_a:2026-W44"]
  );
});

test("allowance: a model call's cost lands in its Creator's week; at zero the Maker refuses chat and builds; a new week starts full", async (t) => {
  const { call, env, forwarded } = await setup(t);
  const db = drizzle(env.DB);
  const left = async (user) => {
    const { left: tokens } = await json(call("/api/allowance", { user }));
    return tokens;
  };
  const { resetsAt } = week();
  assert.deepEqual(await json(call("/api/allowance")), {
    left: 3_000_000,
    resetsAt,
    weekly: 3_000_000,
  });
  const created = await json(
    call("/api/drafts", { body: { text: "A dog game" }, method: "POST" })
  );

  // × 10,000,000, rounded up: $0.011 is 110,000 hopon tokens, not 110,001 from float noise; $0.00000001 is 1.
  await charge(db, created.id, 0.011);
  await charge(db, created.id, 1e-8);
  assert.equal(await left(), 3_000_000 - 110_001);

  // The last call may overshoot; the balance goes below zero, and both ways into the Maker refuse.
  await charge(db, created.id, 0.3);
  assert.equal(await left(), -110_001);
  const messages = () => forwarded.filter((f) => f.action === "message");
  const before = messages().length;
  const refused = await Promise.all(
    [
      call(`/api/drafts/${created.id}/messages`, {
        body: { text: "build it" },
        method: "POST",
      }),
      call("/api/drafts", { body: { text: "Another game" }, method: "POST" }),
    ].map(async (pending) => {
      const response = await pending;
      return { status: response.status, ...(await response.json()) };
    })
  );
  assert.deepEqual(
    refused.map(({ code, status: refusal }) => [refusal, code]),
    [
      [429, "allowance_used"],
      [429, "allowance_used"],
    ]
  );
  assert.equal(messages().length, before);

  // Another Creator's balance is untouched, and the Maker answers them.
  assert.equal(await left("user_other"), 3_000_000);
  assert.equal(
    await status(
      call("/api/drafts", {
        body: { text: "A cat game" },
        method: "POST",
        user: "user_other",
      })
    ),
    201
  );

  // A new week: what this one spent is last week's, and the Allowance is full again.
  await env.DB.prepare(
    "UPDATE generation_limits SET bucket = 'user_owner:2026-W01' WHERE bucket LIKE 'user_owner:%'"
  ).run();
  assert.equal(await left(), 3_000_000);
  assert.equal(
    await status(
      call(`/api/drafts/${created.id}/messages`, {
        body: { text: "build it" },
        method: "POST",
      })
    ),
    202
  );
});

test("comments: deleted by their author or the game's creator, hidden from everyone else", async (t) => {
  const { call, publish } = await setup(t);
  const gameId = await publish();
  const post = (user, body) =>
    json(
      call(`/api/games/${gameId}/comments`, {
        body: { body },
        method: "POST",
        user,
        username: user,
      })
    );
  const first = await post("user_fan", "first");
  const second = await post("user_fan", "second");
  const list = async (user) => {
    const { comments } = await json(
      call(`/api/games/${gameId}/comments`, { user })
    );
    return comments;
  };
  const forOwner = await list("user_owner");
  assert.deepEqual(
    forOwner.map((c) => [c.body, c.canDelete]),
    [
      ["second", true],
      ["first", true],
    ]
  );
  const forStranger = await list("user_stranger");
  assert.deepEqual(
    forStranger.map((c) => c.canDelete),
    [false, false]
  );
  const remove = (id, user) =>
    call(`/api/comments/${id}`, { method: "DELETE", user });
  assert.equal(await status(remove(first.id, "")), 401);
  assert.equal(await status(remove(first.id, "user_stranger")), 404);
  assert.equal(await status(remove(first.id, "user_owner")), 204);
  assert.equal(await status(remove(second.id, "user_fan")), 204);
  assert.equal(await status(remove(second.id, "user_fan")), 404);
  assert.deepEqual(await list(""), []);
});
test("comments: the Operator deletes any from /operator; in the app the Operator's account is anyone", async (t) => {
  const { call, operate } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const comment = await json(
    call(`/api/games/${game.id}/comments`, {
      body: { body: "rule-breaking" },
      method: "POST",
      user: "user_fan",
    })
  );
  const { comments } = await json(
    call(`/api/games/${game.id}/comments`, { user: "user_operator" })
  );
  assert.deepEqual(
    comments.map((c) => [c.canDelete, c.mine]),
    [[false, false]]
  );
  assert.equal(
    await status(
      call(`/api/comments/${comment.id}`, {
        method: "DELETE",
        user: "user_operator",
      })
    ),
    404
  );
  const deleted = await operate(`/operator/comments/${comment.id}/delete`, {
    method: "POST",
  });
  assert.equal(deleted.status, 303);
  assert.equal(deleted.headers.get("Location"), "/operator");
  const { comments: after } = await json(
    call(`/api/games/${game.id}/comments`)
  );
  assert.deepEqual(after, []);
  assert.equal(
    await status(
      operate(`/operator/comments/${comment.id}/delete`, { method: "POST" })
    ),
    404
  );
});
test("games: deleted by their creator or the Operator, with their files, likes, comments and saves; reports stay", async (t) => {
  const { call, count, env, operate, publish } = await setup(t);
  const published = async () => {
    const id = await publish({ files: { "game.js": "x", "index.html": "y" } });
    await Promise.all([
      ...["user_fan", "user_other"].flatMap((user) => [
        call(`/api/games/${id}/like`, { method: "PUT", user }),
        call(`/api/games/${id}/save`, { method: "PUT", user }),
        call(`/api/games/${id}/comments`, {
          body: { body: "nice" },
          method: "POST",
          user,
        }),
      ]),
      call(`/api/games/${id}/report`, {
        body: { reason: "spam" },
        method: "POST",
        user: "user_fan",
      }),
    ]);
    return id;
  };
  const remove = (id, user) =>
    call(`/api/games/${id}`, { method: "DELETE", user });
  const counts = () =>
    Promise.all(["games", "likes", "comments", "saves", "reports"].map(count));
  const mine = await published();
  const theirs = await published();
  const before = await counts();
  assert.equal(await status(remove(mine, "")), 401);
  assert.equal(await status(remove(mine, "user_fan")), 404);
  assert.equal(await status(remove(theirs, "user_operator")), 404);
  assert.deepEqual(await counts(), before);
  const stored = await filesIn(env, "games/");
  assert.equal(stored.length, 4);
  assert.equal(await status(remove(mine, "user_owner")), 204);
  assert.equal(await status(remove(mine, "user_owner")), 404);
  assert.deepEqual(await filesIn(env, `games/${mine}/`), []);
  assert.equal(
    await status(call(`/games/${mine}/index.html`, { user: "" })),
    404
  );
  assert.equal(
    await status(
      operate(`/operator/games/${theirs}/delete`, { method: "POST" })
    ),
    303
  );
  assert.deepEqual(await filesIn(env, "games/"), []);
  assert.equal(
    await status(call(`/games/${theirs}/index.html`, { user: "" })),
    404
  );
  assert.deepEqual(await counts(), [ORIGINALS, 0, 0, 0, 2]);
});
test("comments: counted in the feed", async (t) => {
  const { call } = await setup(t);
  const feed = async () => {
    const { games } = await json(call("/api/games", { user: "" }));
    return games[0];
  };
  const game = await feed();
  assert.equal(game.comments, 0);
  const posted = await json(
    call(`/api/games/${game.id}/comments`, {
      body: { body: "nice" },
      method: "POST",
    })
  );
  await call(`/api/games/${game.id}/comments`, {
    body: { body: "again" },
    method: "POST",
  });
  const afterPosts = await feed();
  assert.equal(afterPosts.comments, 2);
  await call(`/api/comments/${posted.id}`, { method: "DELETE" });
  const afterDelete = await feed();
  assert.equal(afterDelete.comments, 1);
});
test("saves: sign-in, games only, one per user, flagged in the feed, removable", async (t) => {
  const { call, env, count } = await setup(t);
  await assert.rejects(
    env.DB.prepare(
      "INSERT INTO saves(game_id, user) VALUES (999999, 'x')"
    ).run(),
    /FOREIGN KEY/u
  );
  const {
    games: [game],
  } = await json(call("/api/games"));
  const save = (id, options) =>
    call(`/api/games/${id}/save`, { method: "PUT", ...options });
  assert.equal(await status(save(game.id, { user: "" })), 401);
  assert.equal(
    await status(
      call(`/api/games/${game.id}/save`, { method: "DELETE", user: "" })
    ),
    401
  );
  assert.equal(await status(call("/api/saves", { user: "" })), 401);
  assert.equal(await status(call("/api/saves/count", { user: "" })), 401);
  assert.equal(await status(save(999_999)), 404);
  assert.deepEqual(await json(save(game.id)), { saved: true });
  assert.deepEqual(await json(save(game.id)), { saved: true });
  assert.equal(await count("saves"), 1);
  const feed = async (user) => {
    const { games } = await json(call("/api/games", { user }));
    return games[0];
  };
  assert.deepEqual(await feed(), { ...game, saved: true });
  assert.deepEqual(await feed(""), { ...game, saved: false });
  assert.deepEqual(await json(call("/api/saves/count")), { count: 1 });
  const { games, next } = await json(call("/api/saves"));
  assert.equal(next, null);
  assert.equal(games.length, 1);
  assert.equal(typeof games[0].saveId, "number");
  assert.deepEqual(games[0], { ...game, saveId: games[0].saveId, saved: true });
  const unsave = await call(`/api/games/${game.id}/save`, { method: "DELETE" });
  assert.deepEqual(await unsave.json(), { saved: false });
  assert.equal(await count("saves"), 0);
  assert.deepEqual(await json(call("/api/saves/count")), { count: 0 });
  assert.deepEqual(await json(call("/api/saves")), {
    games: [],
    next: null,
  });
});
test("saves: private to the person who saved", async (t) => {
  const { call } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  await call(`/api/games/${game.id}/save`, { method: "PUT", user: "user_a" });
  assert.deepEqual(await json(call("/api/saves", { user: "user_b" })), {
    games: [],
    next: null,
  });
  assert.deepEqual(await json(call("/api/saves/count", { user: "user_b" })), {
    count: 0,
  });
  const feed = async (user) => {
    const { games } = await json(call("/api/games", { user }));
    return games[0];
  };
  const forB = await feed("user_b");
  assert.equal(forB.saved, false);
  const forA = await feed("user_a");
  assert.equal(forA.saved, true);
  // Unsaving someone else's save only touches your own (absent) row.
  await call(`/api/games/${game.id}/save`, {
    method: "DELETE",
    user: "user_b",
  });
  assert.deepEqual(await json(call("/api/saves/count", { user: "user_a" })), {
    count: 1,
  });
});
test("saves: newest save first, 8 per page, no duplicates", async (t) => {
  const { call, env, owner } = await setup(t);
  const insert = env.DB.prepare(
    "INSERT INTO games(owner,title,description) VALUES (?,?,?)"
  );
  await env.DB.batch(
    Array.from({ length: 17 }, (_, i) => insert.bind(owner, `game ${i}`, ""))
  );
  // Save newest game first, then the older ones: save order, not game order, decides the list.
  const { results } = await env.DB.prepare(
    "SELECT id FROM games ORDER BY id DESC"
  ).all();
  const ids = results.map((r) => r.id);
  for (const id of ids) {
    // oxlint-disable-next-line no-await-in-loop -- save order is what the list is sorted by
    await call(`/api/games/${id}/save`, { method: "PUT" });
  }
  const page = (query = "") => json(call(`/api/saves${query}`));
  const first = await page();
  const second = await page(`?before=${first.next}`);
  const third = await page(`?before=${second.next}`);
  assert.equal(third.next, null);
  const listed = [...first.games, ...second.games, ...third.games];
  assert.deepEqual(
    listed.map((g) => g.id),
    ids.toReversed()
  );
  assert.equal(first.games.length, 8);
  assert.ok(listed.every((g) => g.saved));
  assert.equal(first.next, first.games[7].saveId);
  assert.equal(await status(call("/api/saves?before=abc")), 400);
  // The saved feed opens at a tapped game with before = its saveId + 1.
  const tapped = second.games.at(2);
  const reopened = await page(`?before=${tapped.saveId + 1}`);
  assert.equal(reopened.games[0].id, tapped.id);
});
test("reports: someone else's game, a known reason, signed in", async (t) => {
  const { call, count, publish } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const report = (id, reason, options) =>
    call(`/api/games/${id}/report`, {
      body: { reason },
      method: "POST",
      ...options,
    });
  assert.equal(await status(report(game.id, "spam", { user: "" })), 401);
  assert.equal(await status(report(game.id, "boring")), 400);
  assert.equal(await status(report(game.id)), 400);
  assert.equal(await status(report(999_999, "spam")), 404);
  const own = await report(await publish(), "spam");
  assert.equal(own.status, 400);
  assert.deepEqual(await own.json(), {
    error: "You can't report your own game.",
  });
  assert.equal(await count("reports"), 0);
});
test("reports: one open snapshot per person and game, which outlives the game", async (t) => {
  const { call, count, env, settled } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const report = () =>
    call(`/api/games/${game.id}/report`, {
      body: { reason: "hate" },
      method: "POST",
    });
  assert.equal(await status(report()), 204);
  assert.equal(await status(report()), 204);
  await settled();
  const { results } = await env.DB.prepare("SELECT * FROM reports").all();
  assert.equal(results.length, 1);
  assert.deepEqual(
    { ...results[0], created_at: undefined, id: undefined },
    {
      body: null,
      closed_at: null,
      closed_how: null,
      comment_id: null,
      created_at: undefined,
      creator: "hopon",
      description: game.description,
      game_id: game.id,
      handle: "hopon",
      id: undefined,
      reason: "hate",
      reporter: "user_owner",
      status: "open",
      title: game.title,
    }
  );
  // No FK, so deleting the game later leaves the report.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM games WHERE id = ?").bind(game.id),
  ]);
  assert.equal(await count("reports"), 1);
});
test("reports: the game disappears for the reporter only, from the feed, Saved, its count and the saved feed", async (t) => {
  const { call } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  for (const user of ["user_owner", "user_other"]) {
    // oxlint-disable-next-line no-await-in-loop -- two users, order doesn't matter
    await call(`/api/games/${game.id}/save`, { method: "PUT", user });
  }
  const {
    games: [{ saveId }],
  } = await json(call("/api/saves"));
  await call(`/api/games/${game.id}/report`, {
    body: { reason: "age" },
    method: "POST",
  });
  const ids = async (path, user) => {
    const { games } = await json(call(path, { user }));
    return games.map((g) => g.id);
  };
  const shows = async (path, user) => {
    const listed = await ids(path, user);
    return listed.includes(game.id);
  };
  assert.equal(await shows("/api/games"), false);
  assert.equal(await shows("/api/saves"), false);
  assert.equal(await shows(`/api/saves?before=${saveId + 1}`), false);
  assert.equal(await shows("/api/games", "user_other"), true);
  assert.equal(await shows("/api/games", ""), true);
  assert.equal(await shows("/api/saves", "user_other"), true);
  assert.deepEqual(await json(call("/api/saves/count")), { count: 0 });
  assert.deepEqual(
    await json(call("/api/saves/count", { user: "user_other" })),
    { count: 1 }
  );
});
test("reports: each new report POSTs the reason and snapshot to the Operator; a failed send keeps the report", async (t) => {
  const { call, count, env, settled } = await setup(t);
  env.OPERATOR_WEBHOOK_URL = "https://operator.test/hook";
  const sent = [];
  const realFetch = globalThis.fetch;
  let down = false;
  t.mock.method(globalThis, "fetch", (url, init) => {
    if (String(url) !== env.OPERATOR_WEBHOOK_URL) {
      return realFetch(url, init);
    }
    sent.push(JSON.parse(init.body));
    return down
      ? Promise.reject(new Error("webhook down"))
      : Promise.resolve(new Response(null, { status: 200 }));
  });
  const {
    games: [game],
  } = await json(call("/api/games"));
  const report = (user) =>
    call(`/api/games/${game.id}/report`, {
      body: { reason: "spam" },
      method: "POST",
      user,
    });
  assert.equal(await status(report("user_a")), 204);
  assert.equal(await status(report("user_a")), 204);
  await settled();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Spam or scam/u);
  assert.match(sent[0].text, new RegExp(game.title, "u"));
  assert.match(sent[0].text, /@hopon/u);
  assert.match(sent[0].text, /user_a/u);
  assert.equal(
    sent[0].text.split("\n").at(-1),
    `https://hopon.test/operator#game-${game.id}`
  );
  down = true;
  assert.equal(await status(report("user_b")), 204);
  await settled();
  assert.equal(sent.length, 2);
  assert.equal(await count("reports"), 2);
});
test("feed: `mine` marks the viewer's own games", async (t) => {
  const { call, publish } = await setup(t);
  await publish();
  const mine = async (user) => {
    const { games } = await json(call("/api/games", { user }));
    return games.map((g) => g.mine);
  };
  assert.deepEqual(await mine("user_owner"), [true, false, false, false]);
  assert.deepEqual(await mine("user_other"), [false, false, false, false]);
  assert.deepEqual(await mine(""), [false, false, false, false]);
});
// A published game by user_owner with a comment from user_fan on it.
const commented = async ({ call, publish }) => {
  const gameId = await publish();
  const comment = await json(
    call(`/api/games/${gameId}/comments`, {
      body: { body: "you stink" },
      method: "POST",
      user: "user_fan",
      username: "fan",
    })
  );
  const reportComment = (reason, options) =>
    call(`/api/comments/${comment.id}/report`, {
      body: { reason },
      method: "POST",
      ...options,
    });
  return { comment, gameId, reportComment };
};
test("comment reports: someone else's comment, even on your own game; never your own", async (t) => {
  const { call, count, env, publish } = await setup(t);
  const { comment, gameId, reportComment } = await commented({ call, publish });
  assert.equal(await status(reportComment("spam", { user: "" })), 401);
  assert.equal(await status(reportComment("boring")), 400);
  assert.equal(
    await status(
      call("/api/comments/999999/report", {
        body: { reason: "spam" },
        method: "POST",
      })
    ),
    404
  );
  const own = await reportComment("spam", { user: "user_fan" });
  assert.equal(own.status, 400);
  assert.deepEqual(await own.json(), {
    error: "You can't report your own comment.",
  });
  assert.equal(await count("reports"), 0);
  // user_owner made the game, and can report a comment left on it.
  assert.equal(await status(reportComment("hate")), 204);
  assert.equal(await status(reportComment("hate")), 204);
  const { results } = await env.DB.prepare("SELECT * FROM reports").all();
  assert.deepEqual(
    results.map((r) => ({ ...r, created_at: undefined, id: undefined })),
    [
      {
        body: "you stink",
        closed_at: null,
        closed_how: null,
        comment_id: comment.id,
        created_at: undefined,
        creator: "user_fan",
        description: null,
        game_id: gameId,
        handle: "fan",
        id: undefined,
        reason: "hate",
        reporter: "user_owner",
        status: "open",
        title: null,
      },
    ]
  );
  // Reporting the game itself is a separate report.
  assert.equal(
    await status(
      call(`/api/games/${gameId}/report`, {
        body: { reason: "spam" },
        method: "POST",
        user: "user_fan",
      })
    ),
    204
  );
  assert.equal(await count("reports"), 2);
});
test("comment reports: the comment disappears for the reporter only; its game stays", async (t) => {
  const { call, publish } = await setup(t);
  const { comment, gameId, reportComment } = await commented({ call, publish });
  await call(`/api/games/${gameId}/save`, { method: "PUT" });
  await reportComment("hate");
  const bodies = async (user) => {
    const { comments } = await json(
      call(`/api/games/${gameId}/comments`, { user })
    );
    return comments.map((c) => c.body);
  };
  assert.deepEqual(await bodies("user_owner"), []);
  assert.deepEqual(await bodies("user_other"), [comment.body]);
  assert.deepEqual(await bodies(""), [comment.body]);
  const { games } = await json(call("/api/games"));
  assert.equal(games.find((g) => g.id === gameId)?.comments, 1);
  const saved = await json(call("/api/saves"));
  assert.deepEqual(
    saved.games.map((g) => g.id),
    [gameId]
  );
  assert.deepEqual(await json(call("/api/saves/count")), { count: 1 });
});
test("comment reports: each new one POSTs the reason and snapshot to the Operator", async (t) => {
  const { call, env, publish, settled } = await setup(t);
  env.OPERATOR_WEBHOOK_URL = "https://operator.test/hook";
  const sent = [];
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, init) => {
    if (String(url) !== env.OPERATOR_WEBHOOK_URL) {
      return realFetch(url, init);
    }
    sent.push(JSON.parse(init.body));
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  const { comment, gameId, reportComment } = await commented({ call, publish });
  await reportComment("age");
  await reportComment("age");
  await settled();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Not suitable for ages 13\+/u);
  assert.match(
    sent[0].text,
    new RegExp(`Comment ${comment.id} on game ${gameId}`, "u")
  );
  assert.match(sent[0].text, /you stink/u);
  assert.match(sent[0].text, /@fan \(user_fan\)/u);
  assert.equal(
    sent[0].text.split("\n").at(-1),
    `https://hopon.test/operator#comment-${comment.id}`
  );
});
test("comments: `mine` marks the viewer's own comments", async (t) => {
  const { call, publish } = await setup(t);
  const { gameId } = await commented({ call, publish });
  const mine = async (user) => {
    const { comments } = await json(
      call(`/api/games/${gameId}/comments`, { user })
    );
    return comments.map((c) => c.mine);
  };
  assert.deepEqual(await mine("user_fan"), [true]);
  assert.deepEqual(await mine("user_owner"), [false]);
  assert.deepEqual(await mine(""), [false]);
});
const OPEN = { closed: 0, closed_how: null, status: "open" };
const closed = (how) => ({ closed: 1, closed_how: how, status: "closed" });
// The report rows on a `commented` game and on its comment.
const gameReport = ({ gameId }) => ({ comment_id: null, game_id: gameId });
const commentReport = ({ comment, gameId }) => ({
  comment_id: comment.id,
  game_id: gameId,
});
// Each report's target, status, and how it closed (`closed_at` reduced to whether it's set), oldest first.
const reportRows = async (env) => {
  const { results } = await env.DB.prepare(
    "SELECT game_id, comment_id, status, closed_how, closed_at IS NOT NULL AS closed FROM reports ORDER BY id"
  ).all();
  return results.map((r) => ({ ...r }));
};
const ENTITIES = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};
// The queue page as the Operator reads it: the open count, and each target's anchor, its text (tags dropped, the time
// as DATE) and where its links and forms go, in page order.
const queue = async (operate) => {
  const response = await operate("/operator");
  assert.equal(response.status, 200);
  const page = await response.text();
  return {
    count: Number(/<p>(?<n>\d+) open<\/p>/u.exec(page).groups.n),
    page,
    targets: [
      ...page.matchAll(
        /<section id="(?<id>[^"]+)">(?<card>[\s\S]*?)<\/section>/gu
      ),
    ].map(({ groups: { card, id } }) => ({
      actions: [...card.matchAll(/(?:href|action)="(?<to>[^"]+)"/gu)].map(
        (m) => m.groups.to
      ),
      id,
      text: card
        .replaceAll(/<[^>]+>/gu, " ")
        .replaceAll(/&(?:#39|amp|gt|lt|quot);/gu, (entity) => ENTITIES[entity])
        .replaceAll(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/gu, "DATE")
        .replaceAll(/\s+/gu, " ")
        .trim(),
    })),
  };
};
// Stands in for Clerk's Backend API: records each call, answers a user lookup with `roles[id]` as its
// `public_metadata.role` and whether it's banned, bans on `POST …/ban`, and refuses everything while `clerk.down`.
const stubClerk = (t, roles = {}) => {
  const clerk = { banned: new Set(), calls: [], down: false };
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, init = {}) => {
    const { href, pathname } = new URL(String(url));
    if (!href.startsWith("https://api.clerk.com/")) {
      return realFetch(url, init);
    }
    clerk.calls.push({
      auth: new Headers(init.headers).get("Authorization"),
      method: init.method ?? "GET",
      path: pathname,
    });
    if (clerk.down) {
      return Promise.resolve(Response.json({ errors: [] }, { status: 500 }));
    }
    const id = pathname.split("/").at(3);
    if (pathname.endsWith("/ban")) {
      clerk.banned.add(id);
    }
    return Promise.resolve(
      Response.json({
        banned: clerk.banned.has(id),
        id,
        public_metadata: { role: roles[id] },
      })
    );
  });
  return clerk;
};
test("operator: every /operator route asks for the password, and the old /api/ Operator routes are gone", async (t) => {
  const { call, env, operate, publish } = await setup(t);
  const posted = await commented({ call, publish });
  const { comment, gameId, reportComment } = posted;
  await reportComment("spam", { user: "user_a" });
  const routes = [
    ["GET", "/operator"],
    ["GET", `/operator/games/${gameId}/delete`],
    ["GET", `/operator/comments/${comment.id}/ban`],
    ["POST", `/operator/games/${gameId}/dismiss`],
    ["POST", `/operator/comments/${comment.id}/dismiss`],
    ["POST", `/operator/games/${gameId}/delete`],
    ["POST", `/operator/comments/${comment.id}/ban`],
  ];
  const challenges = (password) =>
    Promise.all(
      routes.map(async ([method, path]) => {
        const response = await operate(path, { method, password });
        return [
          method,
          path,
          response.status,
          response.headers.get("WWW-Authenticate"),
        ];
      })
    );
  const refused = routes.map(([method, path]) => [
    method,
    path,
    401,
    'Basic realm="hopon Operator"',
  ]);
  assert.deepEqual(await challenges(null), refused);
  assert.deepEqual(await challenges("wrong"), refused);
  assert.deepEqual(await challenges(`${OPERATOR_PASSWORD}x`), refused);
  // With the secret unset or empty, nobody gets in, whatever they send.
  for (const unset of [undefined, ""]) {
    env.OPERATOR_PASSWORD = unset;
    // oxlint-disable-next-line no-await-in-loop -- `env` changes between rounds
    assert.deepEqual(await challenges(OPERATOR_PASSWORD), refused);
    // oxlint-disable-next-line no-await-in-loop -- see above
    assert.deepEqual(await challenges(""), refused);
  }
  env.OPERATOR_PASSWORD = OPERATOR_PASSWORD;
  assert.deepEqual(await reportRows(env), [
    { ...commentReport(posted), ...OPEN },
  ]);
  assert.equal(await status(operate("/operator")), 200);
  // Clerk no longer knows who the Operator is, so no account reaches these.
  const gone = [
    ["GET", "/api/reports"],
    ["GET", "/api/reports/count"],
    ["POST", `/api/games/${gameId}/dismiss`],
    ["POST", `/api/comments/${comment.id}/dismiss`],
    ["POST", `/api/games/${gameId}/ban`],
    ["POST", `/api/comments/${comment.id}/ban`],
  ];
  assert.deepEqual(
    await Promise.all(
      gone.map(([method, path]) =>
        status(call(path, { method, user: "user_operator" }))
      )
    ),
    gone.map(() => 404)
  );
});
test("operator: a write from another site is refused, even with the password, and changes nothing", async (t) => {
  const { call, count, env, operate, publish } = await setup(t);
  env.CLERK_SECRET_KEY = "sk_test_hopon";
  const clerk = stubClerk(t);
  const { comment, gameId, reportComment } = await commented({ call, publish });
  await reportComment("hate", { user: "user_a" });
  await call(`/api/games/${gameId}/report`, {
    body: { reason: "spam" },
    method: "POST",
    user: "user_a",
  });
  const before = await reportRows(env);
  const counts = () => Promise.all(["games", "comments"].map(count));
  const untouched = await counts();
  const forged = {
    method: "POST",
    origin: "https://evil.test",
    site: "cross-site",
  };
  const writes = [
    `/operator/games/${gameId}/dismiss`,
    `/operator/comments/${comment.id}/dismiss`,
    `/operator/games/${gameId}/delete`,
    `/operator/comments/${comment.id}/delete`,
    `/operator/games/${gameId}/ban`,
    `/operator/comments/${comment.id}/ban`,
  ];
  assert.deepEqual(
    await Promise.all(writes.map((path) => status(operate(path, forged)))),
    writes.map(() => 403)
  );
  assert.deepEqual(await reportRows(env), before);
  assert.deepEqual(await counts(), untouched);
  assert.deepEqual(clerk.calls, []);
});
// A queue card's Delete, Ban and Dismiss routes.
const actions = (kind, id) =>
  ["delete", "ban", "dismiss"].map(
    (action) => `/operator/${kind}s/${id}/${action}`
  );
test("operator: the queue lists open reports by target, oldest first, with reasons and counts, and marks deleted content", async (t) => {
  const { call, env, operate, publish } = await setup(t);
  const {
    games: [newer, older],
  } = await json(call("/api/games"));
  const reportGame = (game, reason, user) =>
    call(`/api/games/${game.id}/report`, {
      body: { reason },
      method: "POST",
      user,
    });
  await reportGame(older, "spam", "user_a");
  const { comment, gameId, reportComment } = await commented({ call, publish });
  await reportComment("hate");
  await reportGame(older, "age", "user_b");
  await reportGame(older, "spam", "user_c");
  await reportGame(newer, "other", "user_a");
  // Content can be gone while its reports are still open; the queue says so.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM games WHERE id = ?").bind(newer.id),
  ]);
  const { count, targets } = await queue(operate);
  assert.equal(count, 3);
  assert.deepEqual(targets, [
    {
      actions: [`/games/${older.id}/index.html`, ...actions("game", older.id)],
      id: `game-${older.id}`,
      text: `Game · @hopon · DATE UTC ${older.title} ${older.description} Not suitable for ages 13+ × 1 Spam or scam × 2 Play Delete Ban Dismiss`,
    },
    {
      actions: actions("comment", comment.id),
      id: `comment-${comment.id}`,
      text: `Comment on game ${gameId} · @fan · DATE UTC you stink Hateful or harassing × 1 Delete Ban Dismiss`,
    },
    {
      actions: actions("game", newer.id).slice(1),
      id: `game-${newer.id}`,
      text: `Game · @hopon · DATE UTC ${newer.title} ${newer.description} Content deleted Something else × 1 Ban Dismiss`,
    },
  ]);
});
test("operator: pages escape snapshots, run no script, can't be framed, and Delete asks first", async (t) => {
  const { call, operate } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const comment = await json(
    call(`/api/games/${game.id}/comments`, {
      body: { body: `<script>alert("hi")</script> & <b>bold</b>` },
      method: "POST",
      user: "user_fan",
    })
  );
  await call(`/api/comments/${comment.id}/report`, {
    body: { reason: "spam" },
    method: "POST",
  });
  await call(`/api/games/${game.id}/report`, {
    body: { reason: "spam" },
    method: "POST",
  });
  const response = await operate("/operator");
  assert.equal(
    response.headers.get("Content-Security-Policy"),
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  const page = await response.text();
  assert.doesNotMatch(page, /<script|<b>/u);
  assert.match(
    page,
    /<p>&lt;script&gt;alert\(&quot;hi&quot;\)&lt;\/script&gt; &amp; &lt;b&gt;bold&lt;\/b&gt;<\/p>/u
  );
  const confirm = async (path) => {
    const answer = await operate(path);
    assert.equal(answer.status, 200);
    assert.equal(
      answer.headers.get("Content-Security-Policy"),
      response.headers.get("Content-Security-Policy")
    );
    return answer.text();
  };
  const deleteGame = await confirm(`/operator/games/${game.id}/delete`);
  assert.match(deleteGame, /<h1>Delete game\?<\/h1>/u);
  assert.match(
    deleteGame,
    /It&#39;s gone for everyone, with its likes, comments and saves\./u
  );
  assert.match(
    deleteGame,
    new RegExp(
      `<form method="post" action="/operator/games/${game.id}/delete">\\s*<button>Delete</button>\\s*</form>`,
      "u"
    )
  );
  assert.match(
    deleteGame,
    new RegExp(`href="/operator#game-${game.id}">Cancel</a>`, "u")
  );
  const deleteComment = await confirm(
    `/operator/comments/${comment.id}/delete`
  );
  assert.match(deleteComment, /<h1>Delete comment\?<\/h1>/u);
  assert.match(deleteComment, /<p>It&#39;s gone for everyone\.<\/p>/u);
  // Asking changes nothing.
  const after = await queue(operate);
  assert.equal(after.count, 2);
});
test("operator: Dismiss closes every open report on the target and leaves the content up, still hidden from its reporters", async (t) => {
  const { call, env, operate } = await setup(t);
  const {
    games: [game],
  } = await json(call("/api/games"));
  const comment = await json(
    call(`/api/games/${game.id}/comments`, {
      body: { body: "spam spam" },
      method: "POST",
      user: "user_fan",
    })
  );
  for (const [path, user] of [
    [`/api/games/${game.id}/report`, "user_a"],
    [`/api/games/${game.id}/report`, "user_b"],
    [`/api/comments/${comment.id}/report`, "user_a"],
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- report ids follow this order
    await call(path, { body: { reason: "spam" }, method: "POST", user });
  }
  const dismiss = (path) => operate(path, { method: "POST" });
  const dismissed = await dismiss(`/operator/games/${game.id}/dismiss`);
  assert.equal(dismissed.status, 303);
  assert.equal(dismissed.headers.get("Location"), "/operator");
  // Dismissing the game leaves the reports on its comments open.
  const onGame = { comment_id: null, game_id: game.id };
  const onComment = { comment_id: comment.id, game_id: game.id };
  assert.deepEqual(await reportRows(env), [
    { ...onGame, ...closed("dismissed") },
    { ...onGame, ...closed("dismissed") },
    { ...onComment, ...OPEN },
  ]);
  const { targets } = await queue(operate);
  assert.deepEqual(
    targets.map((target) => target.id),
    [`comment-${comment.id}`]
  );
  assert.equal(
    await status(dismiss(`/operator/comments/${comment.id}/dismiss`)),
    303
  );
  assert.equal(
    await status(dismiss(`/operator/comments/${comment.id}/dismiss`)),
    303
  );
  const empty = await queue(operate);
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.targets, []);
  assert.match(empty.page, /<p>No open reports\.<\/p>/u);
  const feed = async (user) => {
    const { games } = await json(call("/api/games", { user }));
    return games.some((g) => g.id === game.id);
  };
  const comments = async (user) => {
    const page = await json(call(`/api/games/${game.id}/comments`, { user }));
    return page.comments.length;
  };
  assert.equal(await feed("user_other"), true);
  assert.equal(await feed("user_a"), false);
  assert.equal(await comments("user_other"), 1);
  assert.equal(await comments("user_a"), 0);
});
test("operator: Delete closes the content's open reports as deleted, its poster deleting it as creator_deleted", async (t) => {
  const { call, env, operate, publish } = await setup(t);
  // Games by user_owner, each with a comment by user_fan; every game and comment reported once.
  const first = await commented({ call, publish });
  const second = await commented({ call, publish });
  const third = await commented({ call, publish });
  for (const { gameId, reportComment } of [first, second, third]) {
    // oxlint-disable-next-line no-await-in-loop -- report ids follow this order
    await call(`/api/games/${gameId}/report`, {
      body: { reason: "spam" },
      method: "POST",
      user: "user_a",
    });
    // oxlint-disable-next-line no-await-in-loop -- see above
    await reportComment("hate", { user: "user_a" });
  }
  const remove = (path) => operate(path, { method: "POST" });
  // The Operator deletes the first game: its report and its comment's report close as deleted.
  const deleted = await remove(`/operator/games/${first.gameId}/delete`);
  assert.equal(deleted.status, 303);
  assert.equal(deleted.headers.get("Location"), "/operator");
  // The creator deletes the second game themselves.
  assert.equal(
    await status(call(`/api/games/${second.gameId}`, { method: "DELETE" })),
    204
  );
  assert.deepEqual(await reportRows(env), [
    { ...gameReport(first), ...closed("deleted") },
    { ...commentReport(first), ...closed("deleted") },
    { ...gameReport(second), ...closed("creator_deleted") },
    { ...commentReport(second), ...closed("creator_deleted") },
    { ...gameReport(third), ...OPEN },
    { ...commentReport(third), ...OPEN },
  ]);
  // A comment deleted by its commenter, one by the Operator, and one by the Creator of the game it's on.
  const fourth = await commented({ call, publish });
  await fourth.reportComment("spam", { user: "user_a" });
  const fifth = await commented({ call, publish });
  await fifth.reportComment("spam", { user: "user_a" });
  assert.equal(
    await status(
      call(`/api/comments/${third.comment.id}`, {
        method: "DELETE",
        user: "user_fan",
      })
    ),
    204
  );
  assert.equal(
    await status(remove(`/operator/comments/${fourth.comment.id}/delete`)),
    303
  );
  assert.equal(
    await status(
      call(`/api/comments/${fifth.comment.id}`, { method: "DELETE" })
    ),
    204
  );
  const after = await reportRows(env);
  assert.deepEqual(after.slice(4), [
    { ...gameReport(third), ...OPEN },
    { ...commentReport(third), ...closed("creator_deleted") },
    { ...commentReport(fourth), ...closed("deleted") },
    { ...commentReport(fifth), ...closed("creator_deleted") },
  ]);
  const { targets } = await queue(operate);
  assert.deepEqual(
    targets.map((target) => target.id),
    [`game-${third.gameId}`]
  );
});
test("ban: Clerk bans the poster first, then all their published games and comments go, their reports closing as banned", async (t) => {
  const { call, count, draft, env, operate, publish } = await setup(t);
  env.CLERK_SECRET_KEY = "sk_test_hopon";
  const clerk = stubClerk(t);
  const fan = { user: "user_fan", username: "fan" };
  // user_fan comments on user_owner's game, and publishes a game of their own that others like, save and comment on.
  const { comment, gameId, reportComment } = await commented({ call, publish });
  const theirs = { id: await publish(fan) };
  const fanDraft = await draft({ user: "user_fan" });
  const reply = await json(
    call(`/api/games/${theirs.id}/comments`, {
      body: { body: "nice" },
      method: "POST",
    })
  );
  for (const kind of ["like", "save"]) {
    // oxlint-disable-next-line no-await-in-loop -- a few setup writes
    await call(`/api/games/${theirs.id}/${kind}`, { method: "PUT" });
    // oxlint-disable-next-line no-await-in-loop -- see above
    await call(`/api/games/${gameId}/${kind}`, { method: "PUT", ...fan });
  }
  // What user_fan did as a viewer stays: a report they filed and a block.
  await call(`/api/games/${gameId}/report`, {
    body: { reason: "other" },
    method: "POST",
    ...fan,
  });
  await env.DB.prepare(
    "INSERT INTO blocks(blocker, blocked, handle) VALUES('user_fan', 'user_c', 'c')"
  ).run();
  await reportComment("hate", { user: "user_a" });
  await call(`/api/games/${theirs.id}/report`, {
    body: { reason: "spam" },
    method: "POST",
    user: "user_a",
  });
  await call(`/api/comments/${reply.id}/report`, {
    body: { reason: "spam" },
    method: "POST",
    user: "user_a",
  });
  const ban = (path = `/operator/comments/${comment.id}/ban`) =>
    operate(path, { method: "POST" });
  const before = await reportRows(env);
  const counts = () =>
    Promise.all(
      ["games", "comments", "likes", "saves", "blocks"].map((table) =>
        count(table)
      )
    );
  const untouched = await counts();

  // Clerk refuses: nothing in D1 changes.
  clerk.down = true;
  const refused = await ban();
  assert.equal(refused.status, 502);
  assert.deepEqual(await refused.json(), {
    error: "Couldn't ban this account just now. Please try again.",
  });
  assert.deepEqual(await counts(), untouched);
  assert.deepEqual(await reportRows(env), before);
  clerk.down = false;

  // Clerk bans, then D1 fails: running the Ban again finishes it.
  const db = env.DB;
  env.DB = {
    batch: () => Promise.reject(new Error("D1 down")),
    prepare: (sql) => db.prepare(sql),
  };
  clerk.calls.length = 0;
  assert.equal(await status(ban()), 500);
  env.DB = db;
  assert.deepEqual(await counts(), untouched);
  assert.deepEqual(clerk.calls, [
    { auth: "Bearer sk_test_hopon", method: "GET", path: "/v1/users/user_fan" },
    {
      auth: "Bearer sk_test_hopon",
      method: "POST",
      path: "/v1/users/user_fan/ban",
    },
  ]);
  // Already banned in Clerk, so only the lookup.
  clerk.calls.length = 0;
  const banned = await ban();
  assert.equal(banned.status, 303);
  assert.equal(banned.headers.get("Location"), "/operator");
  assert.deepEqual(
    clerk.calls.map(({ method, path }) => [method, path]),
    [["GET", "/v1/users/user_fan"]]
  );

  // Their game's files went with it; their Draft stays.
  assert.equal(await count("games"), ORIGINALS + 1);
  assert.deepEqual(await filesIn(env, "games/"), [
    `games/${gameId}/index.html`,
  ]);
  assert.deepEqual(await draftIds(call, "user_fan"), [fanDraft]);
  assert.deepEqual(await filesIn(env, `drafts/${fanDraft}/`), [
    `drafts/${fanDraft}/1/index.html`,
  ]);
  const left = async (sql) => {
    const rows = await env.DB.prepare(sql).all();
    return rows.results.map((r) => ({ ...r }));
  };
  assert.deepEqual(await left("SELECT id FROM comments"), []);
  assert.deepEqual(await left("SELECT game_id, user FROM likes"), [
    { game_id: gameId, user: "user_fan" },
  ]);
  assert.deepEqual(await left("SELECT game_id, user FROM saves"), [
    { game_id: gameId, user: "user_fan" },
  ]);
  assert.equal(await count("blocks"), 1);
  // Reports on their content close as banned, including one on someone else's comment on their game.
  // The one they filed stays open.
  assert.deepEqual(await reportRows(env), [
    { comment_id: null, game_id: gameId, ...OPEN },
    { ...commentReport({ comment, gameId }), ...closed("banned") },
    { comment_id: null, game_id: theirs.id, ...closed("banned") },
    { comment_id: reply.id, game_id: theirs.id, ...closed("banned") },
  ]);

  // Content already gone, the snapshot still names whom to Ban; again changes nothing.
  assert.equal(await status(ban(`/operator/games/${theirs.id}/ban`)), 303);
  assert.equal(await count("reports"), 4);
});
test("ban: asks first, bans an account whatever its Clerk role, and only a reported poster", async (t) => {
  const { call, env, operate, publish } = await setup(t);
  env.CLERK_SECRET_KEY = "sk_test_hopon";
  const clerk = stubClerk(t, { user_fan: "operator" });
  const posted = await commented({ call, publish });
  const { comment, reportComment } = posted;
  const path = `/operator/comments/${comment.id}/ban`;
  assert.equal(await status(operate(path)), 404);
  assert.equal(await status(operate(path, { method: "POST" })), 404);
  await reportComment("spam", { user: "user_a" });
  const confirm = await operate(path);
  assert.equal(confirm.status, 200);
  const page = await confirm.text();
  assert.match(page, /<h1>Ban @fan\?<\/h1>/u);
  assert.match(
    page,
    /They can&#39;t sign in again, and all their published games and comments are deleted for everyone\./u
  );
  assert.match(
    page,
    new RegExp(
      `<form method="post" action="${path}">\\s*<button>Ban</button>\\s*</form>`,
      "u"
    )
  );
  assert.match(
    page,
    new RegExp(`href="/operator#comment-${comment.id}">Cancel</a>`, "u")
  );
  // Asking changes nothing.
  assert.deepEqual(clerk.calls, []);
  assert.equal(await status(operate(path, { method: "POST" })), 303);
  assert.deepEqual(
    clerk.calls.map(({ method, path: called }) => [method, called]),
    [
      ["GET", "/v1/users/user_fan"],
      ["POST", "/v1/users/user_fan/ban"],
    ]
  );
  assert.deepEqual(await reportRows(env), [
    { ...commentReport(posted), ...closed("banned") },
  ]);
});

test("runtime: /runtime/v2.js and /dom/v1.js are the maker's scaffolds, long-cached, signed out", async (t) => {
  const { call } = await setup(t);
  const runtime = await call("/runtime/v2.js", { user: "" });
  assert.equal(runtime.status, 200);
  assert.match(runtime.headers.get("Content-Type"), /^text\/javascript/u);
  assert.equal(
    runtime.headers.get("Cache-Control"),
    "public, max-age=31536000, immutable"
  );
  const code = await runtime.text();
  assert.equal(
    code,
    JSON.parse(
      readFileSync(new URL("../src/runtime/v2.json", import.meta.url), "utf-8")
    )
  );
  // LittleJS and the scaffold, with the feed's bridge.
  assert.match(code, /engineInit/u);
  assert.match(code, /"pause"/u);
  // The plain-DOM scaffold, the box's bytes.
  const dom = await call("/dom/v1.js", { user: "" });
  assert.equal(dom.status, 200);
  assert.match(dom.headers.get("Content-Type"), /^text\/javascript/u);
  assert.equal(
    dom.headers.get("Cache-Control"),
    "public, max-age=31536000, immutable"
  );
  assert.equal(
    await dom.text(),
    readFileSync(new URL("../../maker/image/dom.js", import.meta.url), "utf-8")
  );
  // v1 changed before any Creator's Game used it, so it's gone rather than stale.
  for (const gone of ["/runtime/v1.js", "/runtime/v3.js"]) {
    // oxlint-disable-next-line no-await-in-loop -- two requests
    assert.equal(await status(call(gone, { user: "" })), 404);
  }
});

test("pages: /terms has the Rules, /support the contact address and /privacy the policy, signed out", async (t) => {
  const { call } = await setup(t);
  const terms = await call("/terms", { user: "" });
  assert.equal(terms.status, 200);
  assert.match(terms.headers.get("Content-Type"), /^text\/html/u);
  const rules = await terms.text();
  assert.match(rules, /<title>Terms of Use<\/title>/u);
  assert.match(rules, /zero tolerance/iu);
  assert.match(rules, /within 24 hours/u);
  assert.match(rules, /mailto:support@gethopon\.app/u);
  const support = await call("/support", { user: "" });
  assert.equal(support.status, 200);
  const page = await support.text();
  assert.match(page, /mailto:support@gethopon\.app/u);
  assert.match(page, /href="\/terms"/u);
  const privacy = await call("/privacy", { user: "" });
  assert.equal(privacy.status, 200);
  assert.match(await privacy.text(), /<title>Privacy Policy<\/title>/u);
});

// #125's copy: the app's AI sheet links to /privacy#maker, which names who processes messages.
test("pages: /privacy#maker names the Maker's processors and the Terms screen every message to the Maker", async (t) => {
  const { call } = await setup(t);
  const privacy = await call("/privacy", { user: "" }).then((r) => r.text());
  assert.match(privacy, /<h2 id="maker">The Maker<\/h2>/u);
  for (const company of ["Anthropic", "Cloudflare"]) {
    assert.match(privacy, new RegExp(`<strong>${company}</strong>`, "u"));
  }
  assert.match(privacy, /within 30 days/u);
  assert.match(privacy, /your chats with the Maker/iu);
  assert.match(privacy, /and all your Drafts with their chats/u);
  assert.doesNotMatch(privacy, /Workers AI/u);
  const terms = await call("/terms", { user: "" }).then((r) => r.text());
  assert.match(terms, /every message to the Maker/u);
  assert.doesNotMatch(terms, /the sentence a game is made from/u);
});
// `commented`, plus a published game by user_fan that user_owner saved, and a comment from each of them on an Original.
const feuding = async ({ call, publish }) => {
  const posted = await commented({ call, publish });
  const fan = { user: "user_fan", username: "fan" };
  const fanGameId = await publish(fan);
  await call(`/api/games/${fanGameId}/save`, { method: "PUT" });
  await call(`/api/games/${posted.gameId}/save`, { method: "PUT", ...fan });
  await call(`/api/games/${posted.gameId}/like`, { method: "PUT", ...fan });
  const { games } = await json(call("/api/games", { user: "" }));
  const original = games.find((g) => g.author === "hopon");
  for (const who of [{}, fan]) {
    // oxlint-disable-next-line no-await-in-loop -- two comments, newest first
    await call(`/api/games/${original.id}/comments`, {
      body: { body: `hi from ${who.username ?? "maya"}` },
      method: "POST",
      ...who,
    });
  }
  return { ...posted, fan, fanGameId, originalId: original.id };
};
test("blocks: from a game or a comment, one per pair keyed on the account, never yourself", async (t) => {
  const { call, env, publish } = await setup(t);
  const { comment, fanGameId, gameId } = await feuding({ call, publish });
  const block = (path, options) => call(path, { method: "POST", ...options });
  assert.equal(
    await status(block(`/api/games/${fanGameId}/block`, { user: "" })),
    401
  );
  assert.equal(await status(block("/api/games/999999/block")), 404);
  assert.equal(await status(block("/api/comments/999999/block")), 404);
  for (const path of [
    `/api/games/${gameId}/block`,
    `/api/comments/${comment.id}/block`,
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one refusal each
    const own = await block(path, {
      user: path.includes("games") ? "user_owner" : "user_fan",
    });
    assert.equal(own.status, 400);
    // oxlint-disable-next-line no-await-in-loop -- one refusal each
    assert.deepEqual(await own.json(), { error: "You can't block yourself." });
  }
  assert.equal(await status(block(`/api/games/${fanGameId}/block`)), 204);
  assert.equal(await status(block(`/api/games/${fanGameId}/block`)), 204);
  assert.equal(await status(block(`/api/comments/${comment.id}/block`)), 204);
  const { results } = await env.DB.prepare(
    "SELECT blocker, blocked, handle FROM blocks"
  ).all();
  assert.deepEqual(
    results.map((r) => ({ ...r })),
    [{ blocked: "user_fan", blocker: "user_owner", handle: "fan" }]
  );
});
test("blocks: neither person sees the other's games or comments; everyone else does, and nothing changes or goes away", async (t) => {
  const { call, count, publish } = await setup(t);
  const { comment, fanGameId, gameId, originalId } = await feuding({
    call,
    publish,
  });
  const before = {
    comments: await count("comments"),
    likes: await count("likes"),
    saves: await count("saves"),
  };
  await call(`/api/comments/${comment.id}/block`, { method: "POST" });
  const ids = async (path, user) => {
    const { games } = await json(call(path, { user }));
    return games.map((g) => g.id);
  };
  const shows = async (id, user) => {
    const listed = await ids("/api/games", user);
    return listed.includes(id);
  };
  const bodies = async (id, user) => {
    const { comments } = await json(
      call(`/api/games/${id}/comments`, { user })
    );
    return comments.map((c) => c.body);
  };
  // The blocker, user_owner, loses user_fan's game and comments.
  assert.equal(await shows(fanGameId), false);
  assert.deepEqual(await ids("/api/saves"), []);
  assert.deepEqual(await ids(`/api/saves?before=${2 ** 40}`), []);
  assert.deepEqual(await json(call("/api/saves/count")), { count: 0 });
  assert.deepEqual(await bodies(gameId), []);
  assert.deepEqual(await bodies(originalId), ["hi from maya"]);
  // The blocked person, user_fan, loses user_owner's.
  assert.equal(await shows(gameId, "user_fan"), false);
  assert.deepEqual(await ids("/api/saves", "user_fan"), []);
  assert.deepEqual(await json(call("/api/saves/count", { user: "user_fan" })), {
    count: 0,
  });
  assert.deepEqual(await bodies(originalId, "user_fan"), ["hi from fan"]);
  // Everyone else sees both, with the same counts.
  for (const user of ["user_other", ""]) {
    // oxlint-disable-next-line no-await-in-loop -- two viewers
    const { games } = await json(call("/api/games", { user }));
    assert.deepEqual(
      games
        .filter((g) => g.id === gameId || g.id === fanGameId)
        .map(({ comments, id, likes }) => ({ comments, id, likes })),
      [
        { comments: 0, id: fanGameId, likes: 0 },
        { comments: 1, id: gameId, likes: 1 },
      ]
    );
    // oxlint-disable-next-line no-await-in-loop -- two viewers
    assert.deepEqual(await bodies(originalId, user), [
      "hi from fan",
      "hi from maya",
    ]);
  }
  assert.deepEqual(
    {
      comments: await count("comments"),
      likes: await count("likes"),
      saves: await count("saves"),
    },
    before
  );
});
test("blocks: neither person can comment on the other's games, and isn't told why", async (t) => {
  const { call, publish } = await setup(t);
  const { fan, fanGameId, gameId } = await feuding({ call, publish });
  await call(`/api/games/${fanGameId}/block`, { method: "POST" });
  const comment = (id, who) =>
    call(`/api/games/${id}/comments`, {
      body: { body: "hello?" },
      method: "POST",
      ...who,
    });
  // The same 404 and message as a game that doesn't exist, so a block can't be told apart.
  const missing = await comment(999_999, fan);
  assert.deepEqual(await missing.json(), {
    error: "This game isn't available.",
  });
  for (const [id, who] of [
    [gameId, fan],
    [fanGameId, {}],
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one refusal each
    const refused = await comment(id, who);
    assert.equal(refused.status, missing.status);
    // oxlint-disable-next-line no-await-in-loop -- one refusal each
    assert.deepEqual(await refused.json(), {
      error: "This game isn't available.",
    });
  }
  assert.equal(
    await status(comment(gameId, { user: "user_other", username: "other" })),
    201
  );
});
test("blocked accounts: newest first by the handle at block time; only the blocker sees and unblocks them", async (t) => {
  const { call, publish } = await setup(t);
  const { fan, fanGameId, originalId } = await feuding({ call, publish });
  await call(`/api/games/${originalId}/comments`, {
    body: { body: "hi from other" },
    method: "POST",
    user: "user_other",
    username: "other",
  });
  const { comments } = await json(call(`/api/games/${originalId}/comments`));
  const other = comments.find((c) => c.author === "other");
  assert.equal(await status(call("/api/blocks", { user: "" })), 401);
  assert.deepEqual(await json(call("/api/blocks")), { blocks: [] });
  await call(`/api/games/${fanGameId}/block`, { method: "POST" });
  await call(`/api/comments/${other.id}/block`, { method: "POST" });
  // user_fan renames; the list keeps the handle they had when blocked.
  await call(`/api/games/${originalId}/comments`, {
    body: { body: "new name" },
    method: "POST",
    user: "user_fan",
    username: "fan_renamed",
  });
  const { blocks } = await json(call("/api/blocks"));
  assert.deepEqual(
    blocks.map((b) => b.handle),
    ["other", "fan"]
  );
  const fanBlock = blocks[1].id;
  // The blocked person sees no list and can't lift the block.
  assert.deepEqual(await json(call("/api/blocks", fan)), { blocks: [] });
  const unblock = (id, who) =>
    call(`/api/blocks/${id}`, { method: "DELETE", ...who });
  const missing = await unblock(999_999);
  assert.equal(missing.status, 404);
  const notYours = await unblock(fanBlock, fan);
  assert.equal(notYours.status, missing.status);
  assert.deepEqual(await notYours.json(), await missing.json());
  assert.equal(await status(unblock(fanBlock, { user: "" })), 401);
  assert.equal(await status(unblock(fanBlock)), 204);
  assert.equal(await status(unblock(fanBlock)), 404);
  const after = await json(call("/api/blocks"));
  assert.deepEqual(
    after.blocks.map((b) => b.handle),
    ["other"]
  );
});
test("blocked accounts: Unblock brings back both people's games and comments, except ones the viewer reported", async (t) => {
  const { call, publish } = await setup(t);
  const { comment, fan, fanGameId, gameId, originalId } = await feuding({
    call,
    publish,
  });
  const { comments: before } = await json(
    call(`/api/games/${originalId}/comments`)
  );
  const fanOnOriginal = before.find((c) => c.author === "fan");
  await call(`/api/comments/${fanOnOriginal.id}/report`, {
    body: { reason: "spam" },
    method: "POST",
  });
  const reported = { id: await publish(fan) };
  await call(`/api/games/${reported.id}/report`, {
    body: { reason: "spam" },
    method: "POST",
  });
  await call(`/api/comments/${comment.id}/block`, { method: "POST" });
  const { blocks } = await json(call("/api/blocks"));
  await call(`/api/blocks/${blocks[0].id}`, { method: "DELETE" });
  const ids = async (path, who) => {
    const { games } = await json(call(path, who));
    return games.map((g) => g.id);
  };
  const shows = async (id, who) => {
    const listed = await ids("/api/games", who);
    return listed.includes(id);
  };
  const bodies = async (id, who) => {
    const { comments } = await json(call(`/api/games/${id}/comments`, who));
    return comments.map((c) => c.body);
  };
  // The blocker gets user_fan's game, save and comment back, but not the game and comment they reported.
  assert.ok(await shows(fanGameId));
  assert.equal(await shows(reported.id), false);
  assert.deepEqual(await ids("/api/saves"), [fanGameId]);
  assert.deepEqual(await bodies(gameId), [comment.body]);
  assert.deepEqual(await bodies(originalId), ["hi from maya"]);
  // user_fan gets user_owner's back, and can comment on their games again.
  assert.ok(await shows(gameId, fan));
  assert.deepEqual(await ids("/api/saves", fan), [gameId]);
  assert.equal(
    await status(
      call(`/api/games/${gameId}/comments`, {
        body: { body: "hello again" },
        method: "POST",
        ...fan,
      })
    ),
    201
  );
});

test("drafts: born on a screened first message, listed newest first for their owner only", async (t) => {
  const { call, env, forwarded } = await setup(t);
  assert.equal(
    await status(
      call("/api/drafts", { body: { text: "hi" }, method: "POST", user: "" })
    ),
    401
  );
  assert.equal(await status(call("/api/drafts", { user: "" })), 401);
  assert.equal(
    await status(call("/api/drafts", { body: { text: " " }, method: "POST" })),
    400
  );
  const first = await call("/api/drafts", {
    body: { text: "  A cat that jumps over moons  " },
    method: "POST",
  });
  assert.equal(first.status, 201);
  // With the message's operation id, which the Talker's submission events name, as the messages route answers.
  const { id: a, message } = await first.json();
  assert.match(a, /^[0-9a-f]{64}$/u);
  assert.equal(message, "op");
  assert.deepEqual(forwarded, [
    { action: "message", draft: a, text: "A cat that jumps over moons" },
  ]);
  const { id: b } = await json(
    call("/api/drafts", { body: { text: "Space snake" }, method: "POST" })
  );
  const list = await json(call("/api/drafts"));
  assert.deepEqual(
    list.drafts.map((d) => [d.id, d.title]),
    [
      [b, null],
      [a, null],
    ]
  );
  assert.match(list.drafts[0].updatedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/u);
  // The Talker dates the row at the end of each turn, which moves it to the top.
  await env.DB.prepare(
    "UPDATE drafts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 second') WHERE id = ?"
  )
    .bind(a)
    .run();
  const { drafts } = await json(call("/api/drafts"));
  assert.deepEqual(
    drafts.map((d) => d.id),
    [a, b]
  );
  assert.deepEqual(await json(call("/api/drafts", { user: "user_other" })), {
    drafts: [],
  });
});

test("drafts: a 21st is refused until one goes", async (t) => {
  const { call, count, env, forwarded } = await setup(t);
  await env.DB.batch(
    Array.from({ length: 19 }, (_, i) =>
      env.DB.prepare("INSERT INTO drafts (id, owner) VALUES (?, ?)").bind(
        `${i}`.padStart(64, "0"),
        "user_owner"
      )
    )
  );
  // Someone else's don't count.
  await env.DB.prepare("INSERT INTO drafts (id, owner) VALUES (?, ?)")
    .bind("f".repeat(64), "user_other")
    .run();
  assert.equal(
    await status(
      call("/api/drafts", { body: { text: "Twentieth" }, method: "POST" })
    ),
    201
  );
  const refused = await call("/api/drafts", {
    body: { text: "Twenty-first" },
    method: "POST",
  });
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), {
    error: "Delete a Draft to start a new one.",
  });
  assert.equal(await count("drafts"), 21);
  assert.deepEqual(
    forwarded.map((f) => f.text),
    ["Twentieth"]
  );
  await env.DB.prepare("DELETE FROM drafts WHERE id = ?")
    .bind("0".repeat(64))
    .run();
  assert.equal(
    await status(
      call("/api/drafts", { body: { text: "Twenty-first" }, method: "POST" })
    ),
    201
  );
});

test("drafts: a screened-out message is refused and never reaches the Talker", async (t) => {
  const { ai, call, count, forwarded } = await setup(t);
  ai.screen = flagOnly("A game about hurting people");
  const first = await call("/api/drafts", {
    body: { text: "A game about hurting people" },
    method: "POST",
  });
  assert.equal(first.status, 422);
  assert.deepEqual(await first.json(), REFUSED);
  assert.equal(await count("drafts"), 0);
  const { id } = await json(
    call("/api/drafts", { body: { text: "A cat game" }, method: "POST" })
  );
  const later = await call(`/api/drafts/${id}/messages`, {
    body: { text: "A game about hurting people" },
    method: "POST",
  });
  assert.equal(later.status, 422);
  assert.deepEqual(await later.json(), REFUSED);
  const steer = await call(`/api/drafts/${id}/messages`, {
    body: { text: "Make it faster" },
    method: "POST",
  });
  assert.equal(steer.status, 202);
  assert.deepEqual(await steer.json(), { id: "op" });
  assert.deepEqual(
    forwarded.map((f) => f.text),
    ["A cat game", "Make it faster"]
  );
});

test("drafts: another account gets 404 on every Draft route; the socket needs a ticket of its own", async (t) => {
  const { call, forwarded } = await setup(t);
  const { id } = await json(
    call("/api/drafts", { body: { text: "A cat game" }, method: "POST" })
  );
  const other = { user: "user_other" };
  const missing = "a".repeat(64);
  for (const [path, body] of [
    ["messages", { text: "hello" }],
    ["stop", undefined],
    ["ws-ticket", undefined],
  ]) {
    for (const draft of [id, missing]) {
      // oxlint-disable-next-line no-await-in-loop -- one route at a time
      const response = await call(`/api/drafts/${draft}/${path}`, {
        body,
        method: "POST",
        ...(draft === id ? other : {}),
      });
      assert.equal(response.status, 404, `${path} ${draft}`);
      // oxlint-disable-next-line no-await-in-loop -- one route at a time
      assert.deepEqual(await response.json(), { error: "Draft not found." });
    }
  }
  assert.equal(
    await status(call("/api/drafts/not-a-draft/stop", { method: "POST" })),
    404
  );
  assert.equal(forwarded.length, 1);
  assert.equal(
    await status(call(`/api/drafts/${id}/stop`, { method: "POST" })),
    204
  );
  const { ticket } = await json(
    call(`/api/drafts/${id}/ws-ticket`, { method: "POST" })
  );
  // No ticket, a used one, or one for another Draft: 404, and nothing reaches the socket.
  const socket = (draft, query) =>
    status(call(`/api/drafts/${draft}/ws${query}`, { user: "" }));
  assert.equal(await socket(id, ""), 404);
  assert.equal(
    await socket(missing, `?ticket=${encodeURIComponent(ticket)}`),
    404
  );
  assert.equal(await socket(id, `?ticket=${encodeURIComponent(ticket)}`), 200);
  assert.equal(await socket(id, `?ticket=${encodeURIComponent(ticket)}`), 404);
  assert.deepEqual(
    forwarded.filter((f) => f.action === "upgrade"),
    [{ action: "upgrade", draft: id }]
  );
  // A made-up id never reaches, and so never creates, a Talker.
  assert.equal(
    forwarded.some((f) => f.draft === missing),
    false
  );
});

// A Draft with one Revision in R2, as the Talker leaves it at the end of a turn that builds (#117).
const withRevision = async ({ call, env }, n = 3) => {
  const { id } = await json(
    call("/api/drafts", { body: { text: "A cat game" }, method: "POST" })
  );
  await env.FILES.put(`drafts/${id}/${n}/index.html`, INDEX_HTML);
  await env.FILES.put(`drafts/${id}/${n}/game.js`, "engineInit();");
  return id;
};
// The path of the link the app gets for a Draft, and a signed-out request for one of its files.
const preview = async (call, id) => {
  const { url } = await json(call(`/api/drafts/${id}/preview`));
  return new URL(url).pathname;
};
const open = (call, path, file = "index.html") =>
  call(path.replace(/index\.html$/u, file), { user: "" });

test("preview: the minted link serves the current Revision's files, signed out, with the game CSP and no-store", async (t) => {
  const context = await setup(t);
  const { call } = context;
  const id = await withRevision(context);
  const path = await preview(call, id);
  assert.match(
    path,
    new RegExp(`^/drafts/${id}/3/\\d+\\.[\\w-]+/index\\.html$`, "u")
  );
  const page = await open(call, path);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), INDEX_HTML);
  assert.match(page.headers.get("Content-Type"), /^text\/html/u);
  assert.equal(page.headers.get("Content-Security-Policy"), GAME_CSP);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  // index.html's relative sibling, under the same link.
  const game = await open(call, path, "game.js");
  assert.equal(game.status, 200);
  assert.equal(await game.text(), "engineInit();");
  assert.match(game.headers.get("Content-Type"), /^text\/javascript/u);
  assert.equal(game.headers.get("Content-Security-Policy"), GAME_CSP);
});

test("preview: a link is 403 once its hour is up, or with its signature, expiry or Draft changed", async (t) => {
  const context = await setup(t);
  const { call } = context;
  const id = await withRevision(context);
  const other = await withRevision(context);
  const path = await preview(call, id);
  // /drafts/<id>/<n>/<exp>.<sig>/index.html
  const [n, token] = path.split("/").slice(3, 5);
  const [exp, sig] = token.split(".");
  const flipped = `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
  const otherPath = await preview(call, other);
  const [otherToken] = otherPath.split("/").slice(4, 5);
  for (const forged of [
    `/drafts/${id}/${n}/${exp}.${flipped}/index.html`,
    `/drafts/${id}/${n}/${Number(exp) + 3600}.${sig}/index.html`,
    `/drafts/${id}/${n}/${exp}/index.html`,
    `/drafts/${id}/${n}/${otherToken}/index.html`,
    `/drafts/${other}/${n}/${token}/index.html`,
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one link at a time
    assert.equal(await status(open(call, forged)), 403, forged);
  }
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 59 * 60 * 1000 });
  assert.equal(await status(open(call, path)), 200);
  t.mock.timers.setTime(Date.now() + 2 * 60 * 1000);
  const expired = await open(call, path, "game.js");
  assert.equal(expired.status, 403);
  assert.deepEqual(await expired.json(), { error: "This link has expired." });
});

test("preview: the next Revision or a Delete turns a live link into a 404; the next link points at the new Revision", async (t) => {
  const context = await setup(t);
  const { call, env } = context;
  const id = await withRevision(context);
  const old = await preview(call, id);
  assert.equal(await status(open(call, old, "music.js")), 404);
  // End of a turn that builds: <4>/ is written, then <3>/ deleted. A link minted in between gets the new one.
  await env.FILES.put(`drafts/${id}/4/index.html`, "<!doctype html>v4");
  assert.match(await preview(call, id), new RegExp(`^/drafts/${id}/4/`, "u"));
  await env.FILES.delete([
    `drafts/${id}/3/index.html`,
    `drafts/${id}/3/game.js`,
  ]);
  const gone = await open(call, old);
  assert.equal(gone.status, 404);
  assert.deepEqual(await gone.json(), { error: "File not found." });
  const current = await preview(call, id);
  const page = await open(call, current);
  assert.equal(await page.text(), "<!doctype html>v4");
  await env.FILES.delete(`drafts/${id}/4/index.html`);
  assert.equal(await status(open(call, current)), 404);
});

test("preview: only the Draft's owner can mint a link, and only once it has a game", async (t) => {
  const context = await setup(t);
  const { call } = context;
  const id = await withRevision(context);
  const mint = (draft, user) =>
    call(`/api/drafts/${draft}/preview`, user === undefined ? {} : { user });
  assert.equal(await status(mint(id, "")), 401);
  for (const [draft, user] of [
    [id, "user_other"],
    ["a".repeat(64), undefined],
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one Draft at a time
    const response = await mint(draft, user);
    assert.equal(response.status, 404);
    // oxlint-disable-next-line no-await-in-loop -- one Draft at a time
    assert.deepEqual(await response.json(), { error: "Draft not found." });
  }
  const { id: empty } = await json(
    call("/api/drafts", { body: { text: "A dog game" }, method: "POST" })
  );
  const none = await mint(empty);
  assert.equal(none.status, 404);
  assert.deepEqual(await none.json(), { error: "This Draft has no game yet." });
});

test("delete: a Draft goes with its row, its files, its Talker and its box; anyone else's is a 404", async (t) => {
  const context = await setup(t);
  const { call, count, env, forwarded } = context;
  const id = await withRevision(context);
  const kept = await withRevision(context);
  const link = await preview(call, id);
  const { ticket } = await json(
    call(`/api/drafts/${id}/ws-ticket`, { method: "POST" })
  );
  assert.equal(
    await status(call(`/api/drafts/${id}`, { method: "DELETE", user: "" })),
    401
  );
  for (const [draft, user] of [
    [id, "user_other"],
    ["a".repeat(64), undefined],
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one Draft at a time
    const response = await call(`/api/drafts/${draft}`, {
      method: "DELETE",
      ...(user ? { user } : {}),
    });
    assert.equal(response.status, 404);
    // oxlint-disable-next-line no-await-in-loop -- one Draft at a time
    assert.deepEqual(await response.json(), { error: "Draft not found." });
  }
  assert.equal(await count("drafts"), 2);
  forwarded.length = 0;
  assert.equal(
    await status(call(`/api/drafts/${id}`, { method: "DELETE" })),
    204
  );
  assert.deepEqual(forwarded, [
    { action: "delete", draft: id },
    { action: "DELETE /box", draft: id },
  ]);
  assert.deepEqual(await draftIds(call), [kept]);
  const { objects } = await env.FILES.list({ prefix: "drafts/" });
  assert.deepEqual(
    objects.map((o) => o.key.split("/")[1]),
    [kept, kept]
  );
  // The preview link and the socket are gone with it, and so is every route.
  assert.equal(await status(open(call, link)), 404);
  assert.equal(
    await status(
      call(`/api/drafts/${id}/ws?ticket=${encodeURIComponent(ticket)}`, {
        user: "",
      })
    ),
    404
  );
  assert.equal(
    await status(call(`/api/drafts/${id}`, { method: "DELETE" })),
    404
  );
});

test("delete: a failure on the way keeps the Draft listed, so a retry finishes the job", async (t) => {
  const context = await setup(t);
  const { call, coder, env } = context;
  const id = await withRevision(context);
  coder.status = 502;
  assert.equal(
    await status(call(`/api/drafts/${id}`, { method: "DELETE" })),
    500
  );
  assert.deepEqual(await draftIds(call), [id]);
  coder.status = 204;
  assert.equal(
    await status(call(`/api/drafts/${id}`, { method: "DELETE" })),
    204
  );
  assert.deepEqual(await json(call("/api/drafts")), { drafts: [] });
  const { objects } = await env.FILES.list({ prefix: "drafts/" });
  assert.deepEqual(objects, []);
});

test("delete: DELETE /api/drafts takes every Draft of the caller and none of anyone else's", async (t) => {
  const context = await setup(t);
  const { call, forwarded } = context;
  const mine = [await withRevision(context), await withRevision(context)];
  const { id: theirs } = await json(
    call("/api/drafts", {
      body: { text: "A dog game" },
      method: "POST",
      user: "user_other",
    })
  );
  assert.equal(
    await status(call("/api/drafts", { method: "DELETE", user: "" })),
    401
  );
  forwarded.length = 0;
  assert.equal(await status(call("/api/drafts", { method: "DELETE" })), 204);
  assert.deepEqual(
    forwarded.map((f) => `${f.action} ${f.draft}`).toSorted(),
    mine.flatMap((id) => [`delete ${id}`, `DELETE /box ${id}`]).toSorted()
  );
  assert.deepEqual(await json(call("/api/drafts")), { drafts: [] });
  assert.deepEqual(await draftIds(call, "user_other"), [theirs]);
  const { objects } = await context.env.FILES.list({ prefix: "drafts/" });
  assert.deepEqual(objects, []);
  // Nothing left: still a 204.
  assert.equal(await status(call("/api/drafts", { method: "DELETE" })), 204);
});
