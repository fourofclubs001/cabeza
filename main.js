// Cabeza for the web — renderer, input and screens (a port of CabezaRenderer.kt + MainActivity.kt).
'use strict';

// ───────────────────────── tiny mat4 (column-major, post-multiplying like android.opengl.Matrix) ─────────────────────────

const M4 = {
  ident(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(out, a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = s;
    }
    out.set(r); return out;
  },
  translate(m, x, y, z) { for (let i = 0; i < 4; i++) m[12 + i] += m[i] * x + m[4 + i] * y + m[8 + i] * z; },
  scale(m, x, y, z) { for (let i = 0; i < 4; i++) { m[i] *= x; m[4 + i] *= y; m[8 + i] *= z; } },
  rotate(m, deg, x, y, z) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    const r = new Float32Array([
      x * x * t + c, y * x * t + z * s, x * z * t - y * s, 0,
      x * y * t - z * s, y * y * t + c, y * z * t + x * s, 0,
      x * z * t + y * s, y * z * t - x * s, z * z * t + c, 0,
      0, 0, 0, 1]);
    M4.mul(m, m, r);
  },
  perspective(m, fovyDeg, aspect, near, far) {
    const f = 1 / Math.tan(fovyDeg * Math.PI / 360);
    m.fill(0); m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far);
  },
  lookAt(m, e, c, up) {
    let f = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
    const nl = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    f = nl(f); const s = nl(cross(f, up)); const u = cross(s, f);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    m.set([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, e), -dot(u, e), dot(f, e), 1]);
  },
  invert(out, a) {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return out;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },
  transpose(out, a) {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) r[i * 4 + j] = a[j * 4 + i];
    out.set(r); return out;
  },
  mulV(m, v) {
    const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
    return o;
  },
};

// ───────────────────────── saved games (localStorage) ─────────────────────────

const Store = {
  KEY: 'cabeza.games.v1', KEEP: 100,
  all() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; }
  },
  write(list) { try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.KEEP))); } catch { /* storage off */ } },
  encode(events) { return events.map(e => (isEnd(e) ? 'e' : `${e.piece},${e.dx},${e.dy}`)).join(';'); },
  decode(s) {
    return s.split(';').filter(Boolean).map(t => {
      if (t === 'e') return END;
      const [piece, dx, dy] = t.split(',').map(Number); return { piece, dx, dy };
    });
  },
  /** Newest first. */
  list() {
    return this.all().map(r => ({ ...r, events: this.decode(r.events) }))
      .sort((a, b) => b.id - a.id);
  },
  save(r) {
    const list = this.all().filter(x => x.id !== r.id);
    if (r.events.length) list.push({ id: r.id, cpuSide: r.cpuSide, level: r.level, winner: r.winner, events: this.encode(r.events) });
    list.sort((a, b) => b.id - a.id);
    this.write(list);
  },
  delete(id) { this.write(this.all().filter(x => x.id !== id)); },
};
const recTurns = r => r.events.filter(isEnd).length + (r.events.length && !isEnd(r.events[r.events.length - 1]) ? 1 : 0);

// ───────────────────────── state ─────────────────────────

const game = new Game();
const $ = id => document.getElementById(id);
const canvas = $('gl');
const gl = canvas.getContext('webgl', { antialias: true }) || canvas.getContext('experimental-webgl');

const cam = { dragYaw: 0, pitch: 58, zoom: 1, yaw: 0 };
let time = 0, lastT = 0;

let selected = -1;
let targets = [];
let anim = null; // { from, move, start, dur }
let lastTurn = RED;

// CPU opponent: the search runs in a worker over a snapshot of the pieces; its answer is played back one animated step at a time.
let cpuSide = -1;
let difficulty = 'MEDIUM';
let worker = null, botGen = 0, thinking = false, thinkStart = 0, plan = null, planStep = 0;
let botLevel = 'MEDIUM'; // strength of whichever bot is playing right now (live CPU or what-if CPU)

// The live game is saved after every change, so it shows up in Previous games even if never finished.
let liveId = 0, liveEvents = [], savedKey = '', canResume = false;

// Replay of a saved game. `line` is what ◀ ▶ walk through: the record itself, or a what-if branch that
// shares the record's first `branchAt` entries. `cursor` = entries of `line` on the board.
let viewing = null, line = [], cursor = 0, branchAt = -1, whatIf = null, whatIfSide = -1;
let lastMover = RED; // side that made the last move/End turn, so a new branch knows which side the CPU takes

const cpuTurn = () => game.winner < 0 && (viewing === null
  ? cpuSide >= 0 && game.turn === cpuSide
  : branchAt >= 0 && whatIf !== null && cursor === line.length && game.turn === whatIfSide);

const haptic = strong => { try { navigator.vibrate && navigator.vibrate(strong ? 60 : 12); } catch { /* unsupported */ } };

// ───────────────────────── actions ─────────────────────────

