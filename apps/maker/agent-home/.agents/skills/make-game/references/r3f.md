# Writing a hopon game in React Three Fiber

React Three Fiber (r3f) is for games in 3D: racers, endless runners, flyers, 3D dodgers. The box has three 0.187.0, @react-three/fiber 9.8.2 and React 19.3.1. There is no drei, no rapier, no postprocessing, no zustand and no network, so this guide shows the hand-written parts you need: a follow camera, collisions, instancing, a sky, fog, shadows and a HUD.

## The project

```
index.html        the page: copy it from the example, change only <title> and the background colour
vite.config.ts    copy it from the example
tsconfig.json     copy it from the example
design.md
tests.json
src/main.tsx      the Canvas, the HUD, the touch controls and the hopon wiring
src/world.ts      the game's state and rules: plain objects and numbers, no React and no three
src/scene.tsx     the meshes, lights, sky and camera, and the one useFrame that steps the world
```

- Add files under `src/` when they help, such as `src/models.tsx`. The entry is always `src/main.tsx`.
- The page's `<title>` is the start screen's title. Set `hopon.hint` in `main.tsx` for the line under it.
- Import from `three`, `@react-three/fiber` (`Canvas`, `useFrame`, `useThree`), `react` and `react-dom/client`. Import nothing else from those packages. `three/webgpu`, `three/tsl` and `react-dom` fail the build as "built into the game".
- three's addons are allowed, with the `.js` ending, such as `import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"` and `import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"`.
- There are no model or image files. Build every model from three's shapes (see "Make it look good") and draw textures on a canvas.

## The hopon wiring

`src/main.tsx` renders the Canvas and the DOM around it, and follows the scaffold:

```tsx
import { Canvas } from "@react-three/fiber";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { Scene } from "./scene";
import { reset } from "./world";

hopon.hint = "Tap left or right to change lanes";

let lastState = hopon.state;
hopon.subscribe(() => {
  if (hopon.state === "play" && lastState !== "play") reset();
  lastState = hopon.state;
});

const paused = () => hopon.paused;

const Game = () => {
  const away = useSyncExternalStore(hopon.subscribe, paused);
  return (
    <div style={{ height: "100%", position: "relative" }}>
      <Canvas
        camera={{ far: 400, near: 0.5, position: [0, 3.7, 6.4] }}
        dpr={[1, 2]}
        frameloop={away ? "never" : "always"}
        gl={{ antialias: false }}
        onCreated={() => hopon.ready()}
      >
        <Scene />
      </Canvas>
      {/* the HUD and the touch layer: DOM, above the canvas */}
    </div>
  );
};

const root = document.querySelector("#root");
if (root) createRoot(root).render(<Game />);
```

- **`hopon.ready()`** goes in `onCreated`. Without it the build fails after 10 s.
- **Gameplay runs only while `hopon.state === "play"`.** Gate spawns, timers, collisions and scoring on it. Behind the start and over screens, keep a calm idle scene moving (the road scrolls slowly, the sea rolls), so the start screen looks alive.
- **Reset when a round starts.** The module-level subscription above calls `reset()` when the state becomes `"play"`. `reset()` puts every value back: positions, speed, lives, timers, pools. A second round that starts with the first round's leftovers is the most common restart bug.
- **Pause.** `frameloop="never"` stops r3f's loop and every `useFrame`. Nothing else is needed, as long as all motion lives in `useFrame` and not in `setTimeout` or `setInterval`.
- **`hopon.testVars`.** Write the values tests read in the main `useFrame`, every frame, from the world's real state.
- **Score and end:** `hopon.addScore(n)` and `hopon.gameOver(won)`. The scaffold draws no HUD during play, so the game draws its own score.
- **The start tap is the scaffold's.** Its press, release and click never reach the game. The next touch is the player's first.
- For sound effects, read `references/sound-effects.md`.

## Game state lives outside React

A frame is 16 ms. A React re-render every frame is too slow and makes the game stutter, so the game's state is a plain mutable object, and React only builds the scene once.

- **One `world` object** in `src/world.ts` holds everything that changes during play: the player, the obstacle pool, speed, timers, lives. One `step(dt)` function moves it, checks hits, scores and spawns. It knows nothing about three.
- **One `useFrame` calls `step`**, mounted first in `<Scene>` (useFrames run in mount order). Every other `useFrame` copies world values onto its meshes through refs, as in `ref.current.position.x = world.x`.
- **Pools, not mounting.** Make a fixed number of obstacle groups once (`world.cars.map(...)`) and toggle `visible` and `position` in `useFrame`. Never add or remove JSX elements as things spawn.
- **React state only for what the HUD shows and changes rarely**, such as the score (`useSyncExternalStore(hopon.subscribe, () => hopon.score)`), lives and the phase. Give such values a tiny store with `subscribe`, as the example's `subscribeLives`. Never call `setState` from `useFrame`.
- **A HUD number that changes every frame** (a speedometer, a timer) goes straight into a DOM ref (`speedo.current.textContent = ...`), only when the shown value changes.

## Time and movement

- In `useFrame((state, delta) => ...)`, `delta` is the seconds since the last frame. Clamp it once, `const dt = Math.min(delta, 0.05)`, and pass `dt` to everything, so a slow frame never moves things through walls.
- Move by speed times time, as in `z += speed * dt`, never by a fixed amount per frame.
- Ease toward a target with `x += (target - x) * Math.min(1, dt * 12)`. It is quick, smooth and independent of the frame rate. Use it for lane changes, the camera and the HUD's flash.
- Keep the game's own clock (`world.time += dt`). r3f's `state.clock.elapsedTime` restarts at 0 whenever `frameloop` changes, which is every pause.
- An endless game moves the world toward the player, who stays near the origin. Recycle scenery by position with `z = start + ((i * gap + world.scroll) % (count * gap))`.

## r3f 9 and three 0.187 traps

