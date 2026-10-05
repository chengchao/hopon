import { useSyncExternalStore } from 'react';
import type { Game } from './api';

// ponytail: in-memory UI prototype state, lost on reload. Replace with API-backed saves and comments.
type State = {
  saved: readonly Game[];
  comments: Readonly<Record<number, readonly string[]>>;
};
let state: State = { saved: [], comments: {} };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

export function toggleSave(game: Game) {
  const isSaved = state.saved.some((g) => g.id === game.id);
  set({ saved: isSaved ? state.saved.filter((g) => g.id !== game.id) : [game, ...state.saved] });
}
export function addComment(id: number, text: string) {
  set({ comments: { ...state.comments, [id]: [...(state.comments[id] ?? []), text] } });
}
export function usePrototype() {
  return useSyncExternalStore(
    (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    () => state,
  );
}
