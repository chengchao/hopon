# Ocean Memory

**Goal:** Find all 8 pairs of sea creatures among 16 face-down cards. The game is won when every pair is found. There is no way to lose; fewer moves is better.

**Rules:**

- 16 cards in a 4 × 4 grid: two each of 🐟 🐙 🦀 🐋 🐢 🦈 🪼 🐴, shuffled at the start of every round.
- A face-down card shows a shell 🐚. Tapping it turns it face up and shows its creature.
- The second card turned up makes one move, shown as "Moves N" above the grid.
- When the two cards match, both stay face up, turn mint green, and score 1 point.
- When they don't match, both stay up for 0.8 s, then turn face down again. Taps during those 0.8 s do nothing.
- Tapping the card already face up, or a found card, does nothing.
- Finding the 8th pair wins: the game says "You won in N moves! 🎉" and ends.

**Controls:** One tap on a card turns it up. At 360 × 640 the grid is 88% of the screen width (at most 420 px), centred, with cards about 72 px square and 9 px apart, from about y = 182 to y = 499. Card centres sit near x = 58, 139, 221, 302 and y = 219, 300, 382, 463.

**Difficulty:** The same 16 cards every round. The challenge is remembering where each creature was seen.

**Fairness:** Every card can be reached and every pair is always present, so the board can always be finished. A mismatch stays visible for 0.8 s, long enough to see both creatures. Cards are finger-sized, about 72 px.

**Look:** A deep ocean at night: a vertical gradient from navy (#0a2a5e) to near-black blue (#031433). Cards are sand-coloured (#e8cf94) tiles with rounded corners and a darker sand edge below, white when face up, mint (#bdf5d0) when found. White bold title "🌊 Ocean Memory" at the top, the move count under it, a bold win message under the grid.

**Language:** English.

**Music:** none

**Done when:**

- Tapping a card turns it face up.
- Turning up a second card counts one move, and a pair that doesn't match turns back face down.
- Finding a pair scores 1 point and keeps both cards face up.
- Finding all 8 pairs ends the game as a win.