function tap(sx, sy) {
  if (anim || game.winner >= 0 || cpuTurn()) return;
  const rect = canvas.getBoundingClientRect();
  const nx = (sx - rect.left) / rect.width * 2 - 1, ny = 1 - (sy - rect.top) / rect.height * 2;
  const o = unproject(nx, ny, -1), f = unproject(nx, ny, 1);
  const d = [f[0] - o[0], f[1] - o[1], f[2] - o[2]];

  let best = Infinity, hitTarget = -1, hitPiece = -1;
  targets.forEach((m, k) => { const t = rayBox(o, d, m.to); if (t < best) { best = t; hitTarget = k; hitPiece = -1; } });
  game.pieces.forEach((p, i) => { const t = rayBox(o, d, p); if (t < best) { best = t; hitPiece = i; hitTarget = -1; } });
  let cell = null;
  if (d[1] < 0) {
    const t = -o[1] / d[1];
    if (t < best) {
      const cx = Math.floor(o[0] + d[0] * t + 5), cy = Math.floor(5 - (o[2] + d[2] * t));
      if (cx >= 0 && cx < N && cy >= 0 && cy < N) { cell = [cx, cy]; hitTarget = -1; hitPiece = -1; }
    }
  }

  if (hitTarget >= 0) doMove(targets[hitTarget]);
  else if (hitPiece >= 0) {
    const capture = targets.find(m => m.captures === hitPiece);
    if (capture) doMove(capture);
    else if (game.canPick(hitPiece)) { selected = hitPiece; refreshTargets(); haptic(false); push(); }
    else if (game.pieces[hitPiece].owner === game.turn && game.active >= 0) {
      game.note = 'You must keep moving the same piece (or End turn)'; push();
    }
  } else if (cell) {
    const m = targets.find(m => covers(m.to, cell[0], cell[1]));
    if (m) doMove(m);
    else if (game.active < 0) { selected = -1; refreshTargets(); push(); }
  }
}

function doMove(m) {
  lastMover = game.turn;
  const from = game.pieces[m.piece];
  const dur = from.kind === CABEZA ? 260 : from.kind === BIG ? 520 : 380;
  game.apply(m);
  anim = { from, move: m, start: performance.now(), dur };
  targets = [];
  logChanged();
  push();
}

/** Keeps the saved live game, or the replay's current line, in step with game.log. */
function logChanged() {
  const v = viewing;
  if (v === null) {
    const key = Store.encode(game.log) + '|' + game.winner;
    if (key !== savedKey && liveId !== 0) {
      savedKey = key;
      Store.save({ id: liveId, cpuSide, level: difficulty, winner: game.winner, events: game.log });
    }
    canResume = game.winner < 0;
    return;
  }
  const log = game.log;
  let common = 0;
  while (common < log.length && common < v.events.length && sameEv(log[common], v.events[common])) common++;
  if (common === log.length) { line = v.events; branchAt = -1; }
  else {
    if (branchAt < 0) whatIfSide = 1 - lastMover;
    line = log.slice(); branchAt = common;
  }
  cursor = log.length;
}

function undo() {
  if (!anim && !cpuTurn() && viewing === null) { game.undo(); refreshTargets(); logChanged(); push(); }
}

function endTurn() {
  if (!anim && !cpuTurn() && game.canEndTurn) {
    lastMover = game.turn; game.endTurn(); selected = -1; refreshTargets(); logChanged(); push();
  }
}

/** cpu = side the computer plays (-1 = pass-and-play). */
function newGame(cpu = cpuSide, level = difficulty) {
  stopBot(); viewing = null;
  cpuSide = cpu; difficulty = level;
  liveId = Date.now(); savedKey = '';
  startBot(cpu >= 0 ? level : null);
  anim = null; game.reset(); selected = -1; cam.dragYaw = 0; lastTurn = RED; refreshTargets(); logChanged(); push();
}

/** Back from a replay to the game that was being played. */
function resumeLive() {
  if (viewing === null) return;
  stopBot(); viewing = null;
  startBot(cpuSide >= 0 ? difficulty : null);
  anim = null; game.load(liveEvents); selected = -1; lastTurn = game.turn; refreshTargets(); logChanged(); push();
}

const liveRecord = () => ({ id: liveId, cpuSide, level: difficulty, winner: game.winner, events: game.log.slice() });

// ───────── replay / what-if ─────────

function openRecord(r) {
  stopBot();
  if (viewing === null) liveEvents = game.log.slice();
  viewing = r; line = r.events; branchAt = -1; whatIfSide = -1;
  cam.dragYaw = 0;
  seek(0);
}

const viewFirst = () => seek(0);
const viewLast = () => seek(line.length);
function viewPrev() { const s = stops().filter(x => x < cursor); if (s.length) seek(s[s.length - 1]); }
function viewNext() {
  if (anim || viewing === null) return;
  const to = stops().find(x => x > cursor);
  if (to === undefined) return;
  stopBot(); startBot(whatIf);
  selected = -1;
  // Animate the roll, then apply any turn ends that follow it.
  const e = line[cursor];
  const m = isEnd(e) ? null : game.moves(e.piece).find(m => m.dx === e.dx && m.dy === e.dy);
  if (m) {
    const from = game.pieces[m.piece];
    game.apply(m);
    anim = { from, move: m, start: performance.now(), dur: from.kind === BIG ? 520 : 300 };
    targets = [];
    for (let k = cursor + 1; k < to; k++) game.play(line[k]);
    cursor = to;
    push();
  } else seek(to);
}

