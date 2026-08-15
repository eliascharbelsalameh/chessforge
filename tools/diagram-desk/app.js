/* Diagram Desk — rebuild a chess-book position, then play it out.
   Everything runs in this page: chess.js for the rules, chessground for the
   board, and a small alpha-beta engine below for the opponent. */
(() => {
'use strict';

const { Chess, validateFen } = window.__CHESSLIB__;
const Chessground = window.__CHESSGROUND__;

// ---------------------------------------------------------------- helpers
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
const $ = (id) => document.getElementById(id);
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function btn(label, onClick, cls = '') {
  return el('button', { class: `btn ${cls}`.trim(), type: 'button', text: label, onclick: onClick });
}

function toast(msg, kind = '') {
  const t = el('div', { class: `toast ${kind}`.trim(), text: msg });
  $('toast-root').append(t);
  setTimeout(() => { t.style.opacity = '0'; }, 2200);
  setTimeout(() => t.remove(), 2600);
}

function modal(...content) {
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, ...content);
  const back = el('div', { class: 'backdrop' }, box);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  $('modal-root').append(back);
  return { close, box };
}

async function copyText(text, okMsg = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg, 'good');
    return true;
  } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    toast(ok ? okMsg : 'Copy blocked here — select the text instead', ok ? 'good' : 'bad');
    return ok;
  }
}

// ------------------------------------------------------- position plumbing
const FILES = 'abcdefgh';
const ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const CASTLE_FLAGS = ['K', 'Q', 'k', 'q'];
const ROLE_LETTER = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
const LETTER_ROLE = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const ROLE_SYMBOL = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

const placementOf = (fen) => String(fen || '').trim().split(' ')[0];

function piecesFromPlacement(fen) {
  const map = new Map();
  const rows = placementOf(fen).split('/');
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    let f = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') { f += Number(ch); continue; }
      const role = LETTER_ROLE[ch.toLowerCase()];
      if (role && f < 8) map.set(FILES[f] + (8 - i), { role, color: ch === ch.toLowerCase() ? 'black' : 'white' });
      f++;
    }
  }
  return map;
}

function castlingAvailable(fen) {
  const p = piecesFromPlacement(fen);
  const is = (sq, role, color) => {
    const x = p.get(sq);
    return !!x && x.role === role && x.color === color;
  };
  const wk = is('e1', 'king', 'white');
  const bk = is('e8', 'king', 'black');
  return {
    K: wk && is('h1', 'rook', 'white'),
    Q: wk && is('a1', 'rook', 'white'),
    k: bk && is('h8', 'rook', 'black'),
    q: bk && is('a8', 'rook', 'black'),
  };
}

const castlingString = (r) => CASTLE_FLAGS.filter((f) => r && r[f]).join('') || '-';

function parseCastling(field) {
  const out = { K: false, Q: false, k: false, q: false };
  for (const f of CASTLE_FLAGS) if (String(field || '').includes(f)) out[f] = true;
  return out;
}

// An en-passant square only makes sense for the side to move, with the pawn
// that just double-stepped sitting beside it.
function epValid(placement, turn, ep) {
  if (!ep || ep === '-' || !/^[a-h][36]$/.test(ep)) return false;
  if (turn === 'w' && ep[1] !== '6') return false;
  if (turn === 'b' && ep[1] !== '3') return false;
  const pieces = piecesFromPlacement(placement);
  const pawn = pieces.get(ep[0] + (ep[1] === '6' ? '5' : '4'));
  const wanted = ep[1] === '6' ? 'black' : 'white';
  return !!pawn && pawn.role === 'pawn' && pawn.color === wanted && !pieces.has(ep);
}

function buildFen({ placement, turn = 'w', rights = {}, ep = '-', halfmove = 0, fullmove = 1 }) {
  const board = placementOf(placement);
  const avail = castlingAvailable(board);
  const eff = {};
  for (const f of CASTLE_FLAGS) eff[f] = !!rights[f] && avail[f];
  const half = Number.isFinite(+halfmove) ? Math.max(0, Math.floor(+halfmove)) : 0;
  const full = Number.isFinite(+fullmove) ? Math.max(1, Math.floor(+fullmove)) : 1;
  return `${board} ${turn === 'b' ? 'b' : 'w'} ${castlingString(eff)} ${epValid(board, turn, ep) ? ep : '-'} ${half} ${full}`;
}

function countPieces(fen) {
  const out = { white: {}, black: {}, whiteTotal: 0, blackTotal: 0 };
  for (const p of piecesFromPlacement(fen).values()) {
    out[p.color][p.role] = (out[p.color][p.role] || 0) + 1;
    out[p.color === 'white' ? 'whiteTotal' : 'blackTotal']++;
  }
  return out;
}

function materialLine(fen) {
  const c = countPieces(fen);
  const side = (color) => ROLES
    .map((r) => (c[color][r] ? (c[color][r] > 1 ? `${c[color][r]}${ROLE_SYMBOL[r]}` : ROLE_SYMBOL[r]) : null))
    .filter(Boolean).join('+') || '—';
  return `${side('white')} vs ${side('black')}`;
}

const describe = (fen) => `${fen.split(' ')[1] === 'b' ? 'Black' : 'White'} to move · ${materialLine(fen)}`;

function flipTurn(fen) {
  const t = fen.split(' ');
  return `${t[0]} ${t[1] === 'w' ? 'b' : 'w'} ${t[2] || '-'} - 0 1`;
}

