// `node /opt/hopon/starter.js` in the workspace: a new Vite game's skeleton (ADR 0008), the files every game has the
// same, so the agent writes only its own. It seeds only a workspace that holds no game, neither a Vite one
// (vite.config.ts) nor an old one (game.ts), so it can't overwrite a game. make-game runs it after emptying the
// workspace for a new game, and after deleting an old game's files to port it.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const FILES = {
  "index.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>hopon</title>
    <style>
      html,
      body,
      #root {
        margin: 0;
        height: 100%;
        overflow: hidden;
      }
      html {
        background: #000;
      }
    </style>
    <script src="/hopon/v2.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  "src/main.tsx": `// The game's entry: write it over this, as the engine's guide shows.
hopon.ready();
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["es2022", "dom"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "es2022",
    "types": []
  },
  "include": ["src"]
}
`,
  "vite.config.ts": `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react()] });
`,
};

const game = ["vite.config.ts", "game.ts"].find((file) => existsSync(file));
if (game) {
  console.log(
    `${game} is here, so this workspace holds a game: starter.js seeds only an empty one.`
  );
  process.exit(1);
}
mkdirSync("src", { recursive: true });
for (const [file, text] of Object.entries(FILES)) {
  writeFileSync(file, text);
}
console.log(`Seeded ${Object.keys(FILES).join(", ")}.`);
