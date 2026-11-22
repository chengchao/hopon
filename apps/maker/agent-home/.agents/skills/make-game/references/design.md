# The design

`design.md` says what the game is, in English: what the player sees, does, wins and loses. It never says how the game is built, so it has no code, no file names and no px. Where things sit on the screen is in words here ("a bar along the top", "the bottom third"), and becomes px in the tests and the code. You write the tests and the code from it, the advisor checks the game against it, and the next change starts from it, so a decision that isn't in it gets made by accident in the code.

There is no word limit, and a big game needs a long design. Make every part specific enough that two people building from it would make the same game: "fish get faster over time" leaves the builder guessing, and "a fish crosses the screen in 4 seconds, and half a second less for every 5 caught, down to 2" does not. Give the numbers a player would notice: counts, prices, lives, timers, how long a thing takes.

## A designed game

When `design_game` wrote `design.md`, that file is the design, and it is already in the workspace. Don't write it again and don't reword it. Build every part of it: its places, its lists, its numbers, its look. Change a line of it, with the `edit` tool, only where it asks for something a hopon game can't do.

## An imitation

When the Creator names an existing game to imitate or remake, open `references/imitation.md` too. It adds a part, Pillars, and says what to keep of the named game.

## The parts

Write these parts, each as a heading or a line that starts with its name:

- **Asked:** everything the Creator has asked for since their last new game, one line for each thing, in their own words inside quotation marks. Every line here is in the finished game.
- **Experience:** how the game plays for the player, in 2 to 5 lines: what they do in the first seconds and what the game gives back, what they do again and again and how the game answers each time, where they must give up one thing for another, and why they'd play again. Every other part serves this one.
- **Goal:** what the player does, and how the game is won or lost. Nothing is saved between plays, so a long game gets a goal that one sitting of about 5 minutes can reach: count the moves, levels or days it takes from the game's own numbers, and shrink the game until they fit.
- **Screens:** every screen the player sees during play: what is on it, and what takes the player to the next one. A place in the game is drawn as that place. Its words and buttons may sit in a panel over the drawing, never in place of it.
- **Rules:** what moves, spawns, scores and hurts, with numbers. A game on a grid gives the grid: its columns and rows, what each kind of tile is, and how the player moves on it, with its map written out whole as rows of characters with a legend. A game with places, levels, goods, enemies or items lists them, each with its numbers: nothing is left for the code to invent.
- **Controls:** the taps, holds and swipes with one finger, what each does on each screen, and roughly where on a portrait phone it goes.
- **Difficulty:** how it starts, and how and when it ramps up.
- **Fairness:** how this game meets each of these, with its own numbers, each worked out from the Rules and not estimated. The first threat comes after about 2 seconds. Every danger can be seen and avoided. What hurts is a bit smaller than it looks, and what the player aims for a bit bigger. What the player taps is finger-sized.
- **Look:** the art style in a few words, the setting, the mood, and a palette of 4 to 6 colours. Then how each screen and each main thing on it is drawn: its shape, its colours and the detail that makes it read as what it is. A bare box, a bare circle or a line of text is not a drawing of a hero, a house or a shopkeeper. Then what happens on a hit, a point and the end.
- **Language:** the language of the on-screen text. When the Creator writes in another language, every word on screen is in that language.
- **Music:** the genre, mood and tempo that fit the game, as one loop of 20 to 40 seconds. Write `Music: none` only when the Creator asked for no music or for silence, and quote their words: `Music: none ("no music please")`. For a new game, or a change that drops a game's music, verify checks that the quote is one of the Creator's messages since their last new game, or at least three words of one, word for word.
- **Done when:** 2 to 5 success criteria, one per line, each something a short playtest can show ("Tapping the left half moves the basket left.", "The game ends after 3 misses.").

## A change

Edit `design.md` first, so that it still describes the whole game. Add the Creator's new words to Asked, change the lines the change touches with the `edit` tool, with numbers where it matters, and leave every other line as it is. Never add the change at the end as a note: verify reads the first Music and Done when it finds. Replace Done when with criteria for this change. Then change exactly that in the game, and keep everything else. An older game may have no `design.md`: write it from the game's code first, with its music as the game has it (`Music: none` with no quote when it has none).