function validate(fen) {
  const errors = [], warnings = [];
  const board = placementOf(fen);
  const turn = (fen.split(' ')[1] || 'w') === 'b' ? 'b' : 'w';
  const counts = countPieces(board);

  for (const color of ['white', 'black']) {
    const kings = counts[color].king || 0;
    if (kings === 0) errors.push(`${cap(color)} needs a king`);
    else if (kings > 1) errors.push(`${cap(color)} has ${kings} kings`);
  }
  const rows = board.split('/');
  if (/p/i.test((rows[0] || '') + (rows[7] || ''))) errors.push('Pawns cannot stand on the 1st or 8th rank');
  for (const color of ['white', 'black']) {
    const total = color === 'white' ? counts.whiteTotal : counts.blackTotal;
    if (total > 16) errors.push(`${cap(color)} has ${total} pieces (16 is the limit)`);
    if ((counts[color].pawn || 0) > 8) errors.push(`${cap(color)} has ${counts[color].pawn} pawns (8 is the limit)`);
  }

  let chess = null;
  if (!errors.length) {
    const v = validateFen(fen);
    if (!v.ok) errors.push(v.error.replace('Invalid FEN: ', 'FEN problem: '));
    else { try { chess = new Chess(fen); } catch (e) { errors.push(String(e.message || e)); } }
  }
  if (chess) {
    let opponentInCheck = false;
    try { opponentInCheck = new Chess(flipTurn(fen)).inCheck(); } catch { /* unreachable */ }
    if (opponentInCheck) {
      errors.push(`${cap(turn === 'w' ? 'black' : 'white')} is in check, but it is ${turn === 'w' ? 'White' : 'Black'} to move`);
      chess = null;
    }
  }

  let over = '';
  if (chess) {
    if (chess.isCheckmate()) over = 'checkmate';
    else if (chess.isStalemate()) over = 'stalemate';
    else if (chess.isInsufficientMaterial()) over = 'insufficient material';
    if (over) warnings.push(`The position is already over — ${over}.`);
    else if (chess.inCheck()) warnings.push(`${turn === 'w' ? 'White' : 'Black'} is in check.`);
  }
  return { ok: errors.length === 0 && !!chess, playable: errors.length === 0 && !!chess && !over, errors, warnings, over };
}

// --------------------------------------------------------------- the store
const KEY = 'diagram-desk.v1';
const DEFAULTS = () => ({
  items: [],
  editor: { fen: START_FEN, orientation: 'white' },
  prefs: { level: 3, side: 'auto', pace: 'human' },
});
let DB = DEFAULTS();
let storageBlocked = false;

function loadDB() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      DB = { ...DEFAULTS(), ...parsed };
      DB.prefs = { ...DEFAULTS().prefs, ...(parsed.prefs || {}) };
      DB.editor = { ...DEFAULTS().editor, ...(parsed.editor || {}) };
      if (!Array.isArray(DB.items)) DB.items = [];
    }
  } catch (e) {
    storageBlocked = true;
  }
}

let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch { markBlocked(); }
  }, 200);
}

function markBlocked() {
  if (storageBlocked) return;
  storageBlocked = true;
  showStorageNote();
}

function showStorageNote() {
  const note = $('storage-note');
  if (!storageBlocked) { note.hidden = true; return; }
  note.hidden = false;
  note.textContent = 'This browser is not letting the page store anything, so the library lives only in this tab. Use Export to keep it.';
}

// -------------------------------------------------------------- the engine
// Alpha-beta over chess.js: material + piece-square tables, captures searched
// to quiet. Strong enough to punish a plan you have not understood yet.
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10,
     5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5,
     5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40,
     -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
     -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
     -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10,
     -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
     -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
     -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5,
     -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
     -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10,
     -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5,
     -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
     -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
     -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
     20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  kEnd: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30,
     -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
     -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,
     -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};

const MATE = 100000;
let nodes = 0, deadline = 0, aborted = false;

function evaluate(chess) {
  const board = chess.board();
  let material = 0;
  for (const row of board) for (const sq of row) {
    if (sq && sq.type !== 'p' && sq.type !== 'k') material += VALUE[sq.type];
  }
  const endgame = material <= 1300;
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const sq = board[r][c];
    if (!sq) continue;
    const idx = sq.color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
    const table = sq.type === 'k' ? (endgame ? PST.kEnd : PST.k) : PST[sq.type];
    const v = VALUE[sq.type] + table[idx];
    score += sq.color === 'w' ? v : -v;
  }
  return score;
}

const evalPov = (chess) => (chess.turn() === 'w' ? evaluate(chess) : -evaluate(chess));
const timeUp = () => (nodes & 255) === 0 && Date.now() > deadline;

function orderMoves(moves) {
  return moves.slice().sort((a, b) => rank(b) - rank(a));
  function rank(m) {
    let s = 0;
    if (m.captured) s += 1000 + VALUE[m.captured] - VALUE[m.piece] / 10;
    if (m.promotion) s += 800;
    if (m.san && m.san.includes('+')) s += 40;
    return s;
  }
}

