# Cabeza

A 3D two-player rolling-block board game — **[play it here](https://fourofclubs001.github.io/cabeza/)**.

Roll your blocks, crush the cabeza. Play pass-and-play against a friend or against the CPU (Easy / Medium / Hard).

## Rules

- 10×10 board. Red moves first, then players alternate.
- On your turn pick **one** piece and move it once or twice. The 2×2×2 block moves only once. The second move can't just undo the first.
- Blocks roll over one of their bottom edges (no diagonals). The cabeza moves one cell in any direction, like a chess king — but it can't slip diagonally between two pieces that block both the side and the front/back cell.
- Pieces can never overlap or hang off the board.
- **Win** by bringing your cabeza to the far row, or by landing one of your blocks on the enemy cabeza (cabezas can't crush each other).

## Controls

Click/tap a piece, then a green spot. Drag to orbit, scroll or pinch to zoom. Enter/Space ends the turn, Ctrl+Z undoes, Esc opens the menu.

Every game is saved in your browser; **Previous games** lets you step through one move at a time and try what-if lines (optionally with the CPU answering).

## Code

Plain HTML/JS with raw WebGL — no build step, no dependencies.

- `game.js` — rules
- `bot.js` — CPU: alpha-beta over whole turns, iterative deepening, Zobrist transposition table (runs in `worker.js`)
- `main.js` — renderer, input, menus, replay
