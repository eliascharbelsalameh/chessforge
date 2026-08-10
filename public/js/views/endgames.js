// Endgames: theory + play-out drills vs Stockfish with blunder warnings.
import { Chess } from '../../vendor/chess.js';
import { el, clear, toast, uciFrom, uciTo, opposite, isRecapture } from '../util.js';
import { Board, applyUci } from '../board.js';
import { engine } from '../engine.js';
import { thinkingMs, remainingMs } from '../pacing.js';
import * as state from '../state.js';
import { SECTIONS, DRILLS, drillsBySection, findDrill } from '../content/endgames.js';

let board = null;
let D = null; // active drill state
let timers = [];
function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
function clearTimers() { timers.forEach(clearTimeout); timers = []; }
const pause = (ms) => new Promise((resolve) => (ms > 0 ? later(resolve, ms) : resolve()));

export async function render(container, { path }) {
  if (path[0]) return renderDrill(container, path[0]);
  return renderIndex(container);
}

function renderIndex(container) {
  const s = state.get().endgames.drills;
  const doneCount = DRILLS.filter((d) => s[d.id]?.done).length;
  container.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Endgames' }),
      el('p', { text: `Master the positions every player must know — play them out against the engine. ${doneCount}/${DRILLS.length} completed.` })));

  for (const sec of drillsBySection()) {
    container.append(el('h2', { class: 'mt' }, `${sec.icon} ${sec.name}`));
    const list = el('div', { class: 'list' });
    for (const d of sec.drills) {
      const st = s[d.id];
      list.append(el('a', { class: 'list-item', href: `#/endgames/${d.id}` },
        el('span', { class: 'li-icon', text: st?.done ? '✅' : (d.goal === 'win' ? '🎯' : '🛡️') }),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, d.title, ' ',
            d.challenge ? el('span', { class: 'badge gray', text: 'challenge' }) : ''),
          el('div', { class: 'li-sub', text: `${d.goal === 'win' ? 'Win' : 'Hold the draw'} as ${d.side} · ${st ? `${st.attempts || 0} attempt${(st.attempts || 0) === 1 ? '' : 's'}` : 'not tried yet'}` })),
        el('span', { class: 'faint', text: '›' })));
    }
    container.append(list);
  }
}

function renderDrill(container, drillId) {
  const drill = findDrill(drillId);
  if (!drill) { location.hash = '#/endgames'; return; }
  D = {
    drill,
    chess: new Chess(drill.fen),
    playerColor: drill.side,
    engineColor: opposite(drill.side),
    over: false,
    hintIdx: 0,
    warned: false,
    thinking: false,
    plies: 0,
  };
  const dom = {};
  D.dom = dom;

  container.append(
    el('div', { class: 'page-head' },
      el('p', { class: 'small' }, el('a', { href: '#/endgames', text: '← Endgames' })),
      el('h1', { text: drill.title }),
      el('p', { text: `${drill.goal === 'win' ? 'Win this position' : 'Hold the draw'} as ${drill.side}. The engine defends at full strength.` })),
    el('div', { class: 'board-layout' },
      el('div', { class: 'board-col' }, dom.board = el('div', { class: 'board-wrap' })),
      el('div', { class: 'side-panel' },
        dom.status = el('div', { class: 'card' }),
        el('div', { class: 'card' },
          el('h3', { text: 'Theory' }),
          el('div', { class: 'prose', html: drill.theory })))));

  board = new Board(dom.board, {
    orientation: D.playerColor,
    onUserMove: userMove,
    showDests: state.get().settings.showDests,
  });
  board.sync(D.chess, { movableColor: D.playerColor });
  recordAttempt();
  status('play');
  if (turnColor() === D.engineColor) engineMove();
}

function turnColor() { return D.chess.turn() === 'w' ? 'white' : 'black'; }