function quiesce(chess, alpha, beta, qply) {
  nodes++;
  const stand = evalPov(chess);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (qply >= 4 || timeUp()) return alpha;
  const caps = orderMoves(chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion));
  for (const m of caps) {
    chess.move(m);
    const s = -quiesce(chess, -beta, -alpha, qply + 1);
    chess.undo();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function negamax(chess, depth, alpha, beta, ply) {
  nodes++;
  if (timeUp()) { aborted = true; return 0; }
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return chess.inCheck() ? -MATE + ply : 0;
  if (depth <= 0) return quiesce(chess, alpha, beta, 0);
  let best = -Infinity;
  for (const m of orderMoves(moves)) {
    chess.move(m);
    const s = -negamax(chess, depth - 1, -beta, -alpha, ply + 1);
    chess.undo();
    if (aborted) return 0;
    if (s > best) best = s;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

const LEVELS = [
  { n: 1, label: 'Beginner', blurb: 'Sees one move ahead, and wanders.', depth: 1, noise: 220, blunder: 0.22, time: 200 },
  { n: 2, label: 'Casual', blurb: 'Two moves deep, still generous.', depth: 2, noise: 90, blunder: 0.08, time: 400 },
  { n: 3, label: 'Club', blurb: 'Punishes loose pieces and short tactics.', depth: 3, noise: 30, blunder: 0.02, time: 800 },
  { n: 4, label: 'Strong', blurb: 'Defends endgames accurately.', depth: 4, noise: 0, blunder: 0, time: 1400 },
  { n: 5, label: 'Maximum', blurb: 'As deep as this page can search.', depth: 6, noise: 0, blunder: 0, time: 2200 },
];
const levelBy = (n) => LEVELS.find((l) => l.n === Number(n)) || LEVELS[2];

// Returns {move, score, depth} with score from the side to move's point of view.
function search(fen, level) {
  let chess;
  try { chess = new Chess(fen); } catch { return null; }
  let roots = chess.moves({ verbose: true });
  if (!roots.length) return null;
  if (level.blunder && Math.random() < level.blunder) {
    return { move: roots[Math.floor(Math.random() * roots.length)], score: 0, depth: 0 };
  }
  roots = orderMoves(roots);
  nodes = 0;
  aborted = false;
  deadline = Date.now() + level.time;
  const wide = level.noise > 50; // noisy levels must score every move, so no cutoffs
  let best = { move: roots[0], score: 0, depth: 0 };
  for (let d = 1; d <= level.depth; d++) {
    const scored = [];
    let alpha = -Infinity;
    for (const m of roots) {
      chess.move(m);
      const s = -negamax(chess, d - 1, -Infinity, wide ? Infinity : -alpha, 1);
      chess.undo();
      if (aborted) break;
      const noisy = level.noise ? s + (Math.random() - 0.5) * 2 * level.noise : s;
      scored.push({ m, s: noisy });
      if (!wide && noisy > alpha) alpha = noisy;
    }
    if (scored.length < roots.length) break; // ran out of time mid-iteration
    scored.sort((a, b) => b.s - a.s);
    best = { move: scored[0].m, score: scored[0].s, depth: d };
    roots = scored.map((x) => x.m);
    if (Math.abs(best.score) > MATE - 1000) break;
    if (Date.now() > deadline) break;
  }
  return best;
}

// A plausible continuation for the evaluation readout.
function principalLine(fen, level, plies = 5) {
  const c = new Chess(fen);
  const sans = [];
  const quick = { depth: Math.max(2, level.depth - 1), noise: 0, blunder: 0, time: 220 };
  for (let i = 0; i < plies; i++) {
    if (c.isGameOver()) break;
    const r = search(c.fen(), quick);
    if (!r) break;
    const mv = c.move(r.move);
    if (!mv) break;
    sans.push(mv.san);
  }
  return sans;
}

function scoreText(cp, whitePov) {
  if (Math.abs(cp) > MATE - 1000) {
    const plies = MATE - Math.abs(cp);
    const n = Math.max(1, Math.ceil(plies / 2));
    return `${cp > 0 === whitePov ? '#' : '#-'}${n}`;
  }
  const p = cp / 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(2)}`;
}

// ---------------------------------------------------------- engine pacing
const PACES = [
  { id: 'instant', label: 'Instant' },
  { id: 'brisk', label: 'Brisk' },
  { id: 'human', label: 'Human' },
  { id: 'relaxed', label: 'Relaxed' },
];
const PACE_PROFILE = {
  instant: { base: 0, spread: 0, min: 0, max: 0 },
  brisk: { base: 420, spread: 0.45, min: 150, max: 1800 },
  human: { base: 950, spread: 0.7, min: 280, max: 5200 },
  relaxed: { base: 1900, spread: 0.8, min: 700, max: 9000 },
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function thinkingMs({ pace, level, legalMoves, fen, recapture }) {
  const p = PACE_PROFILE[pace] || PACE_PROFILE.human;
  if (!p.base) return 0;
  if (legalMoves <= 1) return Math.round(p.min * 1.25);
  const pieces = piecesFromPlacement(fen).size;
  let t = p.base;
  t *= 0.72 + 0.1 * (clamp(level, 1, 5) - 1);
  t *= clamp(0.55 + 0.85 * (legalMoves / 32), 0.55, 1.7);
  if (pieces <= 8) t *= 0.8;
  t *= 1 + p.spread * (Math.random() + Math.random() - 1);
  if (recapture) t *= 0.5;
  else if (Math.random() < 0.07) t *= 2.2;
  return Math.round(clamp(t, p.min, p.max) / 10) * 10;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// --------------------------------------------------------------- the board
const PROMO = ['queen', 'knight', 'rook', 'bishop'];
const PROMO_LETTER = { queen: 'q', knight: 'n', rook: 'r', bishop: 'b' };

function legalDests(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

let cg = null;            // the live chessground
let cgEl = null;
let promoOverlay = null;
let resizeObs = null;

function makeBoard(config) {
  destroyBoard();
  const host = $('board');
  cgEl = el('div');
  host.append(cgEl);
  cg = Chessground(cgEl, config);
  resizeObs = new ResizeObserver(() => {
    cg.redrawAll();
    if (promoOverlay) cgEl.append(promoOverlay); // redrawAll rebuilds the wrap
  });
  resizeObs.observe(host);
  return cg;
}

function destroyBoard() {
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  if (cg) { cg.destroy(); cg = null; }
  promoOverlay = null;
  clear($('board'));
}

function pickPromotion(dest, color) {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'promo-overlay' });
    const fileIdx = dest.charCodeAt(0) - 97;
    const orient = cg.state.orientation;
    const left = (orient === 'white' ? fileIdx : 7 - fileIdx) * 12.5;
    const fromTop = (orient === 'white') === (dest[1] === '8');
    const col = el('div', {
      class: 'promo-col',
      style: `left:${left}%; ${fromTop ? 'top:0' : 'bottom:0; flex-direction:column-reverse'}`,
    });
    const close = (letter) => { promoOverlay = null; overlay.remove(); resolve(letter); };
    for (const role of PROMO) {
      const p = el('piece', { class: `${color} ${role}`, role: 'button', 'aria-label': role });
      p.addEventListener('click', (e) => { e.stopPropagation(); close(PROMO_LETTER[role]); });
      col.append(p);
    }
    overlay.addEventListener('click', () => close(null));
    overlay.append(col);
    promoOverlay = overlay;
    cgEl.append(overlay);
  });
}

// ------------------------------------------------------------- app state
const S = {
  mode: 'edit',
  placement: placementOf(START_FEN),
  turn: 'w',
  rights: parseCastling('KQkq'),
  ep: '-',
  halfmove: 0,
  fullmove: 1,
  orientation: 'white',
  tool: null,
  loading: false,
  activeId: null,      // library entry the board came from
  verdict: null,
  game: null,
};

function lockTrays(locked) {
  for (const id of ['tray-black', 'tray-white']) $(id).classList.toggle('locked', locked);
}

const currentFen = () => buildFen({
  placement: S.placement, turn: S.turn, rights: S.rights,
  ep: S.ep, halfmove: S.halfmove, fullmove: S.fullmove,
});

// ------------------------------------------------------------ editor mode
function enterEditMode(fen) {
  S.mode = 'edit';
  S.game = null;
  lockTrays(false);
  if (fen) applyFen(fen, { silent: true, keepActive: true });
  buildEditorBoard();
  renderTrays();
  renderPanel();
  refresh();
}

function buildEditorBoard() {
  makeBoard({
    fen: S.placement,
    orientation: S.orientation,
    autoCastle: false, // a king dragged two squares must not drag a rook along
    animation: { enabled: false },
    movable: { free: true, color: 'both', showDests: false },
    premovable: { enabled: false },
    predroppable: { enabled: false },
    draggable: { enabled: true, showGhost: true, deleteOnDropOff: true },
    selectable: { enabled: false },
    highlight: { lastMove: false, check: false },
    drawable: { enabled: true },
    blockTouchScroll: true,
    coordinates: true,
    events: { change: onBoardEdited },
  });
  cgEl.addEventListener('click', tapSquare);
  $('board-hint').textContent = 'Drag pieces on, drag them off to remove. On a touch screen: tap a piece in the tray, then tap squares.';
}

function onBoardEdited() {
  S.placement = cg.getFen();
  if (!S.loading) { S.ep = '-'; S.halfmove = 0; }
  refresh();
}

function tapSquare(ev) {
  if (S.mode !== 'edit' || !S.tool) return;
  const key = cg.getKeyAtDomPos([ev.clientX, ev.clientY]);
  if (!key) return;
  cg.setPieces(new Map([[key, S.tool === 'erase' ? undefined : { ...S.tool }]]));
  onBoardEdited();
}

function renderTrays() {
  for (const color of ['black', 'white']) {
    const bar = clear($(`tray-${color}`));
    bar.classList.add('cg-wrap'); // the sprite rules are scoped to .cg-wrap
    for (const role of ROLES) bar.append(sparePiece(color, role));
    if (color === 'white') {
      const eraser = el('button', {
        class: 'tray-tool', type: 'button', title: 'Eraser — tap squares to clear them',
        'aria-label': 'Eraser', text: '⌫', dataset: { tool: 'erase' },
        onclick: () => selectTool(S.tool === 'erase' ? null : 'erase'),
      });
      bar.append(eraser);
    }
  }
}

function sparePiece(color, role) {
  const piece = { role, color };
  const node = el('piece', {
    class: `${color} ${role}`, role: 'button', 'aria-label': `${color} ${role}`,
    title: `${cap(color)} ${role}`, dataset: { tool: `${color}-${role}` },
  });
  let origin = null;
  const start = (ev) => {
    if (S.mode !== 'edit') return;
    if (ev.type === 'mousedown' && ev.button !== 0) return;
    ev.preventDefault();
    const pt = ev.touches ? ev.touches[0] : ev;
    origin = { x: pt.clientX, y: pt.clientY };
    cg.dragNewPiece({ ...piece }, ev, true);
  };
  // Let go over the tray rather than the board = a tap: arm tap-to-place.
  const end = (ev) => {
    if (!origin) return;
    const pt = ev.changedTouches ? ev.changedTouches[0] : ev;
    const near = Math.abs(pt.clientX - origin.x) < 12 && Math.abs(pt.clientY - origin.y) < 12;
    origin = null;
    if (near) selectTool(sameTool(S.tool, piece) ? null : piece);
  };
  node.addEventListener('mousedown', start);
  node.addEventListener('mouseup', end);
  node.addEventListener('touchstart', start, { passive: false });
  node.addEventListener('touchend', end);
  return node;
}

const sameTool = (a, b) => !!a && a !== 'erase' && a.role === b.role && a.color === b.color;

function selectTool(tool) {
  S.tool = tool;
  const key = tool === 'erase' ? 'erase' : tool ? `${tool.color}-${tool.role}` : '';
  for (const node of document.querySelectorAll('.tray [data-tool]')) {
    node.classList.toggle('selected', node.dataset.tool === key);
  }
}

function applyFen(text, { silent = false, keepActive = false } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const t = raw.split(/\s+/);
  const fen = [
    t[0],
    t[1] === 'b' ? 'b' : 'w',
    t[2] && /^[KQkq-]+$/.test(t[2]) ? t[2] : 'KQkq',
    t[3] && /^([a-h][36]|-)$/.test(t[3]) ? t[3] : '-',
    t[4] && /^\d+$/.test(t[4]) ? t[4] : '0',
    t[5] && /^\d+$/.test(t[5]) ? t[5] : '1',
  ].join(' ');
  if (placementOf(fen).split('/').length !== 8) {
    if (!silent) toast('That does not look like a FEN', 'bad');
    return false;
  }
  S.loading = true;
  const parts = fen.split(' ');
  S.turn = parts[1];
  S.rights = parseCastling(parts[2]);
  S.ep = parts[3];
  S.halfmove = Number(parts[4]) || 0;
  S.fullmove = Number(parts[5]) || 1;
  S.placement = placementOf(fen);
  if (!keepActive) S.activeId = null;
  if (cg && S.mode === 'edit') cg.set({ fen: S.placement });
  S.loading = false;
  refresh();
  return true;
}

// ---------------------------------------------------------------- panels
function renderPanel() {
  const panel = clear($('panel'));
  if (S.mode === 'edit') panel.append(setupCard(), practiceCard());
  else panel.append(gameCard(), movesCard());
}

const P = {}; // live nodes the refresh pass talks to

function setupCard() {
  const card = el('div', { class: 'card' });
  P.turnChips = {};
  P.castleChips = {};

  const turnRow = el('div', { class: 'chip-row' });
  for (const [value, label] of [['w', 'White to move'], ['b', 'Black to move']]) {
    const chip = el('button', {
      class: 'chip', type: 'button', text: label,
      onclick: () => { S.turn = value; S.ep = '-'; refresh(); },
    });
    P.turnChips[value] = chip;
    turnRow.append(chip);
  }

  const castleRow = el('div', { class: 'chip-row' });
  for (const [flag, label] of [['K', 'White O-O'], ['Q', 'White O-O-O'], ['k', 'Black O-O'], ['q', 'Black O-O-O']]) {
    const chip = el('button', {
      class: 'chip', type: 'button', text: label,
      onclick: () => { S.rights[flag] = !S.rights[flag]; refresh(); },
    });
    P.castleChips[flag] = chip;
    castleRow.append(chip);
  }

  P.fenInput = el('input', { type: 'text', spellcheck: 'false', 'aria-label': 'FEN' });
  P.fenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFen(P.fenInput.value); });

  card.append(
    el('span', { class: 'eyebrow', text: 'The position' }),
    el('div', { class: 'stack' },
      el('div', { class: 'btn-row' },
        btn('Start position', () => applyFen(START_FEN), 'tiny ghost'),
        btn('Clear board', () => applyFen(EMPTY_FEN, { silent: true }), 'tiny ghost'),
        btn('Flip board', flipBoard, 'tiny ghost')),
      el('div', { class: 'control' }, el('span', { class: 'label', text: 'Turn' }), turnRow),
      el('div', { class: 'control' }, el('span', { class: 'label', text: 'Castling' }), castleRow),
      el('div', { class: 'stack', style: 'gap:0.35rem' },
        el('span', { class: 'label', style: 'font-size:0.78rem;color:var(--muted)', text: 'FEN' }),
        P.fenInput,
        el('div', { class: 'btn-row' },
          btn('Load FEN', () => applyFen(P.fenInput.value), 'tiny'),
          btn('Copy FEN', () => copyText(currentFen(), 'FEN copied'), 'tiny ghost')))),
    P.verdict = el('div', { class: 'verdict' }));
  return card;
}

function practiceCard() {
  const card = el('div', { class: 'card' });
  P.sideSel = el('select', { 'aria-label': 'Which side you play' },
    el('option', { value: 'auto', text: 'Whoever is to move' }),
    el('option', { value: 'white', text: 'White' }),
    el('option', { value: 'black', text: 'Black' }));
  P.sideSel.value = DB.prefs.side;
  P.sideSel.addEventListener('change', () => { DB.prefs.side = P.sideSel.value; saveDB(); });

  P.levelSel = el('select', { 'aria-label': 'Engine strength' },
    LEVELS.map((l) => el('option', { value: String(l.n), text: `${l.n} · ${l.label}` })));
  P.levelSel.value = String(DB.prefs.level);
  P.levelSel.addEventListener('change', () => {
    DB.prefs.level = Number(P.levelSel.value);
    saveDB();
    P.levelBlurb.textContent = levelBy(DB.prefs.level).blurb;
  });

  P.paceSel = el('select', { 'aria-label': 'Engine pace' },
    PACES.map((p) => el('option', { value: p.id, text: p.label })));
  P.paceSel.value = DB.prefs.pace;
  P.paceSel.addEventListener('change', () => { DB.prefs.pace = P.paceSel.value; saveDB(); });

  P.playBtn = btn('Play this position', startGame, 'primary');
  P.evalBtn = btn('Evaluate', runEvaluation, '');
  P.saveBtn = btn('Save to library', saveDialog, 'ghost');
  P.evalBox = el('div', { class: 'stack', style: 'gap:0.4rem' });

  card.append(
    el('span', { class: 'eyebrow', text: 'Put it to work' }),
    el('div', { class: 'stack' },
      el('div', { class: 'control' }, el('span', { class: 'label', text: 'You play' }), P.sideSel),
      el('div', { class: 'control' }, el('span', { class: 'label', text: 'Engine' }), P.levelSel),
      P.levelBlurb = el('p', { style: 'font-size:0.78rem;color:var(--faint);margin-left:5.75rem', text: levelBy(DB.prefs.level).blurb }),
      el('div', { class: 'control' }, el('span', { class: 'label', text: 'Pace' }), P.paceSel),
      el('div', { class: 'btn-row' }, P.playBtn, P.evalBtn, P.saveBtn),
      P.evalBox));
  return card;
}

function refresh() {
  if (S.mode !== 'edit') return;
  const fen = currentFen();
  const res = validate(fen);
  S.verdict = res;

  for (const [value, chip] of Object.entries(P.turnChips)) chip.classList.toggle('on', S.turn === value);
  const avail = castlingAvailable(S.placement);
  for (const flag of CASTLE_FLAGS) {
    const chip = P.castleChips[flag];
    chip.disabled = !avail[flag];
    chip.classList.toggle('on', !!S.rights[flag] && avail[flag]);
    chip.title = avail[flag] ? '' : 'Needs the king and that rook on their home squares';
  }
  if (document.activeElement !== P.fenInput) P.fenInput.value = fen;

  const v = clear(P.verdict);
  v.className = `verdict ${res.ok ? 'ok' : 'bad'}`;
  if (res.ok) {
    v.append(
      el('span', { class: 'head', text: 'Legal position' }),
      el('span', { class: 'note mono', text: describe(fen) }));
  } else {
    v.append(el('span', { class: 'head', text: 'Not playable yet' }));
    for (const e of res.errors) v.append(el('span', { class: 'note', text: e }));
  }
  for (const w of res.warnings) v.append(el('span', { class: 'warn', text: w }));

  P.playBtn.disabled = !res.playable;
  P.evalBtn.disabled = !res.ok;
  P.saveBtn.disabled = !res.ok;
  const active = S.activeId ? DB.items.find((i) => i.id === S.activeId) : null;
  P.saveBtn.textContent = active ? `Save to “${active.name}”` : 'Save to library';

  rememberEditor();
  markCurrentCard();
}

// The desk is left exactly as you found it next time you open the page.
function rememberEditor() {
  DB.editor = { fen: currentFen(), orientation: S.orientation, activeId: S.activeId };
  saveDB();
}

function flipBoard() {
  S.orientation = S.orientation === 'white' ? 'black' : 'white';
  cg.toggleOrientation();
  rememberEditor();
}

// ------------------------------------------------------------- evaluation
async function runEvaluation() {
  const fen = currentFen();
  const res = validate(fen);
  if (!res.ok) return;
  const level = levelBy(DB.prefs.level);
  P.evalBtn.disabled = true;
  const box = clear(P.evalBox);
  box.append(el('p', { class: 'eval-line thinking', text: 'Searching' }));
  await sleep(30); // let the label paint before the search blocks the thread
  const chess = new Chess(fen);
  let out;
  if (chess.isGameOver()) {
    out = { text: chess.isCheckmate() ? 'Checkmate — the game is over.' : 'Drawn — the game is over.', pct: 50, score: null, line: [] };
  } else {
    const r = search(fen, { ...level, noise: 0, blunder: 0, time: Math.max(700, level.time) });
    const whitePov = chess.turn() === 'w' ? r.score : -r.score;
    out = {
      score: scoreText(whitePov, true),
      pct: Math.abs(whitePov) > MATE - 1000 ? (whitePov > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.004 * whitePov)) - 1),
      line: principalLine(fen, level),
      depth: r.depth,
    };
  }
  clear(box);
  if (out.text) {
    box.append(el('p', { class: 'eval-line', text: out.text }));
  } else {
    box.append(
      el('div', { class: 'evalbar', title: 'How much of the bar White holds' },
        el('div', { class: 'fill', style: `width:${out.pct.toFixed(1)}%` }),
        el('div', { class: 'mid' })),
      el('div', { class: 'row', style: 'gap:0.6rem' },
        el('span', { class: 'eval-score', text: out.score }),
        el('span', { style: 'font-size:0.76rem;color:var(--faint)', text: `depth ${out.depth} · White’s point of view` })),
      el('p', { class: 'eval-line', text: out.line.join(' ') || '—' }));
  }
  P.evalBtn.disabled = false;
}

// -------------------------------------------------------------- play mode
function startGame() {
  const fen = currentFen();
  const res = validate(fen);
  if (!res.playable) { toast(res.errors[0] || 'This position cannot be played', 'bad'); return; }
  const chess = new Chess(fen);
  const side = DB.prefs.side;
  const color = side === 'white' || side === 'black' ? side : (chess.turn() === 'w' ? 'white' : 'black');
  S.game = {
    chess,
    startFen: fen,
    color,
    level: levelBy(DB.prefs.level),
    sans: [],
    over: false,
    thinking: false,
    scored: false,
    positionId: S.activeId,
    result: null,
    banner: null,
  };
  S.mode = 'play';
  S.orientation = color;
  lockTrays(true);
  buildPlayBoard();
  renderPanel();
  syncPlayBoard();
  if (turnColor() !== color) engineTurn();
}

const turnColor = () => (S.game.chess.turn() === 'w' ? 'white' : 'black');

function buildPlayBoard() {
  makeBoard({
    fen: S.game.chess.fen(),
    orientation: S.orientation,
    animation: { enabled: true, duration: 180 },
    movable: { free: false, color: undefined, showDests: true },
    draggable: { showGhost: true },
    selectable: { enabled: true },
    highlight: { lastMove: true, check: true },
    coordinates: true,
    drawable: { enabled: true },
    events: { move: (orig, dest) => onUserMove(orig, dest) },
  });
  $('board-hint').textContent = 'Your move — drag or tap a piece.';
}

function syncPlayBoard(lastMove) {
  const g = S.game;
  const canMove = !g.over && turnColor() === g.color ? g.color : undefined;
  cg.set({
    fen: g.chess.fen(),
    turnColor: turnColor(),
    check: g.chess.inCheck(),
    lastMove: lastMove || undefined,
    movable: { free: false, color: canMove, dests: canMove ? legalDests(g.chess) : new Map(), showDests: true },
  });
}

async function onUserMove(orig, dest) {
  const g = S.game;
  if (!g || g.over || g.thinking || turnColor() !== g.color) { syncPlayBoard(); return; }
  let promotion;
  const piece = g.chess.get(orig);
  if (piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
    promotion = await pickPromotion(dest, piece.color === 'w' ? 'white' : 'black');
    if (!promotion) { syncPlayBoard(); return; }
  }
  let mv = null;
  try { mv = g.chess.move({ from: orig, to: dest, promotion: promotion || 'q' }); } catch { mv = null; }
  if (!mv) { syncPlayBoard(); return; }
  g.sans.push(mv.san);
  cg.setAutoShapes([]);
  syncPlayBoard([orig, dest]);
  renderPanel();
  if (checkEnd()) return;
  engineTurn();
}

async function engineTurn() {
  const g = S.game;
  if (!g || g.over) return;
  g.thinking = true;
  renderPanel();
  const fen = g.chess.fen();
  const startedAt = Date.now();
  await sleep(40); // paint "thinking" before the search takes the thread
  if (S.game !== g || g.over) return;
  const r = search(fen, g.level);
  if (S.game !== g || g.over || !r) { g.thinking = false; return; }
  const last = g.chess.history({ verbose: true }).slice(-1)[0];
  const recapture = !!(last && last.captured && r.move.to === last.to);
  const target = thinkingMs({
    pace: DB.prefs.pace, level: g.level.n, legalMoves: g.chess.moves().length, fen, recapture,
  });
  await sleep(target - (Date.now() - startedAt));
  if (S.game !== g || g.over || g.chess.fen() !== fen) { g.thinking = false; return; }
  const mv = g.chess.move(r.move);
  g.thinking = false;
  if (!mv) return;
  g.sans.push(mv.san);
  syncPlayBoard([mv.from, mv.to]);
  renderPanel();
  checkEnd();
}

function checkEnd() {
  const g = S.game;
  const c = g.chess;
  if (!c.isGameOver()) return false;
  g.over = true;
  if (c.isCheckmate()) {
    const winner = turnColor() === 'white' ? 'black' : 'white';
    g.result = winner === g.color ? 'win' : 'loss';
    g.banner = winner === g.color ? 'Checkmate — you won.' : 'Checkmate — the engine won.';
  } else {
    g.result = 'draw';
    g.banner = c.isStalemate() ? 'Stalemate — drawn.'
      : c.isInsufficientMaterial() ? 'Drawn — not enough material to mate.'
      : c.isThreefoldRepetition() ? 'Drawn by repetition.' : 'Drawn by the 50-move rule.';
  }
  recordResult();
  syncPlayBoard();
  renderPanel();
  return true;
}

function recordResult() {
  const g = S.game;
  if (!g || g.scored || !g.result || !g.positionId) return;
  g.scored = true;
  const item = DB.items.find((i) => i.id === g.positionId);
  if (!item) return;
  item.plays = (item.plays || 0) + 1;
  const key = g.result === 'win' ? 'wins' : g.result === 'loss' ? 'losses' : 'draws';
  item[key] = (item[key] || 0) + 1;
  item.lastPlayed = Date.now();
  saveDB();
  renderLibrary();
}

function resign() {
  const g = S.game;
  if (!g || g.over) return;
  g.over = true;
  g.result = 'loss';
  g.banner = 'You resigned.';
  recordResult();
  syncPlayBoard();
  renderPanel();
}

function takeback() {
  const g = S.game;
  if (!g || g.thinking) return;
  if (g.chess.undo()) g.sans.pop();
  if (turnColor() !== g.color && g.chess.undo()) g.sans.pop();
  g.over = false;
  g.banner = null;
  g.result = null;
  cg.setAutoShapes([]);
  syncPlayBoard();
  renderPanel();
  if (turnColor() !== g.color) engineTurn();
}

async function hint() {
  const g = S.game;
  if (!g || g.over || g.thinking || turnColor() !== g.color) return;
  await sleep(20);
  const r = search(g.chess.fen(), { ...levelBy(4), time: 500 });
  if (r && S.game === g && !g.over) {
    cg.setAutoShapes([{ orig: r.move.from, dest: r.move.to, brush: 'green' }]);
  }
}

function gameCard() {
  const g = S.game;
  const card = el('div', { class: 'card' });
  const item = g.positionId ? DB.items.find((i) => i.id === g.positionId) : null;
  const head = el('div', { class: 'status-line' });
  if (g.over) {
    card.append(
      el('span', { class: 'eyebrow', text: 'Result' }),
      el('div', { class: `banner ${g.result === 'win' ? 'good' : g.result === 'loss' ? 'bad' : ''}`.trim(), text: g.banner }),
      el('div', { class: 'btn-row', style: 'margin-top:0.7rem' },
        btn('Play it again', () => { applyFen(g.startFen, { silent: true, keepActive: true }); startGame(); }, 'primary'),
        btn('Back to the board', () => enterEditMode(g.startFen), 'ghost')));
  } else {
    head.append(
      el('span', { class: `turn-dot ${turnColor()}` }),
      g.thinking
        ? el('strong', { class: 'thinking', text: 'Engine thinking' })
        : el('strong', { text: turnColor() === g.color ? 'Your move' : '…' }),
      el('span', { style: 'font-size:0.8rem;color:var(--faint)', text: `Level ${g.level.n} · ${g.level.label}` }));
    card.append(
      el('span', { class: 'eyebrow', text: item ? item.name : 'Playing the position' }),
      head,
      el('div', { class: 'btn-row', style: 'margin-top:0.7rem' },
        btn('Hint', hint, 'tiny ghost'),
        btn('Take back', takeback, 'tiny ghost'),
        btn('Flip', () => { S.orientation = S.orientation === 'white' ? 'black' : 'white'; cg.toggleOrientation(); }, 'tiny ghost'),
        btn('Resign', resign, 'tiny ghost danger'),
        btn('Back to the board', () => enterEditMode(g.startFen), 'tiny ghost')));
  }
  return card;
}

function movesCard() {
  const g = S.game;
  const list = el('div', { class: 'movelist' });
  if (!g.sans.length) list.append(el('span', { style: 'color:var(--faint)', text: 'No moves yet.' }));
  g.sans.forEach((san, i) => {
    if (i % 2 === 0) list.append(el('span', { class: 'num', text: `${i / 2 + 1}.` }));
    list.append(el('span', { class: `mv${i === g.sans.length - 1 ? ' last' : ''}`, text: san }), ' ');
  });
  return el('div', { class: 'card' },
    el('span', { class: 'eyebrow', text: 'Moves' }),
    list,
    el('div', { class: 'btn-row', style: 'margin-top:0.6rem' },
      btn('Copy moves', () => copyText(g.sans.join(' '), 'Moves copied'), 'tiny ghost'),
      btn('Copy FEN', () => copyText(g.chess.fen(), 'FEN copied'), 'tiny ghost')));
}

// ---------------------------------------------------------------- library
function saveDialog() {
  const fen = currentFen();
  if (!validate(fen).ok) { toast('Fix the position first', 'bad'); return; }
  const existing = S.activeId ? DB.items.find((i) => i.id === S.activeId) : null;
  const name = el('input', { type: 'text', value: existing ? existing.name : '', placeholder: 'Lucena position' });
  const source = el('input', { type: 'text', value: existing ? existing.source : '', placeholder: 'Dvoretsky, ch. 5 — diagram 142' });
  name.style.fontFamily = 'var(--ui)';
  source.style.fontFamily = 'var(--ui)';

  const commit = (mode) => {
    const title = name.value.trim() || describe(fen);
    if (mode === 'update' && existing) {
      existing.name = title;
      existing.source = source.value.trim();
      existing.fen = fen;
      toast('Position updated', 'good');
    } else {
      const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
      DB.items.unshift({
        id, name: title, source: source.value.trim(), fen,
        created: Date.now(), plays: 0, wins: 0, draws: 0, losses: 0, lastPlayed: 0,
      });
      S.activeId = id;
      toast('Saved to your library', 'good');
    }
    saveDB();
    m.close();
    renderLibrary();
    refresh();
  };

  const m = modal(
    el('h3', { text: existing ? 'Save position' : 'Save this position' }),
    el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
    el('label', { class: 'field' }, el('span', { text: 'Where it came from' }), source),
    el('p', { class: 'fen', text: fen }),
    el('div', { class: 'btn-row' },
      existing ? btn(`Update “${existing.name}”`, () => commit('update'), 'primary') : null,
      btn(existing ? 'Save as a new entry' : 'Save', () => commit('new'), existing ? '' : 'primary'),
      btn('Cancel', () => m.close(), 'ghost')));
  name.focus();
}

function renderLibrary() {
  const host = clear($('library'));
  const n = DB.items.length;
  $('lib-count').textContent = n ? `${n} saved` : '';
  if (!n) {
    host.append(el('p', { class: 'empty' },
      'Nothing saved yet. Set up a position above and press ',
      el('strong', { text: 'Save to library' }),
      ' — the ones you keep here are the ones worth replaying until they are second nature.'));
    return;
  }
  const grid = el('div', { class: 'lib-grid' });
  for (const item of DB.items) grid.append(libraryCard(item));
  host.append(grid);
}

function libraryCard(item) {
  const played = item.plays || 0;
  const record = played
    ? el('div', { class: 'lib-record' },
        el('span', { class: 'w', text: `${item.wins || 0}W` }), ' ',
        el('span', { text: `${item.draws || 0}D` }), ' ',
        el('span', { class: 'l', text: `${item.losses || 0}L` }),
        el('span', { style: 'color:var(--faint)', text: ` · ${played} played` }))
    : el('div', { class: 'lib-meta', text: 'Not played yet' });
  return el('div', { class: `lib-card${item.id === S.activeId ? ' current' : ''}`, dataset: { id: item.id } },
    miniDiagram(item.fen),
    el('div', { class: 'lib-body' },
      el('div', { class: 'lib-title', text: item.name }),
      item.source ? el('div', { class: 'lib-source', text: item.source }) : null,
      el('div', { class: 'lib-meta', text: describe(item.fen) }),
      record,
      el('div', { class: 'btn-row' },
        btn('Open', () => openItem(item), 'tiny'),
        btn('Play', () => { openItem(item, true); startGame(); }, 'tiny ghost'),
        btn('Delete', () => deleteItem(item), 'tiny ghost danger'))));
}

function openItem(item, quiet = false) {
  S.activeId = item.id;
  if (S.mode !== 'edit') enterEditMode(item.fen);
  else applyFen(item.fen, { keepActive: true });
  S.activeId = item.id;
  refresh();
  renderLibrary();
  if (!quiet) {
    toast(`Opened “${item.name}”`);
    document.querySelector('.workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function deleteItem(item) {
  const m = modal(
    el('h3', { text: 'Delete this position?' }),
    el('p', { style: 'color:var(--muted)' }, `“${item.name}” will be removed from your library.`),
    el('div', { class: 'btn-row' },
      btn('Delete', () => {
        DB.items = DB.items.filter((x) => x.id !== item.id);
        if (S.activeId === item.id) S.activeId = null;
        saveDB();
        m.close();
        renderLibrary();
        if (S.mode === 'edit') refresh();
      }, 'primary'),
      btn('Keep it', () => m.close(), 'ghost')));
}

function markCurrentCard() {
  for (const card of document.querySelectorAll('.lib-card')) {
    card.classList.toggle('current', card.dataset.id === S.activeId);
  }
}

function miniDiagram(fen) {
  const wrap = el('div', { class: 'mini cg-wrap', role: 'img', 'aria-label': describe(fen) });
  for (const [sq, piece] of piecesFromPlacement(fen)) {
    const x = FILES.indexOf(sq[0]);
    const y = 8 - Number(sq[1]);
    if (x < 0 || y < 0 || y > 7) continue;
    wrap.append(el('piece', { class: `${piece.color} ${piece.role}`, style: `transform: translate(${x * 100}%, ${y * 100}%)` }));
  }
  return wrap;
}

// ----------------------------------------------------------- import/export
async function exportLibrary() {
  const json = JSON.stringify({ app: 'diagram-desk', version: 1, exported: new Date().toISOString(), items: DB.items }, null, 2);
  const area = el('textarea', { readonly: true, 'aria-label': 'Library JSON' });
  area.value = json;
  const copyBtn = btn('Copy JSON', () => copyText(json, 'Library copied'), 'primary');
  const row = el('div', { class: 'btn-row' }, copyBtn, btn('Close', () => m.close(), 'ghost'));
  const m = modal(
    el('h3', { text: 'Export your library' }),
    el('p', { style: 'color:var(--muted);font-size:0.87rem', text: `${DB.items.length} position${DB.items.length === 1 ? '' : 's'}. Keep this text somewhere safe — pasting it back into Import restores everything, including your results.` }),
    area, row);
  area.focus();
  area.select();

  let downloads = null;
  try {
    downloads = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
  } catch { downloads = null; }
  if (downloads) {
    copyBtn.classList.remove('primary');
    row.prepend(btn('Save as a file', async () => {
      try {
        await downloads.save({ filename: 'diagram-desk-library.json', data: json });
        toast('Saved', 'good');
      } catch (err) {
        toast(err && err.code === 'declined' ? 'Save cancelled' : 'Could not save the file', 'bad');
      }
    }, 'primary'));
  }
}

function importLibrary() {
  const area = el('textarea', { placeholder: 'Paste the JSON you exported…', 'aria-label': 'Library JSON' });
  const problem = el('p', { style: 'color:var(--bad);font-size:0.83rem' });
  const m = modal(
    el('h3', { text: 'Import positions' }),
    el('p', { style: 'color:var(--muted);font-size:0.87rem', text: 'Entries you already have are updated in place; the rest are added.' }),
    area, problem,
    el('div', { class: 'btn-row' },
      btn('Import', () => {
        let data;
        try { data = JSON.parse(area.value); } catch { problem.textContent = 'That is not valid JSON.'; return; }
        const incoming = Array.isArray(data) ? data : data.items;
        if (!Array.isArray(incoming)) { problem.textContent = 'No positions found in that file.'; return; }
        let added = 0, updated = 0;
        for (const raw of incoming) {
          if (!raw || typeof raw.fen !== 'string' || !validate(raw.fen).ok) continue;
          const item = {
            id: raw.id || `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
            name: String(raw.name || describe(raw.fen)).slice(0, 120),
            source: String(raw.source || '').slice(0, 200),
            fen: raw.fen,
            created: Number(raw.created) || Date.now(),
            plays: Number(raw.plays) || 0,
            wins: Number(raw.wins) || 0,
            draws: Number(raw.draws) || 0,
            losses: Number(raw.losses) || 0,
            lastPlayed: Number(raw.lastPlayed) || 0,
          };
          const at = DB.items.findIndex((x) => x.id === item.id);
          if (at >= 0) { DB.items[at] = item; updated++; } else { DB.items.unshift(item); added++; }
        }
        if (!added && !updated) { problem.textContent = 'None of those entries held a legal position.'; return; }
        saveDB();
        renderLibrary();
        m.close();
        toast(`${added} added, ${updated} updated`, 'good');
      }, 'primary'),
      btn('Cancel', () => m.close(), 'ghost')));
  area.focus();
}

// -------------------------------------------------------------------- boot
loadDB();
showStorageNote();
S.orientation = DB.editor.orientation === 'black' ? 'black' : 'white';
const startFen = validate(DB.editor.fen || '').ok || placementOf(DB.editor.fen || '').split('/').length === 8
  ? DB.editor.fen : START_FEN;
applyFenIntoState(startFen);
if (DB.editor.activeId && DB.items.some((i) => i.id === DB.editor.activeId)) S.activeId = DB.editor.activeId;
buildEditorBoard();
renderTrays();
renderPanel();
refresh();
renderLibrary();
$('btn-export').addEventListener('click', exportLibrary);
$('btn-import').addEventListener('click', importLibrary);

function applyFenIntoState(fen) {
  const parts = String(fen).trim().split(/\s+/);
  S.placement = placementOf(fen);
  S.turn = parts[1] === 'b' ? 'b' : 'w';
  S.rights = parseCastling(parts[2] || 'KQkq');
  S.ep = /^[a-h][36]$/.test(parts[3] || '') ? parts[3] : '-';
  S.halfmove = Number(parts[4]) || 0;
  S.fullmove = Number(parts[5]) || 1;
}
})();
