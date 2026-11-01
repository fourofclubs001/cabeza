// Cabeza CPU — a port of Bot.kt. Runs inside a Web Worker (see worker.js); needs game.js loaded first.

/** `millis` is a hard cap on thinking time: the search aborts at that deadline no matter what. */
const LEVELS = {
  EASY: { key: 'EASY', label: 'Easy', millis: 250, maxDepth: 1, jitter: 70 },
  MEDIUM: { key: 'MEDIUM', label: 'Medium', millis: 900, maxDepth: 2, jitter: 12 },
  HARD: { key: 'HARD', label: 'Hard', millis: 5000, maxDepth: 30, jitter: 0 },
};

const W = {
  race: 45, path: 5, tempo: 12, threat1: 90, threatMore: 170,
  press: 4, room: 3, ownBlock: 5, enemyBlock: 7,
};

const MAXP = 16, MAXPLY = 40, MAXTURNS = 512, MAXCOST = 256;
const INF = 1000000, WIN = 100000;
const TT_SIZE = 1 << 18;
const EXACT = 0, LOWER = 1, UPPER = 2;
const CDX = [1, 1, 0, -1, -1, -1, 0, 1];
const CDY = [0, 1, 1, 1, 0, -1, -1, -1];
const BDX = [1, -1, 0, 0];
const BDY = [0, 0, 1, -1];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
}
// 64-bit Zobrist keys as (lo, hi) int pairs.
const ZLO = new Int32Array(MAXP * 800), ZHI = new Int32Array(MAXP * 800);
{ const r = mulberry32(0x5EED); for (let k = 0; k < ZLO.length; k++) { ZLO[k] = r(); ZHI[k] = r(); } }
const SIDE_LO = new Int32Array(2), SIDE_HI = new Int32Array(2);
{ const r = mulberry32(0xB10E); for (let k = 0; k < 2; k++) { SIDE_LO[k] = r(); SIDE_HI[k] = r(); } }

const ABORT = { abort: true };

/**
 * Negamax alpha-beta over whole turns with iterative deepening, a Zobrist transposition
 * table and history-heuristic ordering. Every node first checks whether the side to move
 * can win immediately, so one-turn tactics (crushes, goal runs) are never missed.
 */
class Bot {
  constructor(level) {
    this.level = level;
    this.np = 0;
    this.own = new Int32Array(MAXP); this.kind = new Int32Array(MAXP);
    this.px = new Int32Array(MAXP); this.py = new Int32Array(MAXP);
    this.sx = new Int32Array(MAXP); this.sy = new Int32Array(MAXP); this.sz = new Int32Array(MAXP);
    this.grid = new Int32Array(N * N);
    this.cab = new Int32Array(2);
    this.hLo = 0; this.hHi = 0;
    this.nodes = 0; this.deadline = Infinity;
    this.turnBuf = Array.from({ length: MAXPLY }, () => new Int32Array(MAXTURNS));
    this.scoreBuf = Array.from({ length: MAXPLY }, () => new Int32Array(MAXTURNS));
    this.history = new Int32Array(1000);
    this.killer = new Int32Array(MAXPLY);
    this.dist = new Int32Array(N * N);
    this.qCell = new Int32Array(N * N * 8); this.qNext = new Int32Array(N * N * 8);
    this.head = new Int32Array(MAXCOST);
    this.ttLo = new Int32Array(TT_SIZE); this.ttHi = new Int32Array(TT_SIZE);
    this.ttVal = new Int32Array(TT_SIZE); this.ttMove = new Int32Array(TT_SIZE);
    this.ttDepth = new Int8Array(TT_SIZE).fill(-1); this.ttFlag = new Int8Array(TT_SIZE);
    this.tx = 0; this.ty = 0; this.tsx = 0; this.tsy = 0; this.tsz = 0;
    this.seen = new Int32Array(80);
  }

