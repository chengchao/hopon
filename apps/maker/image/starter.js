// `node /opt/hopon/starter.js` in the workspace: a new Vite game's skeleton (ADR 0008), the files every game has the
// same, so the agent writes only its own. It seeds only a workspace that holds no game, neither a Vite one
// (vite.config.ts) nor an old one (game.ts), so it can't overwrite a game. make-game runs it after emptying the
// workspace for a new game, and after deleting an old game's files to port it.
// `node /opt/hopon/starter.js panels` adds `src/panels.tsx`, the bridge between a Phaser scene and React panels over it,
// to a new game, or to a Vite game that has none, so a Phaser game can gain panels in a change. It never writes over one.
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

// React panels over a Phaser game. Its API holds the bridge's rules, so a game can't break them: the panels are their
// own React root, never the Phaser game's parent, so a render can't make a second game; a scene's listener goes when the
// scene shuts down; a panel's handler sees its latest render; an event carries one primitive; a new round remounts the
// panels.
const PANELS = `import { Events } from "phaser";
import type { Scene } from "phaser";
import { Fragment, useEffect, useEffectEvent } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

type Value = boolean | number | string | undefined;

const bus = new Events.EventEmitter();

export const emit = (event: string, value?: Value) => {
  bus.emit(event, value);
};

export const listen = <T extends Value>(
  scene: Scene,
  event: string,
  handle: (value: T) => void
) => {
  bus.on(event, handle, scene);
  scene.events.once("shutdown", () => bus.off(event, handle, scene));
};

export const useEvent = <T extends Value>(
  event: string,
  handle: (value: T) => void
) => {
  const onEvent = useEffectEvent(handle);
  useEffect(() => {
    const call = (value: T) => onEvent(value);
    bus.on(event, call);
    return () => {
      bus.off(event, call);
    };
  }, [event]);
};

export const showPanels = (panels: ReactNode) => {
  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none";
  document.body.append(layer);
  const root = createRoot(layer);
  let round = 0;
  let last = hopon.state;
  const render = () => {
    root.render(<Fragment key={round}>{panels}</Fragment>);
  };
  render();
  hopon.subscribe(({ state }) => {
    if (state === "play" && last !== "play") {
      round += 1;
      render();
    }
    last = state;
  });
};
`;

const panels = process.argv[2] === "panels";
const game = ["vite.config.ts", "game.ts"].find((file) => existsSync(file));
if (panels && game === "vite.config.ts") {
  if (existsSync("src/panels.tsx")) {
    console.log(
      "src/panels.tsx is here already: starter.js never writes over it."
    );
    process.exit(1);
  }
  mkdirSync("src", { recursive: true });
  writeFileSync("src/panels.tsx", PANELS);
  console.log("Seeded src/panels.tsx.");
  process.exit(0);
}
if (game) {
  console.log(
    `${game} is here, so this workspace holds a game: starter.js seeds only an empty one.`
  );
  process.exit(1);
}
const seeded = panels ? { ...FILES, "src/panels.tsx": PANELS } : FILES;
mkdirSync("src", { recursive: true });
for (const [file, text] of Object.entries(seeded)) {
  writeFileSync(file, text);
}
console.log(`Seeded ${Object.keys(seeded).join(", ")}.`);