- **JSX names are three's classes in lower camel case:** `<mesh>`, `<group>`, `<instancedMesh>`, `<points>`, `<hemisphereLight>`. `args` is the constructor's arguments as an array, as in `<instancedMesh args={[geometry, material, count]} />`. Changing `args` rebuilds the object. Nested properties use dashes: `shadow-mapSize={[1024, 1024]}`, `position-y={2}`. `<fog attach="fog" args={[color, near, far]} />` sets `scene.fog`.
- **Make geometries and materials once, at module level,** and pass them as props (`<mesh geometry={box} material={paint} />`). Inline `<boxGeometry />` children make one per mesh.
- **`useFrame` and `useThree` work only inside `<Canvas>`.** The HUD and the touch layer are DOM next to the Canvas, not inside it.
- **Never give `useFrame` a priority** (its second argument). Any priority above 0 turns off r3f's own render, and the screen freezes.
- **The default camera** is a 75° perspective camera at `[0, 0, 5]` with `near: 0.1, far: 1000`. Set it with the Canvas's `camera` prop, then move it in `useFrame`. Its `fov` is vertical, so on a tall phone set it from the width you need to see (the example's `Rig`).
- **Colour is managed.** Hex and CSS colours are sRGB and come out as written. r3f turns on ACES filmic tone mapping, which softens bright and saturated colours. Add the Canvas prop `flat` to turn it off when the palette looks washed out. A `ShaderMaterial` must end its fragment shader with `#include <colorspace_fragment>`, or its colours come out too dark.
- **Lights are physical.** Good starting points: `hemisphereLight` intensity 1.5, `directionalLight` 2 to 3. A `pointLight` or `spotLight` fades with distance squared and needs an intensity in the tens to show. `ambientLight` alone makes everything flat: always pair it with a directional light, or use a hemisphere light instead.
- **Shadows:** the Canvas prop `shadows` (true) asks for `PCFSoftShadowMap`, which three 0.187 removed, and logs a warning. Write `shadows="percentage"`.
- **r3f 9 logs "THREE.Clock: This module has been deprecated"** on every page. It is a warning from r3f itself, not your code. Ignore it, and use `delta` rather than a `Clock`.
- **A moving `instancedMesh` or `points` needs `frustumCulled={false}`.** three measures its bounds once, from the first positions, and then hides it whenever that first spot is off screen.
- **After `setMatrixAt`, set `mesh.instanceMatrix.needsUpdate = true`.** After writing a `BufferAttribute`'s array, set `attribute.needsUpdate = true`.
- **`Math.random` is seeded in the playtest, but three draws from it for every object's id,** so adding a mesh changes which lanes later spawn. Never draw it every frame (a camera shake that calls it when the shake is zero shifts every later spawn by load time), and never write a test that depends on where a random thing appears.
- **The Canvas fills its parent.** `html, body, #root` need `height: 100%`, as in the example's `index.html`.

## Touch controls

Put one full-screen `div` above the Canvas with `touchAction: "none"` and pointer handlers on it. Read sizes from the real screen (`innerWidth`, `innerHeight`), never a fixed 360 × 640, since phones are often taller. Show where to touch: draw 64 px buttons or arrows where the controls are, and keep every target at least 48 CSS px.

