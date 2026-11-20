# Fruit Catcher

Sizes are in units: the screen is 20 units wide (1 unit is 18 CSS px on a 360 px wide phone). Heights are measured from the middle of the screen, up positive. The game runs at 60 frames a second.

**Goal:** Catch falling apples in a basket at the bottom of the screen. Each apple caught scores a point. Catching a bomb ends the game. There is no win; the score is the goal.

**Rules:**

- The basket is 4 units wide and 1.6 units tall, and its centre sits 11 units below the middle of the screen. It moves only sideways and stays at least 1.8 units from each edge.
- Apples and bombs spawn at 14 units above the middle, at a random x from 1 unit inside the left edge to 1 unit inside the right edge, and fall straight down at a steady speed.
- The first drop comes 1 s after the round starts. After each drop the next comes after max(0.3, 0.9 − 0.02 × score) s.
- A drop is 1 item. Above a score of 15 it gets a second item 40% of the time, and above 35 a third item 40% of the time. Extra items start 2 and 4 units higher.
- Each item falls at 0.1 + a random 0 to 0.04 + min(0.2, 0.004 × score) units a frame: 6 to 8.4 units a second at the start, up to 18.4.
- Each item is a bomb with chance min(0.4, 0.2 + 0.005 × score), else an apple.
- An item is caught when its centre is within 2.1 units of the basket's centre sideways, and between 1.2 units above and 0.5 units below the basket's centre. A caught apple scores 1 point and disappears. A caught bomb explodes and ends the game.
- Missed items fall off the bottom of the screen and cost nothing. They are removed 15 units below the middle.

**Controls:** Touch anywhere and drag: while the finger is down, the basket moves halfway to the finger's x each frame, so it follows the finger closely. A tap pulls the basket toward the tap. The left and right arrow keys move it 0.4 units a frame as a bonus.

**Difficulty:** It starts slow, with one item about every 0.9 s and 1 in 5 a bomb. Each point makes drops come sooner, items fall faster and bombs more likely, until drops come every 0.3 s, items fall at up to 18.4 units a second and 2 in 5 are bombs. Above 15 and 35 points, drops can hold 2 or 3 items.

**Fairness:** The first item spawns after 1 s and takes about 3.5 s to reach the basket. Bombs look nothing like apples: black with a flickering lit fuse. Every item falls in a straight line at one speed, so where it lands can be read early. The catch zone (2.1 units each side) is a little wider than the basket (2 units each side). The basket follows the finger with no lag a player can feel.

**Look:** A sunny day. A light blue sky gradient, from #5ebaed at the top to #bee3f4 lower down. A green ground strip (#468f24) along the bottom with a bright grass line (#5fd926) on top, just under the basket. Apples are 1.6 units: red, with a pink highlight up-left, a brown stem and a green leaf. Bombs are 1.6 units: black, with a gray highlight, a brown fuse and a spark that flickers yellow and orange. The basket is light brown wood (#b27333) with a dark brown rim (#804c1a) and two dark slats. A caught apple vanishes into the basket and the score goes up. A caught bomb bursts into yellow and red sparks and the game ends. The score shows in the top-left corner during play.

**Language:** English.

**Music:** synth arcade, bright and bouncy, about 130 BPM.

**Done when:**

- Dragging moves the basket to the finger, left and right.
- A caught apple adds 1 point.
- A caught bomb ends the game.
- Missed apples cost nothing, and the game keeps going.