function recordAttempt() {
  const id = D.drill.id;
  state.update('endgames', (e) => {
    if (!e.drills[id]) e.drills[id] = { done: false, attempts: 0 };
    e.drills[id].attempts = (e.drills[id].attempts || 0) + 1;
  });
}

async function userMove(from, to, promotion) {
  if (D.over || D.thinking || turnColor() !== D.playerColor) return;
  const mv = (() => { try { return D.chess.move({ from, to, promotion: promotion || 'q' }); } catch { return null; } })();
  if (!mv) { board.sync(D.chess, { movableColor: D.playerColor }); return; }
  D.plies++;
  board.shapes([]);
  board.sync(D.chess, { lastMove: [from, to], movableColor: undefined });
  if (checkGameEnd()) return;
  // blunder guard: quick eval after the player's move
  guardCheck();
  engineMove();
}

async function guardCheck() {
  if (D.over) return;
  try {
    const res = await engine.quickEval(D.chess.fen(), { movetime: 220 });
    if (!res || D.over) return;
    const povCp = (D.playerColor === 'white' ? 1 : -1) * (res.score.mate != null ? (res.score.mate > 0 ? 10000 : -10000) : res.score.cp);
    if (D.drill.goal === 'win' && povCp < 80 && !D.warned) {
      D.warned = true;
      status('warn-win');
    } else if (D.drill.goal === 'draw' && povCp < -350 && !D.warned) {
      D.warned = true;
      status('warn-draw');
    }
  } catch { /* engine hiccup — not fatal */ }
}

async function engineMove() {
  if (D.over || turnColor() !== D.engineColor) return;
  D.thinking = true;
  const fen = D.chess.fen();
  const startedAt = Date.now();
  try {
    const uci = await engine.bestMove(fen, [], { skill: 20, movetime: 320 });
    if (!D || D.over || !uci || D.chess.fen() !== fen) { if (D) D.thinking = false; return; }
    // Defend at a human tempo rather than snapping the reply back instantly.
    await pause(remainingMs(thinkingMs({
      pace: state.get().settings.enginePace,
      level: 6,
      legalMoves: D.chess.moves().length,
      fen,
      recapture: isRecapture(D.chess, uci),
    }), Date.now() - startedAt));
    if (!D) return;
    D.thinking = false;
    if (D.over || D.chess.fen() !== fen) return;
    const mv = applyUci(D.chess, uci);
    if (!mv) return;
    D.plies++;
    board.sync(D.chess, { lastMove: [uciFrom(uci), uciTo(uci)], movableColor: D.playerColor });
    if (checkGameEnd()) return;
    if (!D.warned) status('play');
  } catch (e) {
    if (!D) return;
    D.thinking = false;
    toast('Engine error — try reloading', 'bad');
  }
}

function checkGameEnd() {
  const c = D.chess;
  if (c.isCheckmate()) {
    const winner = turnColor() === 'white' ? 'black' : 'white';
    finish(winner === D.playerColor ? (D.drill.goal === 'win' ? 'success' : 'success') : 'mated');
    return true;
  }
  if (c.isStalemate() || c.isInsufficientMaterial() || c.isThreefoldRepetition() || c.isDraw()) {
    finish(D.drill.goal === 'draw' ? 'success' : 'drawn');
    return true;
  }
  return false;
}

function finish(result) {
  D.over = true;
  board.freeze();
  if (result === 'success') {
    state.update('endgames', (e) => { e.drills[D.drill.id].done = true; e.drills[D.drill.id].ts = Date.now(); });
    status('success');
  } else if (result === 'mated') {
    status('mated');
  } else {
    status('drawn');
  }
}

function takeback() {
  if (D.thinking) return;
  // undo to the player's previous decision point
  const undo1 = D.chess.undo();
  if (undo1 && turnColor() !== D.playerColor) D.chess.undo();
  D.over = false;
  D.warned = false;
  board.sync(D.chess, { movableColor: D.playerColor });
  status('play');
  if (turnColor() === D.engineColor) engineMove();
}