  choose(pieces, side) {
    const L = this.level;
    this.load(pieces);
    this.nodes = 0; this.history.fill(0); this.killer.fill(-1);
    const start = performance.now();
    this.deadline = start + L.millis;

    const w = this.findWin(side);
    if (w >= 0) return this.decode(w);
    const n = this.genTurns(side, this.turnBuf[0]);
    if (n === 0) return null;
    const turns = Array.from(this.turnBuf[0].subarray(0, n));

    const quick = turns.map(t => this.quickScore(t, side));
    let order = [...Array(n).keys()].sort((a, b) => quick[b] - quick[a]);
    // Fallback if even depth 1 runs out of time: the static ordering.
    let scores = new Array(n); order.forEach((k, rank) => { scores[k] = -rank; });
    for (let depth = 1; depth <= L.maxDepth; depth++) {
      const s = new Array(n).fill(-INF);
      let best = -INF;
      try {
        for (const k of order) {
          // Window is lowered by the jitter so near-best moves get exact scores to choose between.
          const alpha = best === -INF ? -INF : best - L.jitter - 1;
          const undo = this.play(turns[k]);
          s[k] = -this.negamax(1 - side, depth - 1, -INF, -alpha, 1);
          this.unplay(turns[k], undo);
          best = Math.max(best, s[k]);
        }
      } catch (e) {
        if (e === ABORT) break; throw e;
      }
      scores = s;
      order = [...Array(n).keys()].sort((a, b) => scores[b] - scores[a]);
      const top = scores[order[0]];
      if (top >= WIN - 1000 || (top <= -WIN + 1000 && depth > 2)) break; // result is forced either way
      // An iteration typically costs several times the previous one; don't start what can't finish.
      if (performance.now() - start > L.millis * 2 / 5) break;
    }
    const best = scores[order[0]];
    const pool = order
      .filter(k => scores[k] >= best - L.jitter && (scores[k] > -WIN + 1000 || best <= -WIN + 1000))
      .filter(k => best < WIN - 1000 || scores[k] === best);
    return this.decode(turns[pool[Math.floor(Math.random() * pool.length)]]);
  }

  // ───────── search ─────────

  negamax(side, depth, alpha0, beta, ply) {
    if ((++this.nodes & 255) === 0 && performance.now() > this.deadline) throw ABORT;
    if (this.findWin(side) >= 0) return WIN - ply;
    if (depth <= 0 || ply >= MAXPLY - 1) return this.evaluate(side);

    let alpha = alpha0;
    const kLo = this.hLo ^ SIDE_LO[side], kHi = this.hHi ^ SIDE_HI[side];
    const slot = (kHi >>> 8) & (TT_SIZE - 1);
    let ttMove = -1;
    if (this.ttLo[slot] === kLo && this.ttHi[slot] === kHi && this.ttDepth[slot] >= 0) {
      ttMove = this.ttMove[slot];
      if (this.ttDepth[slot] >= depth) {
        let v = this.ttVal[slot];
        if (v > WIN - 1000) v -= ply; else if (v < -WIN + 1000) v += ply;
        const f = this.ttFlag[slot];
        if (f === EXACT) return v;
        if (f === LOWER && v >= beta) return v;
        if (f === UPPER && v <= alpha) return v;
      }
    }

    const turns = this.turnBuf[ply];
    const n = this.genTurns(side, turns);
    if (n === 0) {
      // Stuck: the turn is skipped (current house rule); nobody able to move is a draw.
      if (this.genTurns(1 - side, this.turnBuf[ply + 1]) === 0 && this.findWin(1 - side) < 0) return 0;
      return -this.negamax(1 - side, depth - 1, -beta, -alpha, ply + 1);
    }

    const keys = this.scoreBuf[ply];
    for (let k = 0; k < n; k++) {
      const t = turns[k];
      keys[k] = t === ttMove ? (1 << 30) : t === this.killer[ply] ? (1 << 29) : this.history[t];
    }

    let best = -INF, bestMove = -1;
    for (let k = 0; k < n; k++) {
      // Selection sort step: cheap, and cutoffs usually come early.
      let bi = k;
      for (let j = k + 1; j < n; j++) if (keys[j] > keys[bi]) bi = j;
      if (bi !== k) {
        const tt = turns[k]; turns[k] = turns[bi]; turns[bi] = tt;
        const tk = keys[k]; keys[k] = keys[bi]; keys[bi] = tk;
      }
      const t = turns[k];
      const undo = this.play(t);
      const v = -this.negamax(1 - side, depth - 1, -beta, -alpha, ply + 1);
      this.unplay(t, undo);
      if (v > best) { best = v; bestMove = t; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        this.history[t] += depth * depth;
        this.killer[ply] = t;
        break;
      }
    }

    const flag = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
    let stored = best;
    if (stored > WIN - 1000) stored += ply; else if (stored < -WIN + 1000) stored -= ply;
    const same = this.ttLo[slot] === kLo && this.ttHi[slot] === kHi;
    if (!same || this.ttDepth[slot] <= depth) {
      this.ttLo[slot] = kLo; this.ttHi[slot] = kHi; this.ttVal[slot] = stored; this.ttDepth[slot] = depth;
      this.ttFlag[slot] = flag; this.ttMove[slot] = bestMove;
    }
    return best;
  }

