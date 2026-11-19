import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Color } from "three";
import type { Mesh } from "three";

const ORANGE = new Color("orange");

const Spinner = () => {
  const mesh = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (mesh.current) {
      mesh.current.rotation.y += delta;
    }
    hopon.testVars.frames = Number(hopon.testVars.frames ?? 0) + 1;
  });
  return (
    <mesh ref={mesh}>
      <boxGeometry />
      <meshBasicMaterial color={ORANGE} />
    </mesh>
  );
};

const paused = () => hopon.paused;

// The feed's pause stops r3f's loop.
const Game = () => {
  const away = useSyncExternalStore(hopon.subscribe, paused);
  return (
    <Canvas
      frameloop={away ? "never" : "always"}
      onCreated={() => hopon.ready()}
    >
      <Spinner />
    </Canvas>
  );
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<Game />);
}