/** Leave the what-if branch: back on the real game where the branch started. */
function backToRecord() {
  if (!viewing || branchAt < 0) return;
  const at = branchAt;
  line = viewing.events; branchAt = -1;
  const s = stops().filter(x => x <= at);
  seek(s.length ? s[s.length - 1] : 0);
}

/** null = you move both sides in what-ifs; otherwise the CPU answers at that strength. */
function setWhatIf(level) { whatIf = level; stopBot(); startBot(level); push(); }

/** Cursor positions ◀ ▶ stop at: the start, and after each roll (plus any turn ends right after it). */
function stops() {
  const out = [0];
  for (let i = 0; i < line.length; i++) if (!isEnd(line[i])) {
    let j = i + 1;
    while (j < line.length && isEnd(line[j])) j++;
    out.push(j);
  }
  return out;
}

function seek(to) {
  if (viewing === null) return;
  stopBot(); startBot(whatIf);
  anim = null;
  game.load(line, Math.max(0, Math.min(to, line.length)));
  cursor = game.log.length;
  selected = -1; lastTurn = game.turn; refreshTargets(); push();
}

// ───────── CPU ─────────

function stopBot() {
  if (worker) worker.terminate();
  worker = null; botGen++; thinking = false; plan = null;
}

function startBot(level) {
  if (level === null) return;
  botLevel = level;
  worker = new Worker('worker.js');
  worker.onmessage = e => {
    if (e.data.gen !== botGen) return;
    thinking = false;
    const t = e.data.turn;
    if (!t) { lastMover = game.turn; game.endTurn(); refreshTargets(); logChanged(); push(); }
    else { plan = t; planStep = 0; }
  };
}

/** Called every frame while nothing is animating: start thinking, or play the next planned step. */
function driveCpu() {
  if (!cpuTurn()) { plan = null; return; }
  if (plan === null) {
    if (thinking || !worker) return;
    thinking = true; thinkStart = performance.now(); push();
    worker.postMessage({ gen: botGen, level: botLevel, pieces: game.pieces, side: game.turn });
    return;
  }
  // Give the human a beat to see whose turn it is before the CPU's piece starts rolling.
  if (planStep === 0 && performance.now() - thinkStart < 600) return;
  const m = nextBotMove(game, plan, planStep);
  if (!m) {
    plan = null;
    if (game.steps > 0) { lastMover = game.turn; game.endTurn(); logChanged(); }
    refreshTargets();
    push();
    return;
  }
  planStep++;
  doMove(m);
}

function refreshTargets() {
  if (game.active >= 0) selected = game.active;
  if (!game.canPick(selected)) selected = -1;
  targets = selected >= 0 ? game.moves(selected) : [];
}

// ───────────────────────── UI ─────────────────────────

const redUi = 'rgb(255,84,92)', blueUi = 'rgb(84,146,255)';
const lvl = k => LEVELS[k].label;

function push() {
  const animating = anim !== null;
  const v = viewing;
  const turnChanged = !animating && game.turn !== lastTurn && game.winner < 0 && v === null;
  if (!animating) lastTurn = game.turn;
  const winner = animating ? -1 : game.winner;
  const p = game.pieces[selected];
  const ct = cpuTurn();
  let hint;
  if (ct && (thinking || plan === null)) hint = `CPU (${lvl(botLevel)}) is thinking…`;
  else if (ct) hint = 'CPU is moving';
  else if (game.note) hint = game.note;
  else if (v && game.winner >= 0) hint = game.winReason;
  else if (v && !p) hint = 'Tap a piece to try a different move';
  else if (!p) hint = 'Tap one of your pieces';
  else if (game.steps === 0) hint = `${KINDS[p.kind].label}: tap a green spot to ${p.kind === CABEZA ? 'step' : 'roll'}`;
  else hint = `${KINDS[p.kind].label}: one more move, or End turn`;

  let winText = '';
  if (game.winner === DRAW) winText = 'DRAW';
  else if (game.winner >= 0) winText = cpuSide < 0 ? `${playerName(game.winner)} WINS` : game.winner === cpuSide ? 'CPU WINS' : 'YOU WIN!';

  let title;
  if (v && game.winner === DRAW) title = 'DRAW';
  else if (v && game.winner >= 0) title = `${playerName(game.winner)} WINS`;
  else if (v && ct) title = `CPU · ${lvl(botLevel).toUpperCase()}`;
  else if (v) title = `${playerName(game.turn)} TO MOVE`;
  else if (cpuSide < 0) title = `${playerName(game.turn)}'S TURN`;
  else if (game.turn === cpuSide) title = `CPU · ${lvl(difficulty).toUpperCase()}`;
  else title = 'YOUR TURN';

  const col = game.turn === RED ? redUi : blueUi;
  $('title').textContent = title; $('title').style.color = col;
  $('hint').textContent = hint;
  const canEnd = game.canEndTurn && !animating && !ct;
  setOn($('undoBtn'), game.canUndo && !animating && !ct && v === null);
  setOn($('endBtn'), canEnd);
  $('endBtn').style.borderColor = canEnd ? col : '';
  $('liveBar').hidden = v !== null;
  $('replayBox').hidden = v === null;
  if (v) {
    const rolls = n => { let c = 0; for (let k = 0; k < n; k++) if (!isEnd(line[k])) c++; return c; };
    const st = stops();
    const counter = $('counter');
    counter.textContent = branchAt < 0 ? `Replay · move ${rolls(cursor)} / ${rolls(line.length)}`
      : `What-if · move ${rolls(cursor)} / ${rolls(line.length)}  (branched after move ${rolls(branchAt)})`;
    counter.classList.toggle('branch', branchAt >= 0);
    const canPrev = st.some(x => x < cursor), canNext = st.some(x => x > cursor);
    setOn($('firstBtn'), canPrev); setOn($('prevBtn'), canPrev);
    setOn($('nextBtn'), canNext); setOn($('lastBtn'), canNext);
    setOn($('rEndBtn'), canEnd); setOn($('realBtn'), branchAt >= 0);
    $('whatIfBtn').textContent = whatIf ? `vs CPU ${lvl(whatIf)}` : 'Both sides';
  }
  const shownWinner = v ? -1 : winner;
  const box = $('winBox');
  if (shownWinner >= 0) {
    $('winText').textContent = winText + '\n' + game.winReason;
    $('winText').style.color = shownWinner === RED ? redUi : shownWinner === BLUE ? blueUi : '#fff';
    if (box.hidden) { box.hidden = false; box.classList.remove('show'); void box.offsetWidth; box.classList.add('show'); }
  } else box.hidden = true;
  if (turnChanged) {
    const fl = $('flash');
    fl.innerHTML = '';
    const big = cpuSide < 0 ? `${playerName(game.turn)}'S TURN` : game.turn === cpuSide ? "CPU'S TURN" : 'YOUR TURN';
    fl.append(big);
    if (cpuSide < 0) { const s = document.createElement('small'); s.textContent = 'pass the device'; fl.append(document.createElement('br'), s); }
    fl.style.color = col;
    fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  }
}

