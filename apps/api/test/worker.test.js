import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

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
  const env = {
    AI: {
      run: () =>
        Promise.resolve({
          choices: [{ message: { content: JSON.stringify(generated) } }],
        }),
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
      env
    );
  return { call, count, env, owner };
};
test("AI JSON boundary rejects invalid and truncated output", () => {
  assert.deepEqual(
    parseGame(`\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``),
    generated
  );
  for (const output of [
    undefined,
    "no",
    "null",
    "{}",
    JSON.stringify({ ...generated, title: "" }),
    JSON.stringify({ ...generated, html: "<html><script>" }),
  ]) {
    assert.throws(() => parseGame(output), { status: 502 });
  }
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
  const { call, env, count, owner } = await setup(t);
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
  env.AI.run = () =>
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
  assert.equal(await count("games"), 17 + ORIGINALS);
});

test("offline mode never invokes AI or consumes quota", async (t) => {
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
});

test("generation uses Kimi non-thinking mode with a bounded output budget", async (t) => {
  const { call, env } = await setup(t);
  env.AI.run = (model, input) => {
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
  assert.deepEqual(comments, [{ ...comment, canDelete: false }]);
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
  const remove = (id, user) =>
    call(`/api/comments/${id}`, { method: "DELETE", user });
  assert.equal(await status(remove(first.id, "")), 401);
  assert.equal(await status(remove(first.id, "user_stranger")), 404);
  assert.equal(await status(remove(first.id, "user_owner")), 204);
  assert.equal(await status(remove(second.id, "user_fan")), 204);
  assert.equal(await status(remove(second.id, "user_fan")), 404);
  assert.deepEqual(await list(""), []);
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