Tap a half to move one lane, or swipe (the example's controls):

```tsx
const down = useRef<{ id: number; x: number } | null>(null);
const onDown = (e: PointerEvent) => {
  down.current = { id: e.pointerId, x: e.clientX };
};
const onUp = (e: PointerEvent) => {
  const start = down.current;
  down.current = null;
  if (!start || start.id !== e.pointerId) return;
  const dx = e.clientX - start.x;
  if (Math.abs(dx) > 24) steer(dx < 0 ? -1 : 1);
  else steer(e.clientX < innerWidth / 2 ? -1 : 1);
};
```

To drag to steer (a racer or flyer that moves freely), map the finger's x across the screen to a target x in the world, and let `step` ease the player toward it.

```tsx
const onMove = (e: PointerEvent) => {
  if (e.buttons === 0 && e.pointerType === "mouse") return;
  world.targetX = (e.clientX / innerWidth - 0.5) * 2 * ROAD_HALF_WIDTH;
};
```

To hold to act (boost, climb, charge), set a flag on `pointerdown`, clear it on `pointerup` and `pointercancel`, and read it in `step`. For a jump on tap, act in `onPointerDown`, so the jump is instant.

## Hits and collisions

Check every hit yourself in `step`, with plain numbers. There is no physics engine, and you need none.

```ts
// Boxes: half sizes, a bit smaller than the drawn model, so near misses count as misses.
const boxesHit = (
  ax: number,
  az: number,
  aw: number,
  ad: number,
  bx: number,
  bz: number,
  bw: number,
  bd: number
) => Math.abs(ax - bx) < aw + bw && Math.abs(az - bz) < ad + bd;

// Spheres: compare squared distances, no square root.
const spheresHit = (a: Vector3, ar: number, b: Vector3, br: number) =>
  a.distanceToSquared(b) < (ar + br) ** 2;
```

- A box test on x and z is enough for anything on the ground. Add y only when things jump or fly.
- After a hit, give the player about a second where nothing hurts (blink the model meanwhile), and remove or knock away what was hit, so one crash costs one life.
- A fast object moves far in one frame. Keep obstacles at least as deep as `speed * 0.05`, the clamped frame, or test the path between the old and new position.
- Ground the player with `y = Math.max(0, y)` after gravity (`vy -= 30 * dt; y += vy * dt`), and allow a jump only when `y === 0`.

## Fair games

- **The first threat reaches the player after about 2 seconds,** and the player can always see a threat for at least a second before it arrives (spawn distance divided by closing speed). Spawn inside the fog, where it fades in, not in plain sight.
- **Never block every way through.** In lanes, block at most all but one, and space rows so the player can cross two lanes between them. Put a pickup in the free lane to show the way.
- **Forgiving:** danger hitboxes a little smaller than the model, pickup hitboxes a little bigger.
- **Everything that matters is in the camera's view and big enough to read** at 360 × 640: check the screenshots. A threat that is a few pixels at the horizon until it hits is not fair.
- Ramp difficulty slowly, speed or spawn rate up by a few percent a second, with a cap.

## Performance

Aim for 60 frames a second on a mid-range phone. The box's playtest renders with a software GPU, so a heavy scene also makes every playtest slow. The example's 10 s of play take about 5 s there.

- **Draw calls.** Every visible mesh is one draw call, and one more for each shadow pass. Keep the scene under about 100. Draw repeated things (trees, dashes, posts, coins, rocks) as one `instancedMesh` each.
- **Make once.** Geometries, materials, textures, `Object3D` helpers, `Vector3`s and `Color`s at module level. In `useFrame`, allocate nothing: no `new`, no array or object literals, no `forEach` closures, no template strings unless the value changed. Reuse one `dummy` `Object3D` to build instance matrices.
- **Pools.** A fixed number of obstacles, coins and particles, reused.
- **`dpr={[1, 2]}`.** A phone at 3x draws more than twice the pixels of 2x for no visible gain.
- **`gl={{ antialias: false }}`.** At 2x on a phone the edges stay smooth, and in the box antialiasing was the biggest single cost, about a quarter of the playtest's time.
- **Cheap materials for big surfaces.** `MeshLambertMaterial` or `MeshBasicMaterial` for ground, road, scenery and anything that glows; `MeshStandardMaterial` only for the player and the things the eye follows.
- **Blob shadows over shadow maps.** A dark, soft, transparent disc under each object grounds it for almost nothing (the example's `blob`). For real shadows, use one `directionalLight`, `shadows="percentage"`, `shadow-mapSize={[1024, 1024]}`, the shadow camera's bounds tight around the play area, `castShadow` only on the player and obstacles, `receiveShadow` only on the ground.
- **Fog** hides the far end, so you can spawn and recycle there without anything popping in.

## Make it look good

The eval judges looks, and a grey box on a grey plane loses. Spend about a third of the code on looks.

- **A palette.** 5 to 7 colours that belong together: a sky pair (top and horizon), a ground colour, the player's colour, 3 or 4 colours for obstacles, one glowing accent. The example's sunset has an indigo to peach sky, green fields, a teal car, coral, gold and violet traffic, and pink neon.
- **A sky, not a flat colour.** A big sphere around the scene with a gradient shader, and a sun in it:

```ts
const sky = new ShaderMaterial({
  depthWrite: false,
  side: BackSide,
  uniforms: { horizon: { value: HORIZON }, top: { value: SKY_TOP } },
  vertexShader: `varying vec3 dir;
    void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 dir;
    void main() {
      vec3 d = normalize(dir);
      vec3 color = mix(horizon, top, pow(clamp(d.y * 2.2, 0.0, 1.0), 0.6));
      float sun = max(dot(d, normalize(vec3(0.0, 0.08, -1.0))), 0.0);
      color += vec3(1.0, 0.75, 0.35) * (smoothstep(0.995, 0.997, sun) + pow(sun, 60.0) * 0.6);
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }`,
});
// <mesh geometry={new SphereGeometry(300, 32, 16)} material={sky} />, made at module level
```

Or colour the sphere's vertices. Loop over `dome.attributes.position`, `shade.lerpColors(HORIZON, SKY_TOP, y / radius)`, set a `color` attribute and use `new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false })`.

- **Fog the colour of the horizon,** so the ground melts into the sky (`<fog attach="fog" args={[HORIZON, 25, 85]} />`). Far backdrops (mountains, a skyline) get `fog: false` on their material and a colour already tinted toward the sky, or the fog erases them.
- **Light from two sources.** `<hemisphereLight args={[skyTint, groundTint, 1.6]} />` for soft fill from above and below, plus a warm `<directionalLight intensity={2.4} position={[-6, 10, 4]} />` from one side, so every shape has a lit face and a shaded face.
- **Materials.** `MeshStandardMaterial` with `roughness` 0.3 to 0.5 for cars and heroes (a little sheen), `flatShading: true` on low-poly scenery (cones, rocks, mountains) so each facet catches light differently. Things that glow (lights, neon, lasers, eyes) use `MeshBasicMaterial`: unlit, so they read as bright at any angle and cost less.
- **Models from primitives, grouped.** A car is a rounded chassis, a glass cabin, a roof, two wheel cylinders and a light bar. A character is a capsule body, a sphere head, two small black spheres for eyes and two boxes for feet:

```tsx
const body = new CapsuleGeometry(0.35, 0.5, 4, 12);
const head = new SphereGeometry(0.3, 16, 12);
const eye = new SphereGeometry(0.06, 8, 6);
const Hero = () => (
  <group>
    <mesh geometry={body} material={suit} position-y={0.6} />
    <mesh geometry={head} material={skin} position-y={1.25} />
    <mesh geometry={eye} material={ink} position={[-0.1, 1.3, -0.26]} />
    <mesh geometry={eye} material={ink} position={[0.1, 1.3, -0.26]} />
  </group>
);
```

Use `RoundedBoxGeometry` from three's addons for anything man-made, since rounded edges catch highlights that sharp boxes don't. Make heroes and obstacles big enough to read. The player car in the example fills a sixth of the screen's width.

- **Depth and motion.** Layers at different distances: the road, instanced trees and lamp posts at the roadside, mountains far away, the sky. Things that stream past (dashes, posts, grass bands) sell speed. Lean the player into turns (`rotation.z`, `rotation.y` from how far it is from its target).
- **Ground everything** with a blob shadow, a flat plane under the object with a radial-gradient texture, `transparent: true, depthWrite: false`, a few millimetres above the ground.
- **Juice on every event.**
  - **Particles.** One `points` with a fixed pool, `PointsMaterial({ vertexColors: true, map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true })`; a burst sets positions, velocities and lifetimes, and `useFrame` moves them with gravity. Gold for a pickup, orange for a crash.
  - **Camera shake.** Set `world.shake = 0.6` on a hit, decaying by `dt * 2.5`; add a random offset scaled by `shake * shake` to the camera only while it's above zero.
  - **Hit flash.** Blink the player's `emissiveIntensity`, and fade a red radial-gradient `div` over the screen with the shake.
  - **Pickups bob and spin,** with `Math.sin`, spin with `rotation.y`.
- **A follow camera** behind and above the player, looking ahead, with lag:

```ts
const offset = new Vector3(0, 3, 7);
const want = new Vector3();
const UP = new Vector3(0, 1, 0);
useFrame((state, delta) => {
  const dt = Math.min(delta, 0.05);
  want.copy(offset).applyAxisAngle(UP, player.rotation.y).add(player.position);
  state.camera.position.lerp(want, Math.min(1, dt * 6));
  state.camera.lookAt(
    player.position.x,
    player.position.y + 1,
    player.position.z - 4
  );
});
```

Keep the player in the lower third of the screen, with the way ahead filling the rest.

- **The HUD is DOM over the Canvas.** System font, weight 800, at least 20 px, white with a dark outline (`textShadow: "0 2px 0 #1b1030, 0 0 8px #1b1030"`). Score top left, lives top right, control hints at the bottom. `pointerEvents: "none"` on the HUD so touches reach the controls.

## Example: Sunset Rush

A three-lane racer. Tap a side or swipe to change lanes, overtake a car for a point, grab a coin for three, and three crashes end the round. The playtest and the four tests below, including the pause test, ran green in the box with no console error.

Take its patterns, not its game. Even when the Creator asks for a racer, yours has its own name, setting, vehicle, palette, obstacles and scoring, from your design.

### `index.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Sunset Rush</title>
    <style>
      html,
      body,
      #root {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: #2a1b4a;
      }
    </style>
    <script src="/hopon/v1.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `vite.config.ts`

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react()] });
```

### `tsconfig.json`

```json
{
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
```

### `src/main.tsx`

```tsx
import { Canvas } from "@react-three/fiber";
import { useRef, useSyncExternalStore } from "react";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import { createRoot } from "react-dom/client";

import { Scene, SKY_TOP } from "./scene";
import { reset, steer, subscribeLives, world } from "./world";

hopon.hint = "Tap left or right to change lanes";

let lastState = hopon.state;
hopon.subscribe(() => {
  if (hopon.state === "play" && lastState !== "play") reset();
  lastState = hopon.state;
});

const SWIPE_PX = 24;
const TEXT: CSSProperties = {
  color: "#fff",
  font: "800 22px system-ui, sans-serif",
  textShadow: "0 2px 0 #1b1030, 0 0 8px #1b1030",
};

const Controls = () => {
  const down = useRef<{ id: number; x: number } | null>(null);
  const onDown = (e: PointerEvent) => {
    down.current = { id: e.pointerId, x: e.clientX };
  };
  const onUp = (e: PointerEvent) => {
    const start = down.current;
    down.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > SWIPE_PX) steer(dx < 0 ? -1 : 1);
    else steer(e.clientX < innerWidth / 2 ? -1 : 1);
  };
  return (
    <div
      onPointerCancel={() => {
        down.current = null;
      }}
      onPointerDown={onDown}
      onPointerUp={onUp}
      style={{ inset: 0, position: "absolute", touchAction: "none" }}
    >
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          style={{
            ...TEXT,
            alignItems: "center",
            background: "rgba(255,255,255,0.16)",
            border: "2px solid rgba(255,255,255,0.4)",
            borderRadius: 32,
            bottom: 28,
            display: "flex",
            fontSize: 30,
            height: 64,
            justifyContent: "center",
            position: "absolute",
            [side]: 24,
            width: 64,
          }}
        >
          {side === "left" ? "◀" : "▶"}
        </div>
      ))}
    </div>
  );
};