function setOn(b, on) { b.disabled = !on; }

function showMenu() {
  $('resumeBtn').hidden = !canResume;
  $('games').hidden = true;
  $('menu').hidden = false;
}
function hideMenu() { $('menu').hidden = true; $('games').hidden = true; }

/** A small modal: either a list of choices or a message. */
function dialog({ title, items, message, ok }) {
  const d = $('dialog');
  $('dlgTitle').textContent = title;
  const body = $('dlgBody'); body.innerHTML = '';
  const close = () => { d.hidden = true; };
  if (message) message.split('\n\n').forEach(par => { const p = document.createElement('p'); p.textContent = par; body.append(p); });
  (items || []).forEach(([label, fn]) => {
    const b = document.createElement('button'); b.className = 'btn wide'; b.textContent = label;
    b.onclick = () => { close(); fn(); }; body.append(b);
  });
  const foot = $('dlgFoot'); foot.innerHTML = '';
  const c = document.createElement('button'); c.className = 'btn'; c.textContent = ok || 'Cancel'; c.onclick = close;
  foot.append(c);
  d.hidden = false;
}

function chooseSide() {
  dialog({
    title: 'Play vs CPU', items: [
      ['You play Red (move first)', () => chooseDifficulty(BLUE)],
      ['You play Blue', () => chooseDifficulty(RED)],
    ],
  });
}

function chooseDifficulty(cpu) {
  dialog({
    title: 'CPU strength', items: [
      ['Easy · looks one turn ahead, plays loosely', () => { hideMenu(); newGame(cpu, 'EASY'); }],
      ['Medium · two turns ahead', () => { hideMenu(); newGame(cpu, 'MEDIUM'); }],
      ['Hard · deep search, up to 5 s per move', () => { hideMenu(); newGame(cpu, 'HARD'); }],
    ],
  });
}

function chooseWhatIf() {
  dialog({
    title: 'In what-if moves…', items: [
      ['I move both sides', () => setWhatIf(null)],
      ['CPU answers · Easy', () => setWhatIf('EASY')],
      ['CPU answers · Medium', () => setWhatIf('MEDIUM')],
      ['CPU answers · Hard', () => setWhatIf('HARD')],
    ],
  });
}

function showRules() {
  dialog({
    title: 'Cabeza — rules', ok: 'Got it', message:
      '• Red moves first, then players alternate.\n\n' +
      '• On your turn pick ONE piece and move it once or twice. The 2×2×2 block moves only once. The second move can\'t just undo the first.\n\n' +
      '• Blocks roll over one of their bottom edges (no diagonals). The cabeza moves one cell in any direction, like a chess king — ' +
      'but it can\'t slip diagonally between two pieces that block both the side and the front/back cell.\n\n' +
      '• Pieces can never overlap or hang off the board.\n\n' +
      '• WIN by bringing your cabeza to the far row, or by landing one of your blocks on the enemy cabeza (cabezas can\'t crush each other).\n\n' +
      'Click/tap a piece, then a green spot. Drag to orbit, scroll or pinch to zoom.\n\n' +
      'Menu → play a friend (pass & play) or the CPU (Easy / Medium / Hard).\n\n' +
      'Previous games → step through any saved game with ◀ ▶. Move a piece at any point to try a what-if; ↩ Real game takes you back.',
  });
}