async function showHint() {
  if (D.over) return;
  const textHint = D.drill.hints[Math.min(D.hintIdx, D.drill.hints.length - 1)];
  D.hintIdx++;
  status('play', textHint);
}

async function showBestMove() {
  if (D.over || turnColor() !== D.playerColor) return;
  try {
    const res = await engine.quickEval(D.chess.fen(), { movetime: 500 });
    if (res?.bestmove && !D.over) {
      board.shapes([{ orig: uciFrom(res.bestmove), dest: uciTo(res.bestmove), brush: 'green' }]);
    }
  } catch { toast('Engine busy…'); }
}

function restart() {
  clearTimers();
  D.chess = new Chess(D.drill.fen);
  D.over = false;
  D.warned = false;
  D.thinking = false;
  D.hintIdx = 0;
  D.plies = 0;
  board.shapes([]);
  board.sync(D.chess, { movableColor: D.playerColor });
  recordAttempt();
  status('play');
  if (turnColor() === D.engineColor) engineMove();
}

function status(kind, hintText) {
  const dm = D.dom.status;
  clear(dm);
  const goalTxt = D.drill.goal === 'win' ? 'Win' : 'Hold the draw';
  if (kind === 'play' || kind === 'warn-win' || kind === 'warn-draw') {
    dm.append(el('div', { class: 'status-line' },
      el('span', { class: `turn-dot ${turnColor()}` }),
      el('strong', { text: turnColor() === D.playerColor ? 'Your move' : 'Engine thinking…' }),
      el('span', { class: 'muted small', text: `· ${goalTxt} · move ${Math.ceil(D.chess.moveNumber())}` })));
    if (kind === 'warn-win') {
      dm.append(el('p', { style: 'color:var(--bad)', text: '⚠ The win may have slipped away — take back and rethink?' }));
    } else if (kind === 'warn-draw') {
      dm.append(el('p', { style: 'color:var(--bad)', text: '⚠ Your position is getting lost — take back and rethink?' }));
    }
    if (hintText) dm.append(el('p', { class: 'muted', text: `💡 ${hintText}` }));
    dm.append(el('div', { class: 'btn-row' },
      btn('Hint', showHint, 'ghost'),
      btn('Best move', showBestMove, 'ghost'),
      btn('Take back', takeback, 'ghost'),
      btn('Restart', restart, 'ghost')));
  } else if (kind === 'success') {
    dm.append(
      el('div', { class: 'result-banner good', text: D.drill.goal === 'win' ? '🏆 Checkmate — drill complete!' : '🛡️ Draw held — drill complete!' }),
      el('div', { class: 'btn-row mt' },
        btn('Next drill →', () => {
          const idx = DRILLS.indexOf(D.drill);
          const next = DRILLS[(idx + 1) % DRILLS.length];
          location.hash = `#/endgames/${next.id}`;
        }, 'primary'),
        btn('Replay', restart, ''),
        btn('All drills', () => { location.hash = '#/endgames'; }, 'ghost')));
  } else if (kind === 'mated') {
    dm.append(
      el('div', { class: 'result-banner bad', text: 'Checkmated — the engine got you.' }),
      el('div', { class: 'btn-row mt' }, btn('Take back', takeback, ''), btn('Restart', restart, 'primary')));
  } else {
    dm.append(
      el('div', { class: 'result-banner bad', text: D.drill.goal === 'win' ? 'Draw — but you needed the win. Watch for stalemate!' : 'Lost the thread — this one should be a draw.' }),
      el('div', { class: 'btn-row mt' }, btn('Take back', takeback, ''), btn('Restart', restart, 'primary')));
  }
}

function btn(label, fn, cls = '') {
  const b = el('button', { class: `btn ${cls}`, text: label });
  b.addEventListener('click', fn);
  return b;
}

export function destroy() {
  clearTimers();
  engine.stopSearch();
  if (board) { board.destroy(); board = null; }
  D = null;
}