const Hud = ({ speedo }: { speedo: RefObject<HTMLDivElement | null> }) => {
  const score = useSyncExternalStore(hopon.subscribe, () => hopon.score);
  const lives = useSyncExternalStore(subscribeLives, () => world.lives);
  return (
    <div style={{ inset: 0, pointerEvents: "none", position: "absolute" }}>
      <div
        style={{
          ...TEXT,
          fontSize: 36,
          left: 18,
          position: "absolute",
          top: 12,
        }}
      >
        {score}
      </div>
      <div
        style={{
          ...TEXT,
          color: "#ff5f7e",
          letterSpacing: 4,
          position: "absolute",
          right: 16,
          top: 18,
        }}
      >
        {"♥".repeat(lives)}
        <span style={{ opacity: 0.3 }}>{"♥".repeat(3 - lives)}</span>
      </div>
      <div
        ref={speedo}
        style={{
          ...TEXT,
          bottom: 46,
          fontSize: 20,
          left: 0,
          position: "absolute",
          right: 0,
          textAlign: "center",
        }}
      />
    </div>
  );
};

const paused = () => hopon.paused;

const Game = () => {
  const away = useSyncExternalStore(hopon.subscribe, paused);
  const flash = useRef<HTMLDivElement>(null);
  const speedo = useRef<HTMLDivElement>(null);
  return (
    <div style={{ height: "100%", position: "relative" }}>
      <Canvas
        camera={{ far: 400, near: 0.5, position: [0, 3.7, 6.4] }}
        dpr={[1, 2]}
        gl={{ antialias: false }}
        frameloop={away ? "never" : "always"}
        onCreated={() => hopon.ready()}
        scene={{ background: SKY_TOP }}
      >
        <Scene flash={flash} speedo={speedo} />
      </Canvas>
      <div
        ref={flash}
        style={{
          background: "radial-gradient(circle, transparent 45%, #ff2d55 130%)",
          inset: 0,
          opacity: 0,
          pointerEvents: "none",
          position: "absolute",
        }}
      />
      <Controls />
      <Hud speedo={speedo} />
    </div>
  );
};