function showGames() {
  const list = $('gamesList'); list.innerHTML = '';
  const records = Store.list();
  if (!records.length) {
    const p = document.createElement('p'); p.className = 'empty';
    p.textContent = "No games yet — they're saved automatically (in this browser) as you play.";
    list.append(p);
  }
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  for (const r of records) {
    const mode = r.cpuSide < 0 ? '2 players' : `vs CPU ${lvl(r.level)} · you ${playerName(1 - r.cpuSide).toLowerCase()}`;
    const result = r.winner === DRAW ? 'Draw' : r.winner < 0 ? 'Unfinished'
      : r.cpuSide < 0 ? (r.winner === RED ? 'Red won' : 'Blue won') : r.winner === r.cpuSide ? 'CPU won' : 'You won';
    const row = document.createElement('div'); row.className = 'gameRow';
    const b = document.createElement('button'); b.className = 'btn rec';
    b.style.color = r.winner === RED ? redUi : r.winner === BLUE ? blueUi : '#fff';
    b.innerHTML = `<span></span><small></small>`;
    b.children[0].textContent = `${fmt.format(new Date(r.id))}   ·   ${result}`;
    b.children[1].textContent = `${mode} · ${recTurns(r)} turns`;
    b.onclick = () => { hideMenu(); openRecord(r); };
    const del = document.createElement('button'); del.className = 'btn del'; del.textContent = '✕'; del.title = 'Delete';
    del.onclick = () => dialog({ title: 'Delete this game?', items: [['Delete', () => { Store.delete(r.id); showGames(); }]] });
    row.append(b, del);
    list.append(row);
  }
  $('menu').hidden = true;
  $('games').hidden = false;
}

// ───────────────────────── GL ─────────────────────────

