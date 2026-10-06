import { useSyncExternalStore } from 'react';
import type { Game } from './api';

// ponytail: in-memory UI prototype state, lost on reload. Replace with API-backed saves.
type State = { saved: readonly Game[] };
let state: State = { saved: [] };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

export function toggleSave(game: Game) {
  const isSaved = state.saved.some((g) => g.id === game.id);
  set({ saved: isSaved ? state.saved.filter((g) => g.id !== game.id) : [game, ...state.saved] });
}
export function usePrototype() {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    () => state,
  );
}
