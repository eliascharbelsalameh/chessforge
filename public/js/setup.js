// Board-editor logic: turn a hand-placed piece layout into a FEN, and say
// whether that position is legal enough to play or analyse. Pure — the
// drag-and-drop half lives in editor.js / views/positions.js.
import { Chess, validateFen } from '../vendor/chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
export const FILES = 'abcdefgh';
export const ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
export const CASTLE_FLAGS = ['K', 'Q', 'k', 'q'];

const ROLE_LETTER = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };
const LETTER_ROLE = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const ROLE_SYMBOL = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };

export const placementOf = (fen) => String(fen || '').trim().split(' ')[0];

// Map<square, {role, color}> (chessground's shape) -> FEN placement field.
export function placementFromPieces(pieces) {
  const at = pieces instanceof Map ? (k) => pieces.get(k) : (k) => pieces[k];
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = at(FILES[f] + rank);
      if (!p || !ROLE_LETTER[p.role]) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const letter = ROLE_LETTER[p.role];
      row += p.color === 'black' ? letter : letter.toUpperCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

// The inverse — used by the editor and by the little library diagrams.
export function piecesFromPlacement(fen) {
  const map = new Map();
  const rows = placementOf(fen).split('/');
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    let f = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') { f += Number(ch); continue; }
      const role = LETTER_ROLE[ch.toLowerCase()];
      if (role && f < 8) {
        map.set(FILES[f] + (8 - i), { role, color: ch === ch.toLowerCase() ? 'black' : 'white' });
      }
      f++;
    }
  }
  return map;
}

// Which castling rights the layout can even support (king home, rook home).
export function castlingAvailable(fen) {
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

export function castlingString(rights) {
  return CASTLE_FLAGS.filter((f) => rights && rights[f]).join('') || '-';
}

export function parseCastling(field) {
  const rights = { K: false, Q: false, k: false, q: false };
  for (const f of CASTLE_FLAGS) if (String(field || '').includes(f)) rights[f] = true;
  return rights;
}

// An en-passant square only makes sense for the side to move, with the pawn
// that just double-stepped sitting beside it.
export function epValid(placement, turn, ep) {
  if (!ep || ep === '-' || !/^[a-h][36]$/.test(ep)) return false;
  if (turn === 'w' && ep[1] !== '6') return false;
  if (turn === 'b' && ep[1] !== '3') return false;
  const pieces = piecesFromPlacement(placement);
  const pawnRank = ep[1] === '6' ? '5' : '4';
  const pawn = pieces.get(ep[0] + pawnRank);
  const wanted = ep[1] === '6' ? 'black' : 'white';
  return !!pawn && pawn.role === 'pawn' && pawn.color === wanted && !pieces.has(ep);
}

export function buildFen({ placement, turn = 'w', rights = {}, ep = '-', halfmove = 0, fullmove = 1 }) {
  const board = placementOf(placement);
  const avail = castlingAvailable(board);
  const effective = {};
  for (const f of CASTLE_FLAGS) effective[f] = !!rights[f] && avail[f];
  const half = Number.isFinite(+halfmove) ? Math.max(0, Math.floor(+halfmove)) : 0;
  const full = Number.isFinite(+fullmove) ? Math.max(1, Math.floor(+fullmove)) : 1;
  const epField = epValid(board, turn, ep) ? ep : '-';
  return `${board} ${turn === 'b' ? 'b' : 'w'} ${castlingString(effective)} ${epField} ${half} ${full}`;
}

export function countPieces(fen) {
  const out = { white: {}, black: {}, whiteTotal: 0, blackTotal: 0 };
  for (const p of piecesFromPlacement(fen).values()) {
    out[p.color][p.role] = (out[p.color][p.role] || 0) + 1;
    out[p.color === 'white' ? 'whiteTotal' : 'blackTotal']++;
  }
  return out;
}

// "K+Q+R+3P vs K+R+2P" — the shorthand a book uses to name a position.
export function materialLine(fen) {
  const c = countPieces(fen);
  const side = (color) => ROLES
    .map((r) => (c[color][r] ? (c[color][r] > 1 ? `${c[color][r]}${ROLE_SYMBOL[r]}` : ROLE_SYMBOL[r]) : null))
    .filter(Boolean).join('+') || '—';
  return `${side('white')} vs ${side('black')}`;
}

// Same FEN with the other side to move — how we test whether the player who
// supposedly just moved left their own king en prise.
function flipTurn(fen) {
  const t = fen.split(' ');
  return `${t[0]} ${t[1] === 'w' ? 'b' : 'w'} ${t[2] || '-'} - 0 1`;
}

/**
 * @returns {{ok, playable, errors: string[], warnings: string[], chess: Chess|null, over: string}}
 * errors block use of the position; warnings are worth reading but harmless.
 */
export function validate(fen) {
  const errors = [], warnings = [];
  const board = placementOf(fen);
  const turn = (fen.split(' ')[1] || 'w') === 'b' ? 'b' : 'w';
  const counts = countPieces(board);

  // Friendlier wording than chess.js for the mistakes you make with a mouse.
  const kings = { white: counts.white.king || 0, black: counts.black.king || 0 };
  for (const color of ['white', 'black']) {
    if (kings[color] === 0) errors.push(`${cap(color)} needs a king`);
    else if (kings[color] > 1) errors.push(`${cap(color)} has ${kings[color]} kings`);
  }
  const rows = board.split('/');
  if (/p/i.test((rows[0] || '') + (rows[7] || ''))) errors.push('Pawns cannot stand on the 1st or 8th rank');
  for (const color of ['white', 'black']) {
    const total = color === 'white' ? counts.whiteTotal : counts.blackTotal;
    if (total > 16) errors.push(`${cap(color)} has ${total} pieces (max 16)`);
    if ((counts[color].pawn || 0) > 8) errors.push(`${cap(color)} has ${counts[color].pawn} pawns (max 8)`);
  }

  let chess = null;
  if (!errors.length) {
    const v = validateFen(fen);
    if (!v.ok) errors.push(v.error.replace('Invalid FEN: ', 'FEN problem: '));
    else {
      try { chess = new Chess(fen); } catch (e) { errors.push(String(e.message || e)); }
    }
  }
  if (chess) {
    let opponentInCheck = false;
    try { opponentInCheck = new Chess(flipTurn(fen)).inCheck(); } catch { /* unreachable position */ }
    if (opponentInCheck) {
      errors.push(`${cap(turn === 'w' ? 'black' : 'white')} is in check but it is ${turn === 'w' ? 'White' : 'Black'}'s move`);
      chess = null;
    }
  }

  let over = '';
  if (chess) {
    if (chess.isCheckmate()) over = 'checkmate';
    else if (chess.isStalemate()) over = 'stalemate';
    else if (chess.isInsufficientMaterial()) over = 'insufficient material';
    if (over) warnings.push(`This position is already over — ${over}.`);
    else if (chess.inCheck()) warnings.push(`${turn === 'w' ? 'White' : 'Black'} is in check.`);
    if (!counts.white.pawn && !counts.black.pawn && counts.whiteTotal + counts.blackTotal > 12) {
      warnings.push('No pawns on the board — check you copied the diagram right.');
    }
  }
  const ok = errors.length === 0 && !!chess;
  return { ok, playable: ok && !over, errors, warnings, chess, over };
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// A short, stable description for saved positions ("White to move · K+R vs K").
export function describe(fen) {
  const turn = (fen.split(' ')[1] || 'w') === 'b' ? 'Black' : 'White';
  return `${turn} to move · ${materialLine(fen)}`;
}
