// `pnpm -F worker games-to-r2`: once on a fresh local D1 (#145). Copies each published Game's HTML from the local D1
// that `wrangler dev` uses to its R2 `games/<id>/index.html`, where the Worker serves it, rewriting Bubble Pop's page to
// the runtime's v2 (v1 is no longer served). Running it again rewrites the same objects. Production's D1 is past
// migrations/*_games_are_files.sql, which dropped the HTML.
import { readdirSync, readFileSync } from "node:fs";

import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

export const copyGames = async (DB, FILES) => {
  const { results } = await DB.prepare(
    "SELECT id, html FROM games WHERE published = 1"
  ).all();
  await Promise.all(
    results.map(({ html, id }) =>
      FILES.put(
        `games/${id}/index.html`,
        html.replaceAll("/runtime/v1.js", "/runtime/v2.js")
      )
    )
  );
  return results.map(({ id }) => id);
};

const proxy = (persist) =>
  getPlatformProxy({
    configPath: new URL("games-to-r2.jsonc", import.meta.url).pathname,
    envFiles: [],
    persist,
    remoteBindings: false,
  });

// A local D1 already past the migration (a fresh clone's) holds only the originals, which the migrations before it
// seeded with the same ids: their HTML comes from those migrations, replayed in memory.
const seeded = async () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  const before = files.slice(
    0,
    files.findIndex((f) => f.endsWith("_games_are_files.sql"))
  );
  const memory = await proxy(false);
  const { DB } = memory.env;
  await DB.batch(
    before.flatMap((f) =>
      unstable_splitSqlQuery(readFileSync(new URL(f, dir), "utf-8")).map((s) =>
        DB.prepare(s)
      )
    )
  );
  return memory;
};

if (import.meta.main) {
  const target = await proxy({
    path: new URL("../.wrangler/state/v3", import.meta.url).pathname,
  });
  const { results } = await target.env.DB.prepare(
    "SELECT name FROM pragma_table_info('games') WHERE name = 'html'"
  ).all();
  const source = results.length > 0 ? target : await seeded();
  try {
    const ids = await copyGames(source.env.DB, target.env.FILES);
    console.log(
      `Copied ${ids.length} games to local R2 (ids ${ids.join(", ")}).`
    );
  } finally {
    await Promise.all([...new Set([source, target])].map((p) => p.dispose()));
  }
}
