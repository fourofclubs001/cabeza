// Cabeza rules — a port of Game.kt. Loaded as a classic script by the page and by the bot worker.

const N = 10;
const RED = 0, BLUE = 1, DRAW = 2;
const CABEZA = 0, CUBE = 1, BAR = 2, SLAB = 3, BIG = 4;
const KINDS = [
  { label: 'Cabeza', maxSteps: 2 },
  { label: '1×1×1', maxSteps: 2 },
  { label: '1×1×2', maxSteps: 2 },
  { label: '1×2×2', maxSteps: 2 },
  { label: '2×2×2', maxSteps: 1 },
];

const playerName = p => (p === RED ? 'RED' : 'BLUE');
const goalRow = owner => (owner === RED ? N - 1 : 0);

/**
 * x = column, y = row (row 0 is Red's home row, row 9 is Blue's).
 * (sx, sy) is the footprint on the board, sz the height. Rolling a block swaps
 * the footprint size along the roll axis with its height.
 */
const piece = (owner, kind, x, y, sx, sy, sz) => ({ owner, kind, x, y, sx, sy, sz });
const covers = (p, cx, cy) => cx >= p.x && cx < p.x + p.sx && cy >= p.y && cy < p.y + p.sy;
const samePiece = (a, b) => a.owner === b.owner && a.kind === b.kind && a.x === b.x && a.y === b.y &&
  a.sx === b.sx && a.sy === b.sy && a.sz === b.sz;

/** One entry of a game record: a single roll of `piece` by (dx, dy), or END of a turn. */
const END = Object.freeze({ piece: -1, dx: 0, dy: 0 });
const isEnd = e => e.piece < 0;
const sameEv = (a, b) => a.piece === b.piece && a.dx === b.dx && a.dy === b.dy;

function setup() {
  const red = [
    piece(RED, CABEZA, 5, 0, 1, 1, 1),
    piece(RED, CUBE, 4, 0, 1, 1, 1),
    piece(RED, BAR, 3, 0, 1, 2, 1),
    piece(RED, SLAB, 6, 0, 1, 2, 2),
    piece(RED, BIG, 4, 1, 2, 2, 2),
  ];
  // Blue's army is Red's rotated 180° around the board centre (not mirrored).
  const blue = red.map(p => ({ ...p, owner: BLUE, x: N - p.x - p.sx, y: N - p.y - p.sy }));
  return red.concat(blue);
}

class Game {
  constructor() { this.reset(); }

  reset() {
    this.pieces = setup(); this.turn = RED;
    this.active = -1;   // piece already moved this turn, or -1
    this.steps = 0;
    this.winner = -1; this.winReason = '';
    this.captured = -1; // index of the crushed cabeza, or -1
    this.note = '';     // one-shot message, e.g. a skipped turn
    this.undoStack = [];
    this.log = [];      // everything played so far; replaying it from reset() rebuilds this position
  }

  /** Plays one record entry; false if it isn't legal here. An END after an automatic turn end is a no-op. */
  play(e) {
    if (isEnd(e)) { this.endTurn(); return true; }
    const m = this.moves(e.piece).find(m => m.dx === e.dx && m.dy === e.dy);
    if (!m) return false;
    this.apply(m); return true;
  }

  /** Resets and replays the first n entries of events. */
  load(events, n = events.length) {
    this.reset();
    for (let k = 0; k < n; k++) if (!this.play(events[k])) break;
    this.note = '';
  }

  get canUndo() { return this.winner < 0 && this.undoStack.length > 0; }
  get canEndTurn() { return this.winner < 0 && this.steps >= 1; }

  pieceAt(cx, cy, except = -1) {
    for (let i = 0; i < this.pieces.length; i++) if (i !== except && covers(this.pieces[i], cx, cy)) return i;
    return -1;
  }

  canPick(i) {
    const p = this.pieces[i];
    if (!p) return false;
    return this.winner < 0 && p.owner === this.turn && (this.active < 0 || this.active === i) &&
      this.steps < KINDS[p.kind].maxSteps;
  }

