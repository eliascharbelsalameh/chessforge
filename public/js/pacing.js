// How long a bot waits before its move appears on the board.
//
// Stockfish answers in ~100-500ms, which reads as a machine reflex rather than
// an opponent. This models a human clock instead: quick in the opening and on
// recaptures, slower when the position branches, with jitter and the occasional
// long think. Pure and dependency-free — tools/test_all.mjs exercises it with a
// fixed rand().

export const PACES = [
  { id: 'instant', label: 'Instant', blurb: 'Replies the moment the search ends.' },
  { id: 'brisk', label: 'Brisk', blurb: 'Short blitz-style pauses.' },
  { id: 'human', label: 'Human-like', blurb: 'Fast recaptures, longer thinks in messy positions.' },
  { id: 'relaxed', label: 'Relaxed', blurb: 'Classical pace — time to follow along.' },
];

const PROFILES = {
  instant: { base: 0, spread: 0, min: 0, max: 0 },
  brisk: { base: 420, spread: 0.45, min: 150, max: 1800 },
  human: { base: 950, spread: 0.7, min: 280, max: 5200 },
  relaxed: { base: 1900, spread: 0.8, min: 700, max: 9000 },
};

export const DEFAULT_PACE = 'human';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Piece count and ply straight off the FEN — no chess.js needed.
export function phaseFromFen(fen) {
  const parts = String(fen || '').split(' ');
  const pieces = (parts[0].match(/[a-zA-Z]/g) || []).length;
  const fullmove = Number(parts[5]) || 1;
  const ply = Math.max(0, fullmove - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
  return { pieces, ply };
}

/**
 * Target think time in ms for one engine move.
 * @param {object} o
 * @param {string} o.pace      one of PACES[].id
 * @param {number} o.level     1-8 difficulty (stronger opponents ponder longer)
 * @param {number} o.legalMoves  legal moves in the position (branching factor)
 * @param {string} o.fen       position the engine is moving from
 * @param {boolean} o.recapture  the move takes back on the square just captured
 * @param {function} o.rand    injectable RNG; called at most three times
 */
export function thinkingMs({
  pace = DEFAULT_PACE, level = 4, legalMoves = 30, fen = null,
  recapture = false, rand = Math.random,
} = {}) {
  const p = PROFILES[pace] || PROFILES[DEFAULT_PACE];
  if (!p.base) return 0;
  if (legalMoves <= 1) return Math.round(p.min * 1.25); // only move: play it

  const { pieces, ply } = fen ? phaseFromFen(fen) : { pieces: 32, ply: 20 };
  let t = p.base;
  t *= 0.72 + 0.08 * (clamp(level, 1, 8) - 1);          // 0.72x at L1 → 1.28x at L8
  t *= clamp(0.55 + 0.85 * (legalMoves / 32), 0.55, 1.7);
  if (ply < 12) t *= 0.45 + 0.045 * ply;                // book-ish moves come fast
  if (pieces <= 8) t *= 0.8;                            // simple endings flow

  // triangular jitter around 1.0 so pauses never land on the same beat
  const jitter = 1 + p.spread * (rand() + rand() - 1);
  t *= jitter;

  if (recapture) t *= 0.5;
  else if (rand() < 0.07) t *= 2.4;                     // "wait, is there something here?"

  return Math.round(clamp(t, p.min, p.max) / 10) * 10;
}

// What is still left to wait after a search that already took `elapsedMs`.
export function remainingMs(targetMs, elapsedMs) {
  return Math.max(0, Math.round(targetMs - elapsedMs));
}