  /** Root ordering only: the static eval after the turn, from the mover's view. */
  quickScore(t, side) {
    const undo = this.play(t);
    const v = -this.evaluate(1 - side);
    this.unplay(t, undo);
    return v;
  }

  // ───────── heuristics ─────────

  /** Race (turns to the far row), threats, pressure on the enemy cabeza, room around your own. */
  evaluate(s) {
    const o = 1 - s;
    const dS = this.pathCost(s), dO = this.pathCost(o);
    const tS = Math.floor((dS + 3) / 4), tO = Math.floor((dO + 3) / 4);
    let v = W.race * (tO - tS) + W.path * (dO - dS) + W.tempo;
    const th = this.countThreats(o);
    if (th > 0) v -= W.threat1 + W.threatMore * (th - 1);
    v += W.press * (this.pressure(s) - this.pressure(o));
    v += W.room * (this.room(s) - this.room(o));
    return v;
  }

  pressure(side) {
    const t = this.cab[1 - side], tx = this.px[t], ty = this.py[t];
    let p = 0;
    for (let i = 0; i < this.np; i++) {
      if (this.own[i] !== side || this.kind[i] === CABEZA) continue;
      const d = this.gap(i, tx, ty);
      if (d < 6) p += 6 - d;
    }
    return p;
  }

  room(side) {
    const c = this.cab[side];
    let r = 0;
    for (let k = 0; k < 8; k++) {
      const x = this.px[c] + CDX[k], y = this.py[c] + CDY[k];
      if (x >= 0 && x < N && y >= 0 && y < N && this.grid[y * N + x] < 0) r++;
    }
    return r;
  }

  /** Chebyshev gap between piece i's footprint and cell (tx, ty); 0 = covering it. */
  gap(i, tx, ty) {
    const px = this.px[i], py = this.py[i];
    const dx = tx < px ? px - tx : tx >= px + this.sx[i] ? tx - (px + this.sx[i] - 1) : 0;
    const dy = ty < py ? py - ty : ty >= py + this.sy[i] ? ty - (py + this.sy[i] - 1) : 0;
    return Math.max(dx, dy);
  }

  // Dijkstra with a bucket queue; costs: empty 2, own block W.ownBlock, enemy block W.enemyBlock.
  pathCost(side) {
    const c = this.cab[side], goal = goalRow(side);
    if (this.py[c] === goal) return 0;
    const { dist, qCell, qNext, head, grid, own } = this;
    dist.fill(0x7fffffff); head.fill(-1);
    const s0 = this.py[c] * N + this.px[c];
    dist[s0] = 0; qCell[0] = s0; qNext[0] = -1; head[0] = 0;
    let qn = 1;
    for (let cost = 0; cost < MAXCOST; cost++) {
      let e = head[cost];
      while (e >= 0) {
        const cell = qCell[e]; e = qNext[e];
        if (dist[cell] !== cost) continue;
        const cx = cell % N, cy = (cell / N) | 0;
        if (cy === goal) return cost;
        for (let k = 0; k < 8; k++) {
          const x = cx + CDX[k], y = cy + CDY[k];
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const nb = y * N + x;
          const j = grid[nb];
          const nd = cost + (j < 0 ? 2 : own[j] === side ? W.ownBlock : W.enemyBlock);
          if (nd < dist[nb] && nd < MAXCOST) {
            dist[nb] = nd;
            qCell[qn] = nb; qNext[qn] = head[nd]; head[nd] = qn; qn++;
          }
        }
      }
    }
    return MAXCOST;
  }