  moves(i) {
    if (!this.canPick(i)) return [];
    const p = this.pieces[i];
    // A second step may not undo the first, i.e. put the piece back where the turn started.
    const last = this.undoStack[this.undoStack.length - 1];
    const start = this.active === i && last ? last.pieces[i] : null;
    const out = [];
    const add = m => { if (m) out.push(m); };
    if (p.kind === CABEZA) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        // No squeezing diagonally between two pieces that fill the side and front/back cells.
        if (dx !== 0 && dy !== 0 && this.pieceAt(p.x + dx, p.y) >= 0 && this.pieceAt(p.x, p.y + dy) >= 0) continue;
        add(this.land(i, { ...p, x: p.x + dx, y: p.y + dy }, dx, dy));
      }
    } else {
      add(this.land(i, { ...p, x: p.x + p.sx, sx: p.sz, sz: p.sx }, 1, 0));
      add(this.land(i, { ...p, x: p.x - p.sz, sx: p.sz, sz: p.sx }, -1, 0));
      add(this.land(i, { ...p, y: p.y + p.sy, sy: p.sz, sz: p.sy }, 0, 1));
      add(this.land(i, { ...p, y: p.y - p.sz, sy: p.sz, sz: p.sy }, 0, -1));
    }
    return start ? out.filter(m => !samePiece(m.to, start)) : out;
  }

  /** Landing cells must be on the board and empty, except for the enemy cabeza (crushed, but not by a cabeza). */
  land(i, to, dx, dy) {
    if (to.x < 0 || to.y < 0 || to.x + to.sx > N || to.y + to.sy > N) return null;
    let captures = -1;
    for (let cx = to.x; cx < to.x + to.sx; cx++) for (let cy = to.y; cy < to.y + to.sy; cy++) {
      const j = this.pieceAt(cx, cy, i);
      if (j < 0) continue;
      const q = this.pieces[j];
      if (q.owner !== to.owner && q.kind === CABEZA && to.kind !== CABEZA) captures = j; else return null;
    }
    const goal = to.kind === CABEZA && to.y === goalRow(to.owner);
    return { piece: i, dx, dy, to, captures, goal };
  }

  apply(m) {
    this.undoStack.push({ pieces: this.pieces, active: this.active, steps: this.steps });
    this.log.push({ piece: m.piece, dx: m.dx, dy: m.dy });
    this.pieces = this.pieces.slice(); this.pieces[m.piece] = m.to;
    this.active = m.piece;
    this.steps++;
    this.note = '';
    if (m.captures >= 0) {
      this.winner = this.turn; this.captured = m.captures;
      this.winReason = `${KINDS[m.to.kind].label} crushed the ${playerName(1 - this.turn).toLowerCase()} cabeza`;
      return;
    }
    if (m.goal) {
      this.winner = this.turn;
      this.winReason = 'The cabeza reached the far side';
      return;
    }
    if (this.steps >= KINDS[m.to.kind].maxSteps || this.moves(m.piece).length === 0) this.endTurn();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.pieces = s.pieces; this.active = s.active; this.steps = s.steps;
    this.log.pop();
  }

  endTurn() {
    if (this.winner >= 0 || this.steps === 0) return;
    this.log.push(END);
    this.turn = 1 - this.turn; this.active = -1; this.steps = 0; this.undoStack = [];
    // TODO(rules): what happens when a player is stuck is still undecided — for now the turn is skipped.
    if (!this.hasAnyMove()) {
      this.note = `${playerName(this.turn)} had no legal moves — turn skipped`;
      this.turn = 1 - this.turn;
      if (!this.hasAnyMove()) { this.winner = DRAW; this.winReason = 'Nobody can move'; }
    }
  }

  hasAnyMove() { return this.pieces.some((_, i) => this.moves(i).length > 0); }
}

/** The real-game move for step `stepIndex` of a bot turn, or null if there is none. */
function nextBotMove(game, t, stepIndex) {
  const s = t.steps[stepIndex];
  if (!s) return null;
  return game.moves(t.piece).find(m => m.dx === s[0] && m.dy === s[1]) || null;
}
