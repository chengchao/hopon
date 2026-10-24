// `pnpm -F worker games-to-r2 [--remote]`: once, BEFORE migrations/*_games_are_files.sql reaches that D1 (#145). Copies
// each published Game's HTML from D1 to R2 `games/<id>/index.html`, where the Worker now serves it; the migration then
// drops the HTML, so a D1 migrated first has lost it. --remote is production (the deploy applies migrations); without it,
// the local D1 and R2 that `wrangler dev` uses. Running it again rewrites the same objects. Bubble Pop's page moves to
// the runtime's v2: v1 is no longer served.
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

const proxy = (remote, persist) =>
  getPlatformProxy({
    configPath: new URL("games-to-r2.jsonc", import.meta.url).pathname,
    envFiles: [],
    persist,
    remoteBindings: remote,
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
  const memory = await proxy(false, false);
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
  const remote = process.argv.includes("--remote");
  const target = await proxy(
    remote,
    remote
      ? false
      : { path: new URL("../.wrangler/state/v3", import.meta.url).pathname }
  );
  const { results } = await target.env.DB.prepare(
    "SELECT name FROM pragma_table_info('games') WHERE name = 'html'"
  ).all();
  const source = remote || results.length > 0 ? target : await seeded();
  try {
    const ids = await copyGames(source.env.DB, target.env.FILES);
    console.log(
      `${remote ? "Remote" : "Local"}: copied ${ids.length} games to R2 (ids ${ids.join(", ")}).`
    );
  } finally {
    await Promise.all([...new Set([source, target])].map((p) => p.dispose()));
  }
}