  // ───────── wins & threats ─────────

  mayWin(i, side) {
    const t = this.cab[1 - side];
    if (this.kind[i] === CABEZA) return Math.abs(this.py[i] - goalRow(side)) <= 2;
    return this.gap(i, this.px[t], this.py[t]) <= 4;
  }

  findWin(side) {
    for (let i = 0; i < this.np; i++) {
      if (this.own[i] !== side || !this.mayWin(i, side)) continue;
      const t = this.winOf(i);
      if (t >= 0) return t;
    }
    return -1;
  }

  countThreats(side) {
    let c = 0;
    for (let i = 0; i < this.np; i++) if (this.own[i] === side && this.mayWin(i, side) && this.winOf(i) >= 0) c++;
    return c;
  }

  winOf(i) {
    const nd = this.dirs(i);
    for (let d = 0; d < nd; d++) {
      const r = this.check(i, d);
      if (r === 1) return this.enc(i, d, -1);
      if (r === 0 && this.kind[i] !== BIG) {
        const undo = this.move(i, d);
        let hit = -1;
        for (let d2 = 0; d2 < nd; d2++) if (this.check(i, d2) === 1) { hit = d2; break; }
        this.restore(i, undo);
        if (hit >= 0) return this.enc(i, d, hit);
      }
    }
    return -1;
  }

  // ───────── turns ─────────
  // Encoding: piece*100 + d1*10 + (d2 + 1), d2 = -1 for a single-step turn.

  enc(i, d1, d2) { return i * 100 + d1 * 10 + d2 + 1; }

  /** Non-winning turns for `side`, one per distinct end placement (a second step may not undo the first). */
  genTurns(side, out) {
    let n = 0;
    const seen = this.seen;
    for (let i = 0; i < this.np; i++) {
      if (this.own[i] !== side) continue;
      const orig = this.pack(i);
      let ns = 0;
      const nd = this.dirs(i);
      for (let d = 0; d < nd; d++) {
        if (this.check(i, d) !== 0) continue;
        const undo = this.move(i, d);
        const k1 = this.pack(i);
        if (indexOf(seen, ns, k1) < 0) { seen[ns++] = k1; out[n++] = this.enc(i, d, -1); }
        if (this.kind[i] !== BIG) for (let d2 = 0; d2 < nd; d2++) {
          if (this.check(i, d2) !== 0) continue;
          const u2 = this.move(i, d2);
          const k2 = this.pack(i);
          this.restore(i, u2);
          if (k2 !== orig && indexOf(seen, ns, k2) < 0) { seen[ns++] = k2; out[n++] = this.enc(i, d, d2); }
        }
        this.restore(i, undo);
      }
    }
    return n;
  }

  play(t) {
    const i = (t / 100) | 0, d2 = (t % 10) - 1;
    const undo = this.move(i, ((t / 10) | 0) % 10);
    if (d2 >= 0) this.move(i, d2);
    return undo;
  }

  unplay(t, undo) { this.restore((t / 100) | 0, undo); }

  decode(t) {
    const i = (t / 100) | 0, d2 = (t % 10) - 1;
    const steps = [this.step(i, ((t / 10) | 0) % 10)];
    if (d2 >= 0) steps.push(this.step(i, d2));
    return { piece: i, steps };
  }

  step(i, d) { return this.kind[i] === CABEZA ? [CDX[d], CDY[d]] : [BDX[d], BDY[d]]; }

  // ───────── primitive moves (mirror Game.moves / Game.land) ─────────

  dirs(i) { return this.kind[i] === CABEZA ? 8 : 4; }

