# Panels over a Phaser game

Read this after `references/phaser.md`, for a Phaser game with a panel of words and buttons: a shop, an inventory, an upgrade screen, a dialogue. A game with only a score, lives or a timer draws them in the scene and needs none of this. `references/phaser-panels-example.md` is a whole game built this way.

- **`src/panels.tsx` is the bridge.** `node /opt/hopon/starter.js panels` writes it: in the new-game command, or alone to add panels to a Phaser game that has none. Read it, and keep it as it is.
- **`src/main.tsx` makes the Phaser game** as the Phaser guide shows, then calls `showPanels(<Panels />)` once, with the game's own component.
- **The scene owns the world, React owns the panels.** Neither reaches into the other: the scene calls `emit` and `listen`, a component `emit` and `useEvent`. Keep the rules both sides use as data and pure functions in `src/rules.ts`, with no React and no Phaser.
- **Taps pass through the panels' layer to the canvas.** Give each panel `pointer-events: auto`, so a tap on it never reaches the scene. Never shrink the canvas to make room for a panel.
- **Call hopon from a handler or an effect,** never inside a `setState` updater.
- **The scene stops for an open panel when it must.** If the world would move on under a panel that covers it (enemies, a timer), emit when the panel opens and closes, and skip the gameplay part of `update` while it is open.
- **`hopon.testVars`:** the panels' values in the render body, the scene's in `update`.
- **A tap in a test lands on what is on top.** Lay a panel out from the bottom with fixed heights, so its buttons are where the tests tap on any phone, and put a world tap clear of every panel.
- **Import from `react` and `react-dom/client` only.** Any other React path (`react-dom`, `react/jsx-dev-runtime`) fails the build.
- **Make a panel look like the game:** a card in the game's palette, the scene's dark ink for its border, a big radius, a hard drop shadow, and buttons at least 48 px tall that sink when pressed. Never the browser's grey buttons. Use system fonts, and emoji or CSS shapes for icons.
