import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { Effect } from "effect";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

import { parseGame, GAME_CSP } from "../src/game.ts";
import worker from "../src/index.ts";

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
// `role` mirrors {{user.public_metadata.role}}, "operator" for the Operator and absent for everyone else.
const sign = async (
  sub,
  { exp = 60, key = keys.privateKey, role, username = null } = {}
) => {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "RS256", kid: "ins_test", typ: "JWT" })}.${b64({ exp: now + exp, iat: now, nbf: now, role, sub, username })}`;
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
const generated = {
  description: "点击星星得分",
  html: '<!doctype html><html><body><button>星星</button><script>document.querySelector("button").onclick=e=>e.target.textContent="1"</script></body></html>',
  title: "星星小游戏",
};
// Seeded by migrations/*_originals.sql.
const ORIGINALS = 2;
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
    envFiles: [],
    persist: false,
    remoteBindings: false,
  });
  t.after(() => proxy.dispose());
  const { DB } = proxy.env;
  await DB.batch(migrations.map((sql) => DB.prepare(sql)));
  // Workers AI answers by model: Llama Guard's verdict for Screening, a game for generation. Tests swap either.
  const ai = {
    game: () =>
      Promise.resolve({
        choices: [{ message: { content: JSON.stringify(generated) } }],
      }),
    screen: () => Promise.resolve({ response: { categories: [], safe: true } }),
  };
  const env = {
    AI: {
      run: (model, input) =>
        model === "@cf/meta/llama-guard-3-8b"
          ? ai.screen(input)
          : ai.game(model, input),
    },
    AI_MODEL: "@cf/moonshotai/kimi-k2.5",
    CLERK_JWT_KEY,
    DB,
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
      role,
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
                Authorization: `Bearer ${token ?? (await sign(user, { role, username }))}`,
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
  return { ai, call, count, env, owner, settled };
};
test("AI JSON boundary rejects invalid and truncated output", async () => {
  assert.deepEqual(
    await Effect.runPromise(
      parseGame(`\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``)
    ),
    generated
  );
  await Promise.all(
    [
      undefined,
      "no",
      "null",
      "{}",
      JSON.stringify({ ...generated, title: "" }),
      JSON.stringify({ ...generated, html: "<html><script>" }),
    ].map((output) =>
      assert.rejects(Effect.runPromise(parseGame(output)), { status: 502 })
    )
  );
});
test("generation, private preview, latest draft, owned publish, public discovery, sandbox", async (t) => {
  const { call } = await setup(t);
  const { games } = await json(call("/api/games"));
  assert.deepEqual(
    games.map((g) => g.title),
    ["Odd Duck", "Toast Panic"]
  );
  assert.equal(await status(call("/api/drafts/latest", { user: "" })), 401);
  assert.deepEqual(await json(call("/api/drafts/latest")), {
    draft: null,
  });
  const response = await call("/api/games", {
    body: { prompt: "点击星星的小游戏" },
    method: "POST",
  });
  assert.equal(response.status, 201);
  const draft = await response.json();
  const discovery = await json(call("/api/games"));
  assert.equal(discovery.games.length, ORIGINALS);
  const latest = await json(call("/api/drafts/latest"));
  assert.deepEqual(latest.draft, draft);
  assert.deepEqual(
    await json(call("/api/drafts/latest", { user: "user_other" })),
    { draft: null }
  );
  assert.equal(
    await status(
      call(`/api/games/${draft.id}/document`, { user: "user_other" })
    ),
    404
  );
  assert.equal(
    await status(call(`/api/games/${draft.id}/document`, { user: "" })),
    404
  );
  assert.equal(await status(call(`/api/games/${draft.id}/document`)), 200);
  assert.equal(
    await status(
      call(`/api/games/${draft.id}/publish`, {
        method: "POST",
        user: "user_other",
      })
    ),
    404
  );
  const nameless = await call(`/api/games/${draft.id}/publish`, {
    method: "POST",
    username: null,
  });
  assert.equal(nameless.status, 400);
  assert.deepEqual(await nameless.json(), {
    error: "Pick your name before publishing.",
  });
  assert.equal(
    await status(call(`/api/games/${draft.id}/publish`, { method: "POST" })),
    200
  );
  assert.equal(
    await status(call(`/api/games/${draft.id}/publish`, { method: "POST" })),
    200
  );
  const document = await call(`/api/games/${draft.id}/document`, { user: "" });
  assert.equal(document.status, 200);
  assert.equal(document.headers.get("Content-Security-Policy"), GAME_CSP);
  assert.ok(!GAME_CSP.includes("allow-same-origin"));
  assert.ok(GAME_CSP.includes("connect-src 'none'"));
  assert.equal(await document.text(), generated.html);
  assert.deepEqual(await json(call("/api/drafts/latest")), {
    draft: null,
  });
  const list = await json(call("/api/games"));
  assert.equal(list.games.length, ORIGINALS + 1);
  assert.equal(list.games[0].id, draft.id);
  assert.equal(list.games[0].html, undefined);
  assert.equal(list.games[0].owner, undefined);
  // The handle from the publisher's token.
  assert.equal(list.games[0].author, "maya_makes");
  assert.deepEqual(
    list.games.slice(1).map((g) => g.author),
    ["hopon", "hopon"]
  );
  const unknown = await call("/index.html");
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "Endpoint not found." });
});
test("Clerk auth, request validation and atomic per-account quota", async (t) => {
  const { call } = await setup(t);
  const options = { body: { prompt: "造一个小游戏" }, method: "POST" };
  assert.equal(await status(call("/api/games", { ...options, user: "" })), 401);
  assert.equal(
    await status(call("/api/games", { ...options, token: "not.a.jwt" })),
    401
  );
  assert.equal(
    await status(
      call("/api/games", {
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
      call("/api/games", {
        ...options,
        token: await sign("user_owner", { key: forger.privateKey }),
      })
    ),
    401
  );
  assert.equal(
    await status(call("/api/games", { ...options, body: "null" })),
    400
  );
  assert.equal(
    await status(call("/api/games", { ...options, body: "{" })),
    400
  );
  assert.equal(
    await status(call("/api/games", { ...options, contentType: "text/plain" })),
    415
  );
  assert.equal(
    await status(call("/api/games", { ...options, body: "x".repeat(12_001) })),
    413
  );
  assert.equal(await status(call("/api/games?before=NaN")), 400);
  const attempts = await Promise.all(
    Array.from({ length: 11 }, () => call("/api/games", options))
  );
  assert.equal(attempts.filter((r) => r.status === 201).length, 10);
  assert.equal(attempts.filter((r) => r.status === 429).length, 1);
  assert.equal(
    await status(call("/api/games", { ...options, user: "user_other" })),
    201
  );
});
test("cursor pages have no duplicates; invalid AI never inserts a game", async (t) => {
  const { ai, call, env, count, owner } = await setup(t);
  const insert = env.DB.prepare(
    "INSERT INTO games(owner,title,description,html,published) VALUES (?,?,?,?,1)"
  );
  await env.DB.batch(
    Array.from({ length: 17 }, (_, i) =>
      insert.bind(owner, `game ${i}`, "", generated.html)
    )
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
  ai.game = () =>
    Promise.resolve({ choices: [{ message: { content: "bad json" } }] });
  assert.equal(
    await status(
      call("/api/games", {
        body: { prompt: "造一个小游戏" },
        method: "POST",
      })
    ),
    502
  );
  ai.game = () => Promise.reject(new Error("AI down"));
  assert.deepEqual(
    await json(
      call("/api/games", {
        body: { prompt: "造一个小游戏" },
        method: "POST",
      })
    ),
    { error: "AI is temporarily unavailable. Please try again." }
  );
  assert.equal(await count("games"), 17 + ORIGINALS);
});

test("offline mode never invokes AI or consumes creation quota", async (t) => {
  const { call, env, count } = await setup(t);
  env.HOPON_OFFLINE = "1";
  env.AI.run = () => {
    throw new Error("must not call AI");
  };
  assert.equal(
    await status(
      call("/api/games", {
        body: { prompt: "造一个小游戏" },
        method: "POST",
      })
    ),
    503
  );
  assert.equal(await count("generation_limits"), 0);
  // Comments still post, unscreened: offline mode is local dev only.
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

test("generation uses Kimi non-thinking mode with a bounded output budget", async (t) => {
  const { ai, call } = await setup(t);
  ai.game = (model, input) => {
    assert.equal(model, "@cf/moonshotai/kimi-k2.5");
    assert.deepEqual(input.chat_template_kwargs, { thinking: false });
    assert.equal(input.max_completion_tokens, 6000);
    return Promise.resolve({
      choices: [{ message: { content: JSON.stringify(generated) } }],
    });
  };
  assert.equal(
    await status(
      call("/api/games", {
        body: { prompt: "A five-second button game" },
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
const flag =
  (...categories) =>
  () =>
    Promise.resolve({ response: { categories, safe: false } });

// Flags exactly the texts given, so a test picks which of a route's checks refuses.
const flagOnly =
  (...texts) =>
  ({ messages: [{ content }] }) =>
    Promise.resolve({
      response: texts.includes(content)
        ? { categories: ["S10"], safe: false }
        : { categories: [], safe: true },
    });
test("screening: a flagged prompt is refused before generation, saves nothing and costs no creation", async (t) => {
  const { ai, call, count } = await setup(t);
  const screened = [];
  ai.screen = (input) => {
    screened.push(input);
    return flag("S1")();
  };
  ai.game = () => {
    throw new Error("must not generate");
  };
  const response = await call("/api/games", {
    body: { prompt: "A game about hurting people" },
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
  assert.equal(await count("games"), ORIGINALS);
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
    status(
      call(`/api/games/${game.id}/comments`, { body: { body }, method: "POST" })
    );
  ai.screen = flag("S6", "S8", "S13");
  assert.equal(await comment("see a doctor about it"), 201);
  ai.screen = flag("S13", "S1");
  assert.equal(await comment("mixed"), 422);
  ai.screen = flag();
  assert.equal(await comment("no category"), 422);
});

test("screening: fails closed when it errors, answers oddly or takes over 3 s", async (t) => {
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
      call("/api/games", { body: { prompt: "造一个小游戏" }, method: "POST" })
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
  assert.ok(Date.now() - started < 3400);
  assert.equal(await count("comments"), 0);
});

const HANDLE_REJECTED = {
  code: "handle_rejected",
  error: "Your name breaks hopon's rules. Pick a different one.",
};

test("screening: a Draft with a flagged title or description stays a private Draft", async (t) => {
  const { ai, call } = await setup(t);
  const draft = await json(
    call("/api/games", { body: { prompt: "点击星星的小游戏" }, method: "POST" })
  );
  const screened = [];
  ai.screen = (input) => {
    screened.push(input.messages[0].content);
    return flagOnly(`${generated.title}\n${generated.description}`)(input);
  };
  const response = await call(`/api/games/${draft.id}/publish`, {
    method: "POST",
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error:
      "This game's title or description breaks hopon's rules. Try making a new one.",
  });
  assert.deepEqual(screened.toSorted(), [
    "maya_makes",
    `${generated.title}\n${generated.description}`,
  ]);
  assert.deepEqual(await json(call("/api/drafts/latest")), { draft });
  const { games } = await json(call("/api/games"));
  assert.equal(games.length, ORIGINALS);
});

test("screening: a flagged Handle refuses publishing and commenting with handle_rejected", async (t) => {
  const { ai, call, count } = await setup(t);
  const draft = await json(
    call("/api/games", { body: { prompt: "点击星星的小游戏" }, method: "POST" })
  );
  const {
    games: [game],
  } = await json(call("/api/games"));
  ai.screen = flagOnly("bad_name");
  const publish = await call(`/api/games/${draft.id}/publish`, {
    method: "POST",
    username: "bad_name",
  });
  assert.equal(publish.status, 422);
  assert.deepEqual(await publish.json(), HANDLE_REJECTED);
  assert.deepEqual(await json(call("/api/drafts/latest")), { draft });
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
  const { ai, call, count } = await setup(t);
  const draft = await json(
    call("/api/games", { body: { prompt: "点击星星的小游戏" }, method: "POST" })
  );
  const {
    games: [game],
  } = await json(call("/api/games"));
  ai.screen = flagOnly(
    "bad_name",
    "a slur",
    `${generated.title}\n${generated.description}`
  );
  const publish = await call(`/api/games/${draft.id}/publish`, {
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
  assert.deepEqual(await json(call("/api/drafts/latest")), { draft });
});

test("likes: published only, one per user, counted in the feed, removable", async (t) => {
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
  const draft = await json(
    call("/api/games", {
      body: { prompt: "点击星星的小游戏" },
      method: "POST",
    })
  );
  assert.equal(await status(like(draft.id)), 404);
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
test("comments: anyone reads, posting needs sign-in and a handle, published games only", async (t) => {
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
  const draft = await json(
    call("/api/games", {
      body: { prompt: "点击星星的小游戏" },
      method: "POST",
    })
  );
  assert.equal(await status(post(draft.id, "nice")), 404);
  assert.equal(await status(call(`/api/games/${draft.id}/comments`)), 404);

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
test("comments: atomic 100 per account per day, separate from the generation quota", async (t) => {
  const { call } = await setup(t);
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
  assert.equal(
    await status(
      call("/api/games", {
        body: { prompt: "造一个小游戏" },
        method: "POST",
      })
    ),
    201
  );
});
test("comments: deleted by their author or the game's creator, hidden from everyone else", async (t) => {
  const { call } = await setup(t);
  const draft = await json(
    call("/api/games", {
      body: { prompt: "点击星星的小游戏" },
      method: "POST",
    })
  );
  await call(`/api/games/${draft.id}/publish`, { method: "POST" });
  const post = (user, body) =>
    json(
      call(`/api/games/${draft.id}/comments`, {
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
      call(`/api/games/${draft.id}/comments`, { user })
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
  const remove = (id, user, role) =>
    call(`/api/comments/${id}`, { method: "DELETE", role, user });
  assert.equal(await status(remove(first.id, "user_stranger", "admin")), 404);
  assert.equal(await status(remove(first.id, "")), 401);
  assert.equal(await status(remove(first.id, "user_stranger")), 404);
  assert.equal(await status(remove(first.id, "user_owner")), 204);
  assert.equal(await status(remove(second.id, "user_fan")), 204);
  assert.equal(await status(remove(second.id, "user_fan")), 404);
  assert.deepEqual(await list(""), []);
});
test("comments: the Operator sees every comment as deletable and deletes any", async (t) => {
  const { call } = await setup(t);
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
    call(`/api/games/${game.id}/comments`, {
      role: "operator",
      user: "user_operator",
    })
  );
  assert.deepEqual(
    comments.map((c) => [c.canDelete, c.mine]),
    [[true, false]]
  );
  assert.equal(
    await status(
      call(`/api/comments/${comment.id}`, {
        method: "DELETE",
        role: "operator",
        user: "user_operator",
      })
    ),
    204
  );
  const { comments: after } = await json(
    call(`/api/games/${game.id}/comments`)
  );
  assert.deepEqual(after, []);
});
test("games: deleted by their creator or the Operator, with likes, comments and saves; reports stay", async (t) => {
  const { call, count } = await setup(t);
  const publish = async () => {
    const draft = await json(
      call("/api/games", {
        body: { prompt: "点击星星的小游戏" },
        method: "POST",
      })
    );
    await call(`/api/games/${draft.id}/publish`, { method: "POST" });
    await Promise.all([
      ...["user_fan", "user_other"].flatMap((user) => [
        call(`/api/games/${draft.id}/like`, { method: "PUT", user }),
        call(`/api/games/${draft.id}/save`, { method: "PUT", user }),
        call(`/api/games/${draft.id}/comments`, {
          body: { body: "nice" },
          method: "POST",
          user,
        }),
      ]),
      call(`/api/games/${draft.id}/report`, {
        body: { reason: "spam" },
        method: "POST",
        user: "user_fan",
      }),
    ]);
    return draft.id;
  };
  const remove = (id, user, role) =>
    call(`/api/games/${id}`, { method: "DELETE", role, user });
  const counts = () =>
    Promise.all(["games", "likes", "comments", "saves", "reports"].map(count));
  const mine = await publish();
  const theirs = await publish();
  const before = await counts();
  assert.equal(await status(remove(mine, "")), 401);
  assert.equal(await status(remove(mine, "user_fan")), 404);
  assert.equal(await status(remove(mine, "user_fan", "admin")), 404);
  assert.deepEqual(await counts(), before);
  assert.equal(await status(remove(mine, "user_owner")), 204);
  assert.equal(await status(remove(mine, "user_owner")), 404);
  assert.equal(await status(remove(theirs, "user_operator", "operator")), 204);
  assert.equal(await status(call(`/api/games/${theirs}/document`)), 404);
  assert.deepEqual(await counts(), [ORIGINALS, 0, 0, 0, 2]);
});
test("games: a draft isn't Deleted, even by its creator or the Operator", async (t) => {
  const { call } = await setup(t);
  const draft = await json(
    call("/api/games", { body: { prompt: "点击星星的小游戏" }, method: "POST" })
  );
  assert.equal(
    await status(call(`/api/games/${draft.id}`, { method: "DELETE" })),
    404
  );
  assert.equal(
    await status(
      call(`/api/games/${draft.id}`, {
        method: "DELETE",
        role: "operator",
        user: "user_operator",
      })
    ),
    404
  );
  assert.equal(await status(call(`/api/games/${draft.id}/document`)), 200);
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
test("saves: sign-in, published only, one per user, flagged in the feed, removable", async (t) => {
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
  const draft = await json(
    call("/api/games", {
      body: { prompt: "点击星星的小游戏" },
      method: "POST",
    })
  );
  assert.equal(await status(save(draft.id)), 404);
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
    "INSERT INTO games(owner,title,description,html,published) VALUES (?,?,?,?,1)"
  );
  await env.DB.batch(
    Array.from({ length: 17 }, (_, i) =>
      insert.bind(owner, `game ${i}`, "", generated.html)
    )
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
test("reports: someone else's published game, a known reason, signed in", async (t) => {
  const { call, count } = await setup(t);
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
  const draft = await json(
    call("/api/games", { body: { prompt: "点击星星的小游戏" }, method: "POST" })
  );
  assert.equal(
    await status(report(draft.id, "spam", { user: "user_other" })),
    404
  );
  await call(`/api/games/${draft.id}/publish`, { method: "POST" });
  const own = await report(draft.id, "spam");
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
  down = true;
  assert.equal(await status(report("user_b")), 204);
  await settled();
  assert.equal(sent.length, 2);
  assert.equal(await count("reports"), 2);
});
test("feed: `mine` marks the viewer's own games", async (t) => {
  const { call } = await setup(t);
  const draft = await json(
    call("/api/games", { body: { prompt: "点击星星的小游戏" }, method: "POST" })
  );
  await call(`/api/games/${draft.id}/publish`, { method: "POST" });
  const mine = async (user) => {
    const { games } = await json(call("/api/games", { user }));
    return games.map((g) => g.mine);
  };
  assert.deepEqual(await mine("user_owner"), [true, false, false]);
  assert.deepEqual(await mine("user_other"), [false, false, false]);
  assert.deepEqual(await mine(""), [false, false, false]);
});
// A published game by user_owner with a comment from user_fan on it.
const commented = async (call) => {
  const draft = await json(
    call("/api/games", { body: { prompt: "点击星星的小游戏" }, method: "POST" })
  );
  await call(`/api/games/${draft.id}/publish`, { method: "POST" });
  const comment = await json(
    call(`/api/games/${draft.id}/comments`, {
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
  return { comment, gameId: draft.id, reportComment };
};
test("comment reports: someone else's comment, even on your own game; never your own", async (t) => {
  const { call, count, env } = await setup(t);
  const { comment, gameId, reportComment } = await commented(call);
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
  const { call } = await setup(t);
  const { comment, gameId, reportComment } = await commented(call);
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
  const { call, env, settled } = await setup(t);
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
  const { comment, gameId, reportComment } = await commented(call);
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
});
test("comments: `mine` marks the viewer's own comments", async (t) => {
  const { call } = await setup(t);
  const { gameId } = await commented(call);
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
const OPERATOR = { role: "operator", user: "user_operator" };
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
test("operator: every Operator endpoint refuses everyone else", async (t) => {
  const { call } = await setup(t);
  const { comment, gameId } = await commented(call);
  const endpoints = [
    ["GET", "/api/reports"],
    ["GET", "/api/reports/count"],
    ["POST", `/api/games/${gameId}/dismiss`],
    ["POST", `/api/comments/${comment.id}/dismiss`],
  ];
  const refusals = await Promise.all(
    endpoints.flatMap(([method, path]) =>
      [undefined, "admin"].map(async (role) => {
        const response = await call(path, { method, role, user: "user_fan" });
        return [method, path, role, response.status, await response.json()];
      })
    )
  );
  assert.deepEqual(
    refusals,
    endpoints.flatMap(([method, path]) =>
      [undefined, "admin"].map((role) => [
        method,
        path,
        role,
        403,
        { error: "Only the Operator can do this." },
      ])
    )
  );
  // Signed out, writes stop at sign-in as everywhere else; the Operator gets through.
  const statuses = (options) =>
    Promise.all(
      endpoints.map(([method, path]) =>
        status(call(path, { method, ...options }))
      )
    );
  assert.deepEqual(await statuses({ user: "" }), [403, 403, 401, 401]);
  assert.deepEqual(await statuses(OPERATOR), [200, 200, 204, 204]);
});
test("operator: the queue groups open reports by target, oldest first, with reasons and counts, and marks deleted content", async (t) => {
  const { call, env } = await setup(t);
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
  const { comment, gameId, reportComment } = await commented(call);
  await reportComment("hate");
  await reportGame(older, "age", "user_b");
  await reportGame(older, "spam", "user_c");
  await reportGame(newer, "other", "user_a");
  // Content can be gone while its reports are still open; the queue says so.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM games WHERE id = ?").bind(newer.id),
  ]);
  assert.deepEqual(await json(call("/api/reports/count", OPERATOR)), {
    count: 3,
  });
  const { targets } = await json(call("/api/reports", OPERATOR));
  for (const target of targets) {
    assert.match(target.reportedAt, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/u);
  }
  assert.deepEqual(
    targets.map((target) => ({ ...target, reportedAt: undefined })),
    [
      {
        body: null,
        description: older.description,
        gameId: older.id,
        handle: "hopon",
        id: older.id,
        kind: "game",
        live: true,
        reasons: [
          { count: 1, reason: "age" },
          { count: 2, reason: "spam" },
        ],
        reportedAt: undefined,
        title: older.title,
      },
      {
        body: "you stink",
        description: null,
        gameId,
        handle: "fan",
        id: comment.id,
        kind: "comment",
        live: true,
        reasons: [{ count: 1, reason: "hate" }],
        reportedAt: undefined,
        title: null,
      },
      {
        body: null,
        description: newer.description,
        gameId: newer.id,
        handle: "hopon",
        id: newer.id,
        kind: "game",
        live: false,
        reasons: [{ count: 1, reason: "other" }],
        reportedAt: undefined,
        title: newer.title,
      },
    ]
  );
});
test("operator: Dismiss closes every open report on the target and leaves the content up, still hidden from its reporters", async (t) => {
  const { call, env } = await setup(t);
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
  const dismiss = (path) => call(path, { method: "POST", ...OPERATOR });
  assert.equal(await status(dismiss(`/api/games/${game.id}/dismiss`)), 204);
  // Dismissing the game leaves the reports on its comments open.
  const onGame = { comment_id: null, game_id: game.id };
  const onComment = { comment_id: comment.id, game_id: game.id };
  assert.deepEqual(await reportRows(env), [
    { ...onGame, ...closed("dismissed") },
    { ...onGame, ...closed("dismissed") },
    { ...onComment, ...OPEN },
  ]);
  const { targets } = await json(call("/api/reports", OPERATOR));
  assert.deepEqual(
    targets.map((target) => [target.kind, target.id]),
    [["comment", comment.id]]
  );
  assert.equal(
    await status(dismiss(`/api/comments/${comment.id}/dismiss`)),
    204
  );
  assert.equal(
    await status(dismiss(`/api/comments/${comment.id}/dismiss`)),
    204
  );
  assert.deepEqual(await json(call("/api/reports", OPERATOR)), { targets: [] });
  assert.deepEqual(await json(call("/api/reports/count", OPERATOR)), {
    count: 0,
  });
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
  const { call, env } = await setup(t);
  // Games by user_owner, each with a comment by user_fan; every game and comment reported once.
  const first = await commented(call);
  const second = await commented(call);
  const third = await commented(call);
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
  // The Operator deletes the first game: its report and its comment's report close as deleted.
  assert.equal(
    await status(
      call(`/api/games/${first.gameId}`, { method: "DELETE", ...OPERATOR })
    ),
    204
  );
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
  const fourth = await commented(call);
  await fourth.reportComment("spam", { user: "user_a" });
  const fifth = await commented(call);
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
    await status(
      call(`/api/comments/${fourth.comment.id}`, {
        method: "DELETE",
        ...OPERATOR,
      })
    ),
    204
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
  const { targets } = await json(call("/api/reports", OPERATOR));
  assert.deepEqual(
    targets.map((target) => [target.kind, target.id]),
    [["game", third.gameId]]
  );
});

test("pages: /terms has the Rules and /support the contact address, signed out", async (t) => {
  const { call } = await setup(t);
  const terms = await call("/terms", { user: "" });
  assert.equal(terms.status, 200);
  assert.match(terms.headers.get("Content-Type"), /^text\/html/u);
  const rules = await terms.text();
  assert.match(rules, /<title>Terms of Use<\/title>/u);
  assert.match(rules, /zero tolerance/iu);
  assert.match(rules, /within 24 hours/u);
  assert.match(rules, /mailto:support@hopon\.example/u);
  const support = await call("/support", { user: "" });
  assert.equal(support.status, 200);
  const page = await support.text();
  assert.match(page, /mailto:support@hopon\.example/u);
  assert.match(page, /href="\/terms"/u);
});
// `commented`, plus a published game by user_fan that user_owner saved, and a comment from each of them on an Original.
const feuding = async (call) => {
  const posted = await commented(call);
  const fan = { user: "user_fan", username: "fan" };
  const draft = await json(
    call("/api/games", {
      body: { prompt: "点击月亮的小游戏" },
      method: "POST",
      ...fan,
    })
  );
  await call(`/api/games/${draft.id}/publish`, { method: "POST", ...fan });
  await call(`/api/games/${draft.id}/save`, { method: "PUT" });
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
  return { ...posted, fan, fanGameId: draft.id, originalId: original.id };
};
test("blocks: from a game or a comment, one per pair keyed on the account, never yourself", async (t) => {
  const { call, env } = await setup(t);
  const { comment, fanGameId, gameId } = await feuding(call);
  const block = (path, options) => call(path, { method: "POST", ...options });
  assert.equal(
    await status(block(`/api/games/${fanGameId}/block`, { user: "" })),
    401
  );
  assert.equal(await status(block("/api/games/999999/block")), 404);
  assert.equal(await status(block("/api/comments/999999/block")), 404);
  const draft = await json(
    call("/api/games", {
      body: { prompt: "点击太阳的小游戏" },
      method: "POST",
      user: "user_fan",
    })
  );
  assert.equal(await status(block(`/api/games/${draft.id}/block`)), 404);
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
  const { call, count } = await setup(t);
  const { comment, fanGameId, gameId, originalId } = await feuding(call);
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
  const { call } = await setup(t);
  const { fan, fanGameId, gameId } = await feuding(call);
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
  const { call } = await setup(t);
  const { fan, fanGameId, originalId } = await feuding(call);
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
  const { call } = await setup(t);
  const { comment, fan, fanGameId, gameId, originalId } = await feuding(call);
  const { comments: before } = await json(
    call(`/api/games/${originalId}/comments`)
  );
  const fanOnOriginal = before.find((c) => c.author === "fan");
  await call(`/api/comments/${fanOnOriginal.id}/report`, {
    body: { reason: "spam" },
    method: "POST",
  });
  const reported = await json(
    call("/api/games", {
      body: { prompt: "点击太阳的小游戏" },
      method: "POST",
      ...fan,
    })
  );
  await call(`/api/games/${reported.id}/publish`, { method: "POST", ...fan });
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