const VS = `
uniform mat4 uMVP; uniform mat4 uModel; uniform mat4 uNrm;
attribute vec3 aPos; attribute vec3 aNormal;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal;
void main() {
  vLocal = aPos;
  vWorld = (uModel * vec4(aPos, 1.0)).xyz;
  vNormal = (uNrm * vec4(aNormal, 0.0)).xyz;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;
const FS = `
precision mediump float;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal;
uniform vec3 uColor; uniform vec3 uSize; uniform float uMode; uniform float uAlpha; uniform float uEmis;
uniform vec3 uLight; uniform vec3 uCam; uniform float uSpec;
void main() {
  if (uMode > 0.5 && uMode < 1.5) {          // soft contact shadow
    vec2 q = abs(vLocal.xz - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.45, 1.0, max(q.x, q.y));
    gl_FragColor = vec4(0.0, 0.0, 0.0, a * uAlpha);
    return;
  }
  if (uMode > 1.5) {                          // glowing target cells
    vec2 e2 = min(vLocal.xz, 1.0 - vLocal.xz) * uSize.xz;
    float e = min(e2.x, e2.y);
    float a = mix(1.0, 0.3, smoothstep(0.0, 0.12, e));
    gl_FragColor = vec4(uColor, a * uAlpha);
    return;
  }
  vec3 n = normalize(vNormal);
  vec3 base = uColor;
  if (uSize.x > 0.0) {                        // fake bevel along the box edges
    vec3 d = min(vLocal, 1.0 - vLocal) * uSize;
    float mn = min(d.x, min(d.y, d.z)); float mx = max(d.x, max(d.y, d.z));
    float mid = d.x + d.y + d.z - mn - mx;
    base = mix(base * 0.45, base, smoothstep(0.0, 0.02, mid));
    base += vec3(0.16) * (smoothstep(0.0, 0.02, mid) - smoothstep(0.03, 0.07, mid));
  }
  vec3 l = normalize(uLight);
  vec3 v = normalize(uCam - vWorld);
  float diff = max(dot(n, l), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  float spec = pow(max(dot(n, normalize(l + v)), 0.0), 48.0) * uSpec;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 col = base * (0.18 + 0.27 * hemi + 0.68 * diff) + vec3(spec) + rim * 0.10 * (base + 0.3) + uColor * uEmis;
  gl_FragColor = vec4(col, uAlpha);
}`;

const proj = new Float32Array(16), view = new Float32Array(16), vp = new Float32Array(16), invVp = new Float32Array(16);
const model = new Float32Array(16), mvp = new Float32Array(16), tmp = new Float32Array(16), nrm = new Float32Array(16);
const eye = [0, 0, 0];
let prog, aPos, aNormal, U = {}, cube, sphere;

const redCol = [0.86, 0.16, 0.19], blueCol = [0.16, 0.40, 0.92];
const gold = [1.0, 0.78, 0.28], moveCol = [0.35, 1.0, 0.62];

function initGL() {
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  aPos = gl.getAttribLocation(prog, 'aPos'); aNormal = gl.getAttribLocation(prog, 'aNormal');
  for (const n of ['uMVP', 'uModel', 'uNrm', 'uColor', 'uSize', 'uMode', 'uAlpha', 'uEmis', 'uLight', 'uCam', 'uSpec'])
    U[n] = gl.getUniformLocation(prog, n);
  cube = mesh(buildCube()); sphere = mesh(buildSphere(24, 16));
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0.075, 0.08, 0.105, 1);
}

function mesh(data) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { buf, count: data.length / 6 };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
}

function frame(now) {
  const dt = lastT === 0 ? 0 : Math.min((now - lastT) / 1000, 0.05);
  lastT = now; time += dt;
  resize();

  if (anim && now - anim.start >= anim.dur) { const a = anim; anim = null; haptic(a.move.captures >= 0); refreshTargets(); push(); }
  if (!anim) driveCpu();

  // Camera swings to whoever's turn it is; slow orbit once the game is over.
  if (!anim) {
    if (game.winner >= 0 && viewing === null) cam.yaw += dt * 0.25;
    else {
      const facing = viewing ? (viewing.cpuSide >= 0 ? 1 - viewing.cpuSide : RED) : cpuSide >= 0 ? 1 - cpuSide : game.turn;
      const target = facing === BLUE ? Math.PI : 0;
      let delta = target - cam.yaw;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      cam.yaw += delta * Math.min(1, dt * 3.5);
    }
  }
  setupCamera();

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(prog);
  gl.uniform3f(U.uLight, 0.45, 1.0, 0.35);
  gl.uniform3f(U.uCam, eye[0], eye[1], eye[2]);
  gl.enableVertexAttribArray(aPos); gl.enableVertexAttribArray(aNormal);

  drawBoard();

  // soft contact shadows
  gl.enable(gl.BLEND); gl.depthMask(false);
  game.pieces.forEach((p, i) => {
    let x0 = p.x - 5, z0 = 5 - (p.y + p.sy), sx = p.sx, sz = p.sy;
    if (anim && anim.move.piece === i) {
      const t = progress(anim), f = anim.from;
      x0 = lerp(f.x - 5, x0, t); z0 = lerp(5 - (f.y + f.sy), z0, t);
      sx = lerp(f.sx, sx, t); sz = lerp(f.sy, sz, t);
    }
    const pad = p.kind === CABEZA ? 0 : 0.16;
    boxModel(x0 - pad, 0.004, z0 - pad, sx + 2 * pad, 0.001, sz + 2 * pad);
    draw(cube, [0, 0, 0], { mode: 1, alpha: p.kind === CABEZA ? 0.45 : 0.55 });
  });
  gl.depthMask(true); gl.disable(gl.BLEND);

  // pieces
  game.pieces.forEach((p, i) => {
    const emis = i === selected && !anim ? 0.22 + 0.12 * Math.sin(time * 6) : 0;
    if (anim && anim.move.piece === i) drawAnimated(anim, emis); else drawPiece(i, p, emis);
  });

  // targets: glowing floor + ghost of where the piece lands
  if (!anim && targets.length) {
    gl.enable(gl.BLEND); gl.depthMask(false);
    const pulse = 0.55 + 0.25 * Math.sin(time * 4);
    for (const m of targets) {
      const c = m.captures >= 0 || m.goal ? gold : moveCol, t = m.to;
      boxModel(t.x - 5, 0.006, 5 - (t.y + t.sy), t.sx, 0.001, t.sy);
      draw(cube, c, { size: [t.sx, 0.001, t.sy], mode: 2, alpha: pulse });
    }
    for (const m of targets) {
      const c = m.captures >= 0 || m.goal ? gold : moveCol, t = m.to;
      if (t.kind === CABEZA) cabezaModels(t.x - 5 + 0.5, 0, 5 - t.y - 0.5, 1, (mesh, isDome) => {
        if (!isDome) draw(mesh, c, { alpha: 0.32, emis: 0.3 });
      });
      else {
        boxModel(t.x - 5, 0, 5 - (t.y + t.sy), t.sx, t.sz, t.sy);
        draw(cube, c, { size: sizeOf(t), alpha: 0.26, emis: 0.35 });
      }
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  requestAnimationFrame(frame);
}

function setupCamera() {
  const aspect = canvas.width / canvas.height;
  const fovy = 50;
  M4.perspective(proj, fovy, aspect, 0.5, 200);
  const halfV = fovy / 2 * Math.PI / 180;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const dist = cam.zoom * Math.max(6.4 / Math.tan(halfH), 7.2 / Math.tan(halfV));
  const yaw = cam.yaw + cam.dragYaw;
  const pr = cam.pitch * Math.PI / 180;
  eye[0] = Math.sin(yaw) * Math.cos(pr) * dist; eye[1] = Math.sin(pr) * dist; eye[2] = Math.cos(yaw) * Math.cos(pr) * dist;
  M4.lookAt(view, eye, [0, -0.6, 0], [0, 1, 0]);
  M4.mul(vp, proj, view);
  M4.invert(invVp, vp);
}

function drawBoard() {
  boxModel(-5.45, -0.6, -5.45, 10.9, 0.55, 10.9);
  draw(cube, [0.20, 0.13, 0.09], { size: [10.9, 0.55, 10.9], spec: 0.15 });
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const light = (r + c) % 2 === 1;
    const hash = ((c * 73 + r * 151) % 17) / 17 * 0.06;
    let cr = light ? 0.80 : 0.47, cg = light ? 0.72 : 0.36, cb = light ? 0.58 : 0.27;
    cr += hash; cg += hash; cb += hash;
    if (r === 0) { cr = cr * 0.75 + 0.22; cg *= 0.72; cb *= 0.72; }
    if (r === N - 1) { cr *= 0.72; cg *= 0.8; cb = cb * 0.75 + 0.22; }
    boxModel(c - 5 + 0.03, -0.14, 5 - r - 1 + 0.03, 0.94, 0.14, 0.94);
    draw(cube, [cr, cg, cb], { size: [0.94, 0.14, 0.94], spec: 0.12 });
  }
}

const colorOf = p => (p.owner === RED ? redCol : blueCol);
const sizeOf = p => [p.sx, p.sz, p.sy];

function drawPiece(i, p, emis) {
  const c = colorOf(p);
  if (p.kind === CABEZA) {
    const crushed = i === game.captured && !anim;
    const onTop = game.captured >= 0 && !anim && i !== game.captured && covers(game.pieces[game.captured], p.x, p.y);
    cabezaModels(p.x - 5 + 0.5, onTop ? 0.08 : 0, 5 - p.y - 0.5, crushed ? 0.25 : 1, (mesh, isDome) => {
      draw(mesh, isDome ? gold : c, { emis, spec: 0.9 });
    });
  } else {
    boxModel(p.x - 5, 0, 5 - (p.y + p.sy), p.sx, p.sz, p.sy);
    draw(cube, c, { size: sizeOf(p), emis, spec: 0.45 });
  }
}

function drawAnimated(a, emis) {
  const f = a.from, m = a.move, t = progress(a), c = colorOf(f);
  if (f.kind === CABEZA) {
    const x = lerp(f.x - 5 + 0.5, m.to.x - 5 + 0.5, t);
    const z = lerp(5 - f.y - 0.5, 5 - m.to.y - 0.5, t);
    cabezaModels(x, 0.55 * Math.sin(Math.PI * t), z, 1, (mesh, isDome) => draw(mesh, isDome ? gold : c, { emis, spec: 0.9 }));
    return;
  }
  // Tip the block over its bottom edge in the direction of travel.
  const ease = t * t; // accelerates like it's falling
  M4.ident(model);
  if (m.dx === 1) { const px = f.x + f.sx - 5; M4.translate(model, px, 0, 0); M4.rotate(model, -90 * ease, 0, 0, 1); M4.translate(model, -px, 0, 0); }
  else if (m.dx === -1) { const px = f.x - 5; M4.translate(model, px, 0, 0); M4.rotate(model, 90 * ease, 0, 0, 1); M4.translate(model, -px, 0, 0); }
  else if (m.dy === 1) { const pz = 5 - (f.y + f.sy); M4.translate(model, 0, 0, pz); M4.rotate(model, -90 * ease, 1, 0, 0); M4.translate(model, 0, 0, -pz); }
  else { const pz = 5 - f.y; M4.translate(model, 0, 0, pz); M4.rotate(model, 90 * ease, 1, 0, 0); M4.translate(model, 0, 0, -pz); }
  M4.translate(model, f.x - 5, 0, 5 - (f.y + f.sy));
  M4.scale(model, f.sx, f.sz, f.sy);
  draw(cube, c, { size: sizeOf(f), emis, spec: 0.45 });
}

/** UFO-shaped cabeza: a flattened disc with a golden dome. squash < 1 when crushed. */
function cabezaModels(cx, lift, cz, squash, drawPart) {
  M4.ident(model);
  M4.translate(model, cx, lift + 0.17 * squash, cz);
  M4.scale(model, 0.44, 0.15 * squash, 0.44);
  drawPart(sphere, false);
  M4.ident(model);
  M4.translate(model, cx, lift + 0.27 * squash, cz);
  M4.scale(model, 0.2, 0.17 * squash, 0.2);
  drawPart(sphere, true);
}

const progress = a => Math.max(0, Math.min(1, (performance.now() - a.start) / a.dur));
const lerp = (a, b, t) => a + (b - a) * t;

function boxModel(x, y, z, sx, sy, sz) {
  M4.ident(model); M4.translate(model, x, y, z); M4.scale(model, sx, sy, sz);
}

function draw(m, c, { size = null, mode = 0, alpha = 1, emis = 0, spec = 0.3 } = {}) {
  M4.mul(mvp, vp, model);
  M4.invert(tmp, model); M4.transpose(nrm, tmp);
  gl.uniformMatrix4fv(U.uMVP, false, mvp);
  gl.uniformMatrix4fv(U.uModel, false, model);
  gl.uniformMatrix4fv(U.uNrm, false, nrm);
  gl.uniform3f(U.uColor, c[0], c[1], c[2]);
  if (size) gl.uniform3f(U.uSize, size[0], size[1], size[2]); else gl.uniform3f(U.uSize, 0, 0, 0);
  gl.uniform1f(U.uMode, mode); gl.uniform1f(U.uAlpha, alpha); gl.uniform1f(U.uEmis, emis); gl.uniform1f(U.uSpec, spec);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 24, 12);
  gl.drawArrays(gl.TRIANGLES, 0, m.count);
}

// ───────── picking ─────────

function unproject(x, y, z) {
  const o = M4.mulV(invVp, [x, y, z, 1]);
  return [o[0] / o[3], o[1] / o[3], o[2] / o[3]];
}

function rayBox(o, d, p) {
  const height = p.kind === CABEZA ? 0.5 : p.sz;
  const mn = [p.x - 5, 0, 5 - (p.y + p.sy)], mx = [p.x + p.sx - 5, height, 5 - p.y];
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-6) {
      if (o[k] < mn[k] || o[k] > mx[k]) return Infinity;
    } else {
      let a = (mn[k] - o[k]) / d[k], b = (mx[k] - o[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

// ───────── meshes ─────────

function buildCube() {
  // (normal, u, v) with u × v = normal so every face winds CCW from outside.
  const faces = [
    [1, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, 0, 1, 0, 1, 0],
    [0, 1, 0, 0, 0, 1, 1, 0, 0], [0, -1, 0, 1, 0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 0, -1, 0, 1, 0, 1, 0, 0],
  ];
  const out = [];
  for (const f of faces) {
    const base = [0, 1, 2].map(k => Math.max(f[k], 0));
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      for (let k = 0; k < 3; k++) out.push(base[k] + a * f[3 + k] + b * f[6 + k]);
      for (let k = 0; k < 3; k++) out.push(f[k]);
    }
  }
  return out;
}

function buildSphere(seg, rings) {
  const pt = (i, j) => {
    const th = Math.PI * j / rings, ph = 2 * Math.PI * i / seg;
    return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
  };
  const out = [];
  const tri = (a, b, c) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const outward = n[0] * (a[0] + b[0] + c[0]) + n[1] * (a[1] + b[1] + c[1]) + n[2] * (a[2] + b[2] + c[2]) > 0;
    for (const p of outward ? [a, b, c] : [a, c, b]) out.push(...p, ...p);
  };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    if (j > 0) tri(a, b, c);
    if (j < rings - 1) tri(a, c, d);
  }
  return out;
}

// ───────────────────────── input ─────────────────────────

function setupInput() {
  const pts = new Map();
  let downX = 0, downY = 0, lastX = 0, lastY = 0, dragging = false, scaled = false, pinch0 = 0, zoom0 = 1;
  const slop = 8;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { downX = lastX = e.clientX; downY = lastY = e.clientY; dragging = false; scaled = false; }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = cam.zoom; scaled = true;
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) cam.zoom = Math.max(0.5, Math.min(1.6, zoom0 * pinch0 / d));
      return;
    }
    if (scaled) return;
    if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > slop) dragging = true;
    if (dragging) {
      cam.dragYaw -= (e.clientX - lastX) * 0.006;
      cam.pitch = Math.max(25, Math.min(88, cam.pitch + (e.clientY - lastY) * 0.15));
    }
    lastX = e.clientX; lastY = e.clientY;
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (e.type === 'pointerup' && pts.size === 0 && !dragging && !scaled) tap(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoom = Math.max(0.5, Math.min(1.6, cam.zoom * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('dialog').hidden) $('dialog').hidden = true;
      else if (!$('games').hidden) showMenu();
      else if ($('menu').hidden) showMenu();
      else if (canResume || viewing) hideMenu();
      return;
    }
    if (!$('menu').hidden || !$('games').hidden || !$('dialog').hidden) return;
    if (viewing) {
      if (e.key === 'ArrowLeft') viewPrev();
      else if (e.key === 'ArrowRight') viewNext();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') undo();
    else if (e.key === 'Enter' || e.key === ' ') endTurn();
  });
}

// ───────────────────────── boot ─────────────────────────

function bind() {
  const on = (id, fn) => { $(id).onclick = () => { haptic(false); fn(); }; };
  on('undoBtn', undo); on('endBtn', endTurn); on('menuBtn', showMenu); on('helpBtn', showRules);
  on('firstBtn', viewFirst); on('prevBtn', viewPrev); on('nextBtn', viewNext); on('lastBtn', viewLast);
  on('realBtn', backToRecord); on('whatIfBtn', chooseWhatIf); on('rEndBtn', endTurn); on('rMenuBtn', showMenu);
  on('againBtn', () => newGame()); on('reviewBtn', () => openRecord(liveRecord())); on('winMenuBtn', showMenu);
  on('resumeBtn', () => { hideMenu(); resumeLive(); });
  on('cpuBtn', chooseSide);
  on('pvpBtn', () => { hideMenu(); newGame(-1); });
  on('gamesBtn', showGames); on('rulesBtn', showRules); on('backBtn', showMenu);
  $('dialog').addEventListener('click', e => { if (e.target.id === 'dialog') $('dialog').hidden = true; });
}

if (!gl) {
  document.body.innerHTML = '<p style="padding:24px;color:#fff">Cabeza needs WebGL, which this browser doesn\'t provide.</p>';
} else {
  initGL(); bind(); setupInput();
  refreshTargets(); push();
  showMenu();
  requestAnimationFrame(frame);
}