  target(i, d) {
    if (this.kind[i] === CABEZA) {
      this.tx = this.px[i] + CDX[d]; this.ty = this.py[i] + CDY[d]; this.tsx = 1; this.tsy = 1; this.tsz = 1; return;
    }
    const sx = this.sx[i], sy = this.sy[i], sz = this.sz[i];
    this.tx = this.px[i]; this.ty = this.py[i]; this.tsx = sx; this.tsy = sy; this.tsz = sz;
    if (d === 0) { this.tx += sx; this.tsx = sz; this.tsz = sx; }
    else if (d === 1) { this.tx -= sz; this.tsx = sz; this.tsz = sx; }
    else if (d === 2) { this.ty += sy; this.tsy = sz; this.tsz = sy; }
    else { this.ty -= sz; this.tsy = sz; this.tsz = sy; }
  }

  /** -1 illegal, 0 legal, 1 legal and winning. */
  check(i, d) {
    this.target(i, d);
    const { tx, ty, tsx, tsy, grid } = this;
    if (tx < 0 || ty < 0 || tx + tsx > N || ty + tsy > N) return -1;
    const isCab = this.kind[i] === CABEZA;
    // Cabeza can't squeeze diagonally between pieces on both flanking cells (mirrors Game.moves).
    if (isCab && tx !== this.px[i] && ty !== this.py[i] &&
      grid[this.py[i] * N + tx] >= 0 && grid[ty * N + this.px[i]] >= 0) return -1;
    const enemy = this.cab[1 - this.own[i]];
    let win = false;
    for (let y = ty; y < ty + tsy; y++) for (let x = tx; x < tx + tsx; x++) {
      const j = grid[y * N + x];
      if (j < 0 || j === i) continue;
      if (j === enemy && !isCab) win = true; else return -1;
    }
    if (isCab && ty === goalRow(this.own[i])) win = true;
    return win ? 1 : 0;
  }

  move(i, d) {
    const old = this.pack(i);
    this.target(i, d);
    this.fill(i, -1); this.zob(i);
    this.px[i] = this.tx; this.py[i] = this.ty; this.sx[i] = this.tsx; this.sy[i] = this.tsy; this.sz[i] = this.tsz;
    this.fill(i, i); this.zob(i);
    return old;
  }

  restore(i, p) {
    this.fill(i, -1); this.zob(i);
    this.px[i] = p & 15; this.py[i] = (p >> 4) & 15; this.sx[i] = (p >> 8) & 15; this.sy[i] = (p >> 12) & 15; this.sz[i] = (p >> 16) & 15;
    this.fill(i, i); this.zob(i);
  }

  pack(i) { return this.px[i] | (this.py[i] << 4) | (this.sx[i] << 8) | (this.sy[i] << 12) | (this.sz[i] << 16); }

  /** XORs piece i's current placement into the hash. */
  zob(i) {
    const k = i * 800 + this.px[i] + N * this.py[i] + 100 * ((this.sx[i] - 1) + 2 * (this.sy[i] - 1) + 4 * (this.sz[i] - 1));
    this.hLo ^= ZLO[k]; this.hHi ^= ZHI[k];
  }

  fill(i, v) {
    for (let y = this.py[i]; y < this.py[i] + this.sy[i]; y++)
      for (let x = this.px[i]; x < this.px[i] + this.sx[i]; x++) this.grid[y * N + x] = v;
  }

  load(pieces) {
    this.np = pieces.length;
    this.grid.fill(-1); this.hLo = 0; this.hHi = 0;
    pieces.forEach((p, i) => {
      this.own[i] = p.owner; this.kind[i] = p.kind;
      this.px[i] = p.x; this.py[i] = p.y; this.sx[i] = p.sx; this.sy[i] = p.sy; this.sz[i] = p.sz;
      if (p.kind === CABEZA) this.cab[p.owner] = i;
      this.fill(i, i); this.zob(i);
    });
  }
}

function indexOf(a, n, v) { for (let k = 0; k < n; k++) if (a[k] === v) return k; return -1; }