const root = document.querySelector("#root");
if (root) createRoot(root).render(<Game />);
```

### `src/world.ts`

```ts
export const LANES = [-1.8, 0, 1.8];
export const CAR_COLORS = [0xff_5a_5f, 0xff_c1_45, 0x8f_6b_ff, 0xf4_f1_e8];
export const SPAWN_Z = -70;
const LIVES = 3;
const TRAFFIC_SPEED = 6;
const HIT_HALF_WIDTH = 0.85;
const HIT_HALF_LENGTH = 1.5;
const COIN_REACH = 1.1;

export interface Car {
  active: boolean;
  passed: boolean;
  lane: number;
  z: number;
}

export interface Coin {
  active: boolean;
  lane: number;
  z: number;
}

export type Burst = (
  x: number,
  z: number,
  color: number,
  count: number
) => void;

export const world = {
  cars: Array.from({ length: 10 }, (): Car => ({
    active: false,
    lane: 0,
    passed: false,
    z: 0,
  })),
  coins: Array.from({ length: 6 }, (): Coin => ({
    active: false,
    lane: 0,
    z: 0,
  })),
  distance: 0,
  hurt: 0,
  lane: 1,
  lives: LIVES,
  passed: 0,
  scroll: 0,
  shake: 0,
  spawnIn: 0,
  speed: 0,
  time: 0,
  x: 0,
};

const livesListeners = new Set<() => void>();
export const subscribeLives = (listener: () => void) => {
  livesListeners.add(listener);
  return () => livesListeners.delete(listener);
};
const setLives = (lives: number) => {
  world.lives = lives;
  for (const listener of livesListeners) {
    listener();
  }
};

export const reset = () => {
  for (const car of world.cars) car.active = false;
  for (const coin of world.coins) coin.active = false;
  Object.assign(world, {
    distance: 0,
    hurt: 0,
    lane: 1,
    passed: 0,
    shake: 0,
    spawnIn: 0.3,
    speed: 22,
    time: 0,
    x: 0,
  });
  setLives(LIVES);
};

export const steer = (direction: -1 | 1) => {
  if (hopon.state === "play") {
    world.lane = Math.min(2, Math.max(0, world.lane + direction));
  }
};

const spawnRow = () => {
  const blocked = Math.random() < Math.min(0.5, world.time / 60) ? 2 : 1;
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
  for (const lane of lanes.slice(0, blocked)) {
    const car = world.cars.find((c) => !c.active);
    if (car) {
      Object.assign(car, { active: true, lane, passed: false, z: SPAWN_Z });
    }
  }
  const coin = world.coins.find((c) => !c.active);
  if (coin && Math.random() < 0.6) {
    Object.assign(coin, { active: true, lane: lanes[2], z: SPAWN_Z });
  }
};

export const step = (dt: number, burst: Burst) => {
  const playing = hopon.state === "play";
  if (playing) {
    world.speed = Math.min(40, 22 + world.time * 0.3);
  } else if (hopon.state === "start") {
    world.speed = 10;
  } else {
    world.speed *= Math.max(0, 1 - dt * 1.5);
  }
  world.scroll += world.speed * dt;
  world.x += (LANES[world.lane] - world.x) * Math.min(1, dt * 12);
  world.shake = Math.max(0, world.shake - dt * 2.5);
  world.hurt = Math.max(0, world.hurt - dt);
  if (!playing) {
    return;
  }
  world.time += dt;
  world.distance += world.speed * dt;
  world.spawnIn -= dt;
  if (world.spawnIn <= 0) {
    spawnRow();
    world.spawnIn = Math.max(0.55, 1.2 - world.time * 0.012);
  }
  for (const car of world.cars) {
    if (!car.active) continue;
    car.z += (world.speed - TRAFFIC_SPEED) * dt;
    const carX = LANES[car.lane];
    if (
      world.hurt === 0 &&
      Math.abs(carX - world.x) < HIT_HALF_WIDTH &&
      Math.abs(car.z) < HIT_HALF_LENGTH
    ) {
      world.hurt = 1.2;
      world.shake = 0.6;
      car.active = false;
      burst(carX, car.z, 0xff_8a_3d, 50);
      setLives(world.lives - 1);
      if (world.lives === 0) {
        hopon.gameOver(false);
      }
    }
    if (car.active && !car.passed && car.z > 2) {
      car.passed = true;
      world.passed += 1;
      hopon.addScore(1);
    }
    if (car.z > 12) car.active = false;
  }
  for (const coin of world.coins) {
    if (!coin.active) continue;
    coin.z += (world.speed - TRAFFIC_SPEED) * dt;
    if (
      Math.abs(LANES[coin.lane] - world.x) < COIN_REACH &&
      Math.abs(coin.z) < COIN_REACH
    ) {
      coin.active = false;
      burst(LANES[coin.lane], 0, 0xff_d1_4a, 24);
      hopon.addScore(3);
    }
    if (coin.z > 12) coin.active = false;
  }
};
```

### `src/scene.tsx`

```tsx
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Group, InstancedMesh, PerspectiveCamera } from "three";

import { CAR_COLORS, LANES, SPAWN_Z, step, world } from "./world";
import type { Burst } from "./world";

export const SKY_TOP = new Color("#2a1b4a");
export const HORIZON = new Color("#ff9a76");

