export const CREATURES = ["🐟", "🐙", "🦀", "🐋", "🐢", "🦈", "🪼", "🐴"];

export interface Card {
  id: number;
  creature: string;
  side: "down" | "up" | "found";
}

export interface Game {
  cards: Card[];
  first: number | null;
  miss: [number, number] | null;
  moves: number;
  found: number;
}

const shuffled = <T>(items: T[]) => {
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

export const newGame = (): Game => ({
  cards: shuffled([...CREATURES, ...CREATURES]).map((creature, id) => ({
    creature,
    id,
    side: "down",
  })),
  first: null,
  found: 0,
  miss: null,
  moves: 0,
});

const withSides = (cards: Card[], at: number[], side: Card["side"]) =>
  cards.map((card, index) => (at.includes(index) ? { ...card, side } : card));

// The same game when the tap does nothing, so the caller can tell.
export const flip = (game: Game, index: number): Game => {
  if (game.miss || game.cards[index].side !== "down") {
    return game;
  }
  if (game.first === null) {
    return {
      ...game,
      cards: withSides(game.cards, [index], "up"),
      first: index,
    };
  }
  const pair = [game.first, index];
  const match = game.cards[game.first].creature === game.cards[index].creature;
  return {
    ...game,
    cards: withSides(game.cards, pair, match ? "found" : "up"),
    first: null,
    found: game.found + (match ? 1 : 0),
    miss: match ? null : [game.first, index],
    moves: game.moves + 1,
  };
};

export const hideMiss = (game: Game): Game =>
  game.miss
    ? { ...game, cards: withSides(game.cards, game.miss, "down"), miss: null }
    : game;