const glowTexture = (inner: string, outer: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const c = canvas.getContext("2d");
  if (c) {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(canvas);
};

const box = new BoxGeometry(1, 1, 1);
const chassis = new RoundedBoxGeometry(1.2, 0.42, 2.3, 3, 0.12);
const cabin = new RoundedBoxGeometry(1, 0.34, 1.1, 3, 0.1);
const wheel = new CylinderGeometry(0.27, 0.27, 1.26, 12).rotateZ(Math.PI / 2);
const cone = new ConeGeometry(1, 1, 6);
const trunk = new CylinderGeometry(0.12, 0.16, 1, 5);
const coinShape = new CylinderGeometry(0.42, 0.42, 0.12, 20).rotateX(
  Math.PI / 2
);
const flat = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const dome = new SphereGeometry(300, 32, 16);

const glass = new MeshStandardMaterial({
  color: "#7fc8ff",
  emissive: "#1b3a66",
  metalness: 0.3,
  roughness: 0.15,
});
const tyre = new MeshLambertMaterial({ color: "#1a1a22" });
const tail = new MeshBasicMaterial({ color: "#ff2d55" });
const head = new MeshBasicMaterial({ color: "#fff3c4" });
const stripe = new MeshLambertMaterial({ color: "#ffffff" });
const pole = new MeshLambertMaterial({ color: "#2b2540" });
const paints = CAR_COLORS.map(
  (color) => new MeshStandardMaterial({ color, roughness: 0.35 })
);
const playerPaint = new MeshStandardMaterial({
  color: "#14b8a6",
  emissive: "#ffffff",
  emissiveIntensity: 0,
  roughness: 0.3,
});
const blob = new MeshBasicMaterial({
  depthWrite: false,
  map: glowTexture("rgba(10,0,30,0.55)", "rgba(10,0,30,0)"),
  transparent: true,
});
const road = new MeshLambertMaterial({ color: "#35324a" });
const ground = new MeshLambertMaterial({ color: "#5d9a58" });
const grass = new MeshLambertMaterial({ color: "#4f8a4e" });
const neon = new MeshBasicMaterial({ color: "#ff5fa2" });
const paint = new MeshBasicMaterial({ color: "#f4efe6" });
const leaves = new MeshLambertMaterial({ color: "#2f8f6a", flatShading: true });
const bark = new MeshLambertMaterial({ color: "#7a4b33" });
const mountain = new MeshLambertMaterial({
  color: "#8a5a9c",
  flatShading: true,
  fog: false,
});
const gold = new MeshStandardMaterial({
  color: "#ffc93c",
  emissive: "#ff9d00",
  emissiveIntensity: 0.7,
  metalness: 0.6,
  roughness: 0.3,
});

const sky = new ShaderMaterial({
  depthWrite: false,
  fragmentShader: `
    uniform vec3 top; uniform vec3 horizon; varying vec3 dir;
    void main() {
      vec3 d = normalize(dir);
      vec3 color = mix(horizon, top, pow(clamp(d.y * 2.2, 0.0, 1.0), 0.6));
      float sun = max(dot(d, normalize(vec3(0.0, 0.08, -1.0))), 0.0);
      color += vec3(1.0, 0.75, 0.35) * (smoothstep(0.995, 0.997, sun) + pow(sun, 60.0) * 0.6);
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }`,
  side: BackSide,
  uniforms: { horizon: { value: HORIZON }, top: { value: SKY_TOP } },
  vertexShader: `
    varying vec3 dir;
    void main() {
      dir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
});

const Car = ({
  body,
  player = false,
}: {
  body: MeshStandardMaterial;
  player?: boolean;
}) => (
  <>
    <mesh
      geometry={flat}
      material={blob}
      position={[0, 0.05, 0]}
      scale={[1.9, 1, 3]}
    />
    <mesh geometry={chassis} material={body} position={[0, 0.48, 0]} />
    <mesh geometry={cabin} material={glass} position={[0, 0.82, 0.2]} />
    <mesh
      geometry={box}
      material={body}
      position={[0, 0.99, 0.2]}
      scale={[0.9, 0.04, 1]}
    />
    <mesh geometry={wheel} material={tyre} position={[0, 0.27, -0.75]} />
    <mesh geometry={wheel} material={tyre} position={[0, 0.27, 0.75]} />
    <mesh
      geometry={box}
      material={tail}
      position={[0, 0.58, 1.16]}
      scale={[1, 0.1, 0.03]}
    />
    {player && (
      <mesh
        geometry={box}
        material={stripe}
        position={[0, 0.7, -0.55]}
        scale={[0.26, 0.02, 1.2]}
      />
    )}
    {player && (
      <mesh
        geometry={box}
        material={stripe}
        position={[0, 1.02, 0.2]}
        scale={[0.26, 0.02, 1]}
      />
    )}
    {player && (
      <mesh
        geometry={box}
        material={head}
        position={[0, 0.52, -1.16]}
        scale={[1, 0.1, 0.03]}
      />
    )}
  </>
);

const Player = () => {
  const group = useRef<Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const lean = LANES[world.lane] - world.x;
    g.position.x = world.x;
    g.rotation.set(0, -lean * 0.2, -lean * 0.06);
    const blink =
      hopon.state === "play" &&
      world.hurt > 0 &&
      Math.floor(world.hurt * 10) % 2 === 0;
    playerPaint.emissiveIntensity = blink ? 0.9 : 0;
  });
  return (
    <group ref={group}>
      <Car body={playerPaint} player />
    </group>
  );
};

const Traffic = () => {
  const groups = useRef<(Group | null)[]>([]);
  useFrame(() => {
    for (let i = 0; i < world.cars.length; i += 1) {
      const g = groups.current[i];
      const car = world.cars[i];
      if (g) {
        g.visible = car.active;
        g.position.set(LANES[car.lane], 0, car.z);
      }
    }
  });
  return world.cars.map((_, i) => (
    <group
      key={i}
      ref={(g) => {
        groups.current[i] = g;
      }}
      visible={false}
    >
      <Car body={paints[i % paints.length]} />
    </group>
  ));
};

const DASHES = 32;
const LAMPS = 12;
const BANDS = 12;
const TREES = 24;
const PEAKS = 16;
const dummy = new Object3D();

const Scenery = () => {
  const dashes = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  const trunks = useRef<InstancedMesh>(null);
  const peaks = useRef<InstancedMesh>(null);
  const poles = useRef<InstancedMesh>(null);
  const bulbs = useRef<InstancedMesh>(null);
  const bands = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = peaks.current;
    if (!m) return;
    for (let i = 0; i < PEAKS; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const h = 16 + ((i * 7) % 5) * 6;
      dummy.position.set(
        side * (14 + ((i * 13) % 8) * 7),
        h / 2 - 1,
        -150 - ((i * 11) % 4) * 15
      );
      dummy.scale.set(h * 1.1, h, h * 1.1);
      dummy.rotation.set(0, i, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame(() => {
    const d = dashes.current;
    const c = crowns.current;
    const t = trunks.current;
    const p = poles.current;
    const b = bulbs.current;
    const g = bands.current;
    if (!d || !c || !t || !p || !b || !g) return;
    for (let i = 0; i < BANDS; i += 1) {
      dummy.position.set(
        0,
        0,
        SPAWN_Z + ((i * 8 + world.scroll) % (BANDS * 8))
      );
      dummy.scale.set(120, 1, 4);
      dummy.updateMatrix();
      g.setMatrixAt(i, dummy.matrix);
    }
    g.instanceMatrix.needsUpdate = true;
    dummy.rotation.set(0, 0, 0);
    for (let i = 0; i < DASHES; i += 1) {
      dummy.position.set(
        i % 2 === 0 ? -0.9 : 0.9,
        0.03,
        SPAWN_Z + ((i * 3 + world.scroll) % (DASHES * 3))
      );
      dummy.scale.set(0.12, 1, 1.6);
      dummy.updateMatrix();
      d.setMatrixAt(i, dummy.matrix);
    }
    for (let i = 0; i < TREES; i += 1) {
      const z = SPAWN_Z + ((i * 4 + world.scroll) % (TREES * 4));
      const x = (i % 2 === 0 ? -1 : 1) * (4.6 + ((i * 7) % 5) * 1.1);
      const s = 1.2 + ((i * 3) % 4) * 0.35;
      dummy.position.set(x, s * 0.8 + 0.7, z);
      dummy.scale.set(s * 0.8, s * 1.8, s * 0.8);
      dummy.updateMatrix();
      c.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 0.4, z);
      dummy.scale.set(s, 0.8, s);
      dummy.updateMatrix();
      t.setMatrixAt(i, dummy.matrix);
    }
    for (let i = 0; i < LAMPS; i += 1) {
      const x = i % 2 === 0 ? -3.3 : 3.3;
      const z =
        SPAWN_Z +
        ((Math.floor(i / 2) * 16 + world.scroll) % ((LAMPS / 2) * 16));
      dummy.position.set(x, 1.6, z);
      dummy.scale.set(0.12, 3.2, 0.12);
      dummy.updateMatrix();
      p.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x * 0.9, 3.2, z);
      dummy.scale.set(0.9, 0.16, 0.3);
      dummy.updateMatrix();
      b.setMatrixAt(i, dummy.matrix);
    }
    p.instanceMatrix.needsUpdate = true;
    b.instanceMatrix.needsUpdate = true;
    d.instanceMatrix.needsUpdate = true;
    c.instanceMatrix.needsUpdate = true;
    t.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <mesh geometry={dome} material={sky} />
      <mesh
        geometry={flat}
        material={ground}
        position={[0, -0.05, -100]}
        scale={[500, 1, 260]}
      />
      <mesh
        geometry={flat}
        material={road}
        position={[0, 0.02, -60]}
        scale={[5.6, 1, 160]}
      />
      <mesh
        geometry={box}
        material={neon}
        position={[-2.85, 0.04, -60]}
        scale={[0.14, 0.08, 160]}
      />
      <mesh
        geometry={box}
        material={neon}
        position={[2.85, 0.04, -60]}
        scale={[0.14, 0.08, 160]}
      />
      <instancedMesh
        args={[flat, grass, BANDS]}
        frustumCulled={false}
        ref={bands}
      />
      <instancedMesh
        args={[flat, paint, DASHES]}
        frustumCulled={false}
        ref={dashes}
      />
      <instancedMesh
        args={[cone, leaves, TREES]}
        frustumCulled={false}
        ref={crowns}
      />
      <instancedMesh
        args={[trunk, bark, TREES]}
        frustumCulled={false}
        ref={trunks}
      />
      <instancedMesh args={[cone, mountain, PEAKS]} ref={peaks} />
      <instancedMesh
        args={[box, pole, LAMPS]}
        frustumCulled={false}
        ref={poles}
      />
      <instancedMesh
        args={[box, head, LAMPS]}
        frustumCulled={false}
        ref={bulbs}
      />
    </>
  );
};

const Coins = () => {
  const mesh = useRef<InstancedMesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    for (let i = 0; i < world.coins.length; i += 1) {
      const coin = world.coins[i];
      dummy.position.set(
        LANES[coin.lane],
        coin.active ? 0.8 + Math.sin(world.scroll * 0.3 + i) * 0.12 : -50,
        coin.z
      );
      dummy.rotation.set(0, world.scroll * 0.25 + i, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      args={[coinShape, gold, world.coins.length]}
      frustumCulled={false}
      ref={mesh}
    />
  );
};

const SPARKS = 160;
const sparkPos = new Float32Array(SPARKS * 3).fill(-100);
const sparkColor = new Float32Array(SPARKS * 3);
const sparkVel = new Float32Array(SPARKS * 3);
const sparkLife = new Float32Array(SPARKS);
const sparkGeometry = new BufferGeometry();
sparkGeometry.setAttribute("position", new BufferAttribute(sparkPos, 3));
sparkGeometry.setAttribute("color", new BufferAttribute(sparkColor, 3));
const sparkMaterial = new PointsMaterial({
  blending: AdditiveBlending,
  depthWrite: false,
  map: glowTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)"),
  size: 0.35,
  transparent: true,
  vertexColors: true,
});
const tint = new Color();
let nextSpark = 0;

const burst: Burst = (x, z, color, count) => {
  tint.set(color);
  for (let n = 0; n < count; n += 1) {
    const i = nextSpark;
    nextSpark = (nextSpark + 1) % SPARKS;
    sparkPos.set([x, 0.7, z], i * 3);
    sparkVel.set(
      [
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 2,
        (Math.random() - 0.5) * 6,
      ],
      i * 3
    );
    sparkColor.set([tint.r, tint.g, tint.b], i * 3);
    sparkLife[i] = 0.5 + Math.random() * 0.4;
  }
};

const Sparks = () => {
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < SPARKS; i += 1) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 14 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += (sparkVel[i * 3 + 2] + world.speed) * dt;
      if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -100;
    }
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.color.needsUpdate = true;
  });
  return (
    <points
      frustumCulled={false}
      geometry={sparkGeometry}
      material={sparkMaterial}
    />
  );
};

const HFOV = 64;
const shakeOffset = new Vector3();
const shown = { kmh: -1, shake: 0 };

const Rig = ({ flash, speedo }: HudRefs) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    const half = Math.tan((HFOV * Math.PI) / 360) / (size.width / size.height);
    camera.fov = Math.min(100, (Math.atan(half) * 360) / Math.PI);
    camera.updateProjectionMatrix();
  }, [camera, size]);

  useFrame((_, delta) => {
    step(Math.min(delta, 0.05), burst);
    const s = world.shake * world.shake;
    camera.position.set(world.x * 0.6, 3.7, 6.4);
    if (s > 0)
      camera.position.add(
        shakeOffset
          .set(Math.random() - 0.5, Math.random() - 0.5, 0)
          .multiplyScalar(s)
      );
    camera.lookAt(world.x * 0.3, 0, -12);
    if (flash.current && (world.shake > 0 || shown.shake > 0))
      flash.current.style.opacity = String(world.shake);
    shown.shake = world.shake;
    const kmh = Math.round(world.speed * 6);
    if (speedo.current && kmh !== shown.kmh)
      speedo.current.textContent = `${kmh} km/h`;
    shown.kmh = kmh;
    const vars = hopon.testVars;
    vars.distance = world.distance;
    vars.lane = world.lane;
    vars.lives = world.lives;
    vars.passed = world.passed;
    vars.x = world.x;
  });
  return null;
};

export interface HudRefs {
  flash: RefObject<HTMLDivElement | null>;
  speedo: RefObject<HTMLDivElement | null>;
}

export const Scene = (refs: HudRefs) => (
  <>
    <fog args={[HORIZON, 25, 85]} attach="fog" />
    <hemisphereLight args={["#ffd1e8", "#3b5d3a", 1.6]} />
    <directionalLight color="#ffd9a8" intensity={2.4} position={[-6, 10, 4]} />
    <Rig {...refs} />
    <Scenery />
    <Player />
    <Traffic />
    <Coins />
    <Sparks />
  </>
);
```

### `tests.json`

```json
{
  "expose": [
    { "name": "lane", "means": "the player's lane: 0 left, 1 middle, 2 right" },
    {
      "name": "x",
      "means": "the player car's x position in world units; 0 is the middle lane"
    },
    { "name": "distance", "means": "metres driven this round" },
    { "name": "lives", "means": "lives left, 3 at the start" },
    { "name": "passed", "means": "cars overtaken this round" }
  ],
  "tests": [
    {
      "name": "tapping the right then the left half changes lanes",
      "inputs": [
        { "at": 100, "type": "tap", "x": 300, "y": 400 },
        { "at": 800, "type": "tap", "x": 60, "y": 400 },
        { "at": 1100, "type": "tap", "x": 60, "y": 400 }
      ],
      "checks": [
        { "at": 0, "expect": "vars.lane === 1 && vars.lives === 3" },
        { "at": 600, "expect": "vars.lane === 2 && vars.x > 1" },
        { "at": 1600, "expect": "vars.lane === 0 && vars.x < -1" }
      ]
    },
    {
      "name": "a swipe left changes lanes",
      "inputs": [
        { "at": 100, "type": "swipe", "x": 220, "y": 400, "dx": -120, "dy": 0 }
      ],
      "checks": [{ "at": 600, "expect": "vars.lane === 0" }]
    },
    {
      "name": "staying in one lane crashes three times, and a tap starts a fresh round",
      "inputs": [{ "at": 14500, "type": "tap", "x": 180, "y": 320 }],
      "checks": [
        { "at": 1000, "expect": "vars.distance > 10" },
        {
          "at": 14000,
          "expect": "state === 'over' && vars.lives === 0 && score > 0"
        },
        {
          "at": 15000,
          "expect": "state === 'play' && vars.lives === 3 && vars.distance < prev.vars.distance"
        }
      ]
    },
    {
      "name": "the road stops while the feed has it paused",
      "inputs": [
        { "at": 1000, "type": "pause" },
        { "at": 2500, "type": "resume" }
      ],
      "checks": [
        { "at": 1100, "expect": "vars.distance > 0" },
        { "at": 2400, "expect": "vars.distance === prev.vars.distance" },
        { "at": 3500, "expect": "vars.distance > prev.vars.distance" }
      ]
    }
  ]
}
```

## Checking your work

- **Playtest** with inputs that play the way a player would: taps on each half (`{"at": 500, "type": "tap", "x": 300, "y": 400}`), swipes (`"dx": -120, "dy": 0`). Look at both screenshots and check that the sky, the ground and the player are all on screen, nothing is grey or empty, the HUD reads. The start and end screenshots must differ, so keep something moving even behind the start screen.
- **Tests read `hopon.testVars`** as `vars`, written every frame from the world. Expose what the player sees happen (lane, x, distance, lives), not settings.
- **Every game has a pause test.** Pause, check a value that moves every frame stays put, resume, check it moves again:

```json
{
  "name": "the road stops while the feed has it paused",
  "inputs": [
    { "at": 1000, "type": "pause" },
    { "at": 2500, "type": "resume" }
  ],
  "checks": [
    { "at": 1100, "expect": "vars.distance > 0" },
    { "at": 2400, "expect": "vars.distance === prev.vars.distance" },
    { "at": 3500, "expect": "vars.distance > prev.vars.distance" }
  ]
}
```

- **Test a restart** when the game can end. Let it end, tap (180, 320), and check lives and distance are back at their start values.
- If a check fails with a value you didn't expect, the failure prints `vars` at that check and the one before. Read them before changing the game.
