// Play a full game against Stockfish at a chosen strength.
import { Chess } from '../../vendor/chess.js';
import { el, clear, toast, opposite, uciFrom, uciTo, fenTurn } from '../util.js';
import { Board, applyUci } from '../board.js';
import { engine, LEVELS } from '../engine.js';
import * as state from '../state.js';

let board = null;
let G = null;
let dom = {};

export async function render(container, { query }) {
  dom = {};
  const presetFen = sessionStorage.getItem('play.fen');
  const presetColor = sessionStorage.getItem('play.color');
  sessionStorage.removeItem('play.fen');
  sessionStorage.removeItem('play.color');

  container.append(
    el('div', { class: 'page-head' }, el('h1', { text: 'Play vs engine' })),
    el('div', { class: 'board-layout' },
      el('div', { class: 'board-col' }, dom.board = el('div', { class: 'board-wrap' })),
      dom.panel = el('div', { class: 'side-panel' })));

  board = new Board(dom.board, {
    onUserMove: userMove,
    showDests: state.get().settings.showDests,
    animate: state.get().settings.animate,
  });

  if (presetFen) startGame({ fen: presetFen, color: presetColor || fenTurn(presetFen), level: 4 });
  else renderSetup();
}

function renderSetup() {
  const s = state.get();
  const games = s.play.games;
  const recent = games.slice(-5).reverse();
  clear(dom.panel);
  const colorSel = el('select', {},
    el('option', { value: 'white', text: 'Play as White' }),
    el('option', { value: 'black', text: 'Play as Black' }),
    el('option', { value: 'random', text: 'Random side' }));
  const levelSel = el('select', {}, LEVELS.map((l) =>
    el('option', { value: String(l.n), text: `Level ${l.n} — ${l.label}` })));
  levelSel.value = String(s.play.lastLevel || 3);
  const fenInput = el('input', { type: 'text', placeholder: 'startpos (or paste a FEN)' });

  const startBtn = el('button', { class: 'btn primary', text: '▶ Start game' });
  startBtn.addEventListener('click', () => {
    let color = colorSel.value;
    if (color === 'random') color = Math.random() < 0.5 ? 'white' : 'black';
    let fen = fenInput.value.trim() || null;
    if (fen) {
      try { new Chess(fen); } catch { toast('Invalid FEN', 'bad'); return; }
    }
    startGame({ fen, color, level: Number(levelSel.value) });
  });

  dom.panel.append(
    el('div', { class: 'card' },
      el('h3', { text: 'New game' }),
      el('label', { class: 'field' }, el('span', { text: 'Side' }), colorSel),
      el('label', { class: 'field' }, el('span', { text: 'Strength' }), levelSel),
      el('label', { class: 'field' }, el('span', { text: 'Starting position (optional)' }), fenInput),
      startBtn),
    recent.length ? el('div', { class: 'card' },
      el('h3', { text: 'Recent games' }),
      el('div', { class: 'list' }, recent.map((g) => el('div', { class: 'row between small' },
        el('span', { class: 'muted', text: `L${g.level} as ${g.color}` }),
        el('span', {
          text: g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Draw',
          style: `color:${g.result === 'win' ? 'var(--good-strong)' : g.result === 'loss' ? 'var(--bad)' : 'var(--muted)'}`,
        }))))) : null);
  board.setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
}

function startGame({ fen, color, level }) {
  let chess;
  try { chess = fen ? new Chess(fen) : new Chess(); } catch { chess = new Chess(); }
  G = {
    chess,
    color,
    level: LEVELS.find((l) => l.n === level) || LEVELS[2],
    over: false,
    thinking: false,
    resultSaved: false,
    startFen: chess.fen(),
    sans: [],
  };
  state.update('play', (p) => { p.lastLevel = level; });
  board.orient(color);
  board.sync(chess, { movableColor: color });
  renderGamePanel();
  if (turnColor() !== color) engineTurn();
}

function turnColor() { return G.chess.turn() === 'w' ? 'white' : 'black'; }

async function userMove(from, to, promotion) {
  if (!G || G.over || G.thinking || turnColor() !== G.color) return;
  const mv = (() => { try { return G.chess.move({ from, to, promotion: promotion || 'q' }); } catch { return null; } })();
  if (!mv) { board.sync(G.chess, { movableColor: G.color }); return; }
  G.sans.push(mv.san);
  board.shapes([]);
  board.sync(G.chess, { lastMove: [from, to], movableColor: undefined });
  renderGamePanel();
  if (checkEnd()) return;
  engineTurn();
}

async function engineTurn() {
  if (!G || G.over) return;
  G.thinking = true;
  renderGamePanel();
  const fen = G.chess.fen();
  try {
    const uci = await engine.bestMove(fen, [], { skill: G.level.skill, movetime: G.level.movetime });
    G.thinking = false;
    if (!G || G.over || !uci || G.chess.fen() !== fen) return;
    const mv = applyUci(G.chess, uci);
    if (mv) {
      G.sans.push(mv.san);
      board.sync(G.chess, { lastMove: [uciFrom(uci), uciTo(uci)], movableColor: G.color });
    }
    renderGamePanel();
    checkEnd();
  } catch {
    G.thinking = false;
    toast('Engine error', 'bad');
  }
}

function checkEnd() {
  const c = G.chess;
  if (!c.isGameOver()) return false;
  G.over = true;
  let result, text;
  if (c.isCheckmate()) {
    const winner = turnColor() === 'white' ? 'black' : 'white';
    result = winner === G.color ? 'win' : 'loss';
    text = winner === G.color ? '🏆 You won by checkmate!' : 'Checkmate — the engine wins.';
  } else {
    result = 'draw';
    text = c.isStalemate() ? 'Draw by stalemate' :
      c.isInsufficientMaterial() ? 'Draw — insufficient material' :
      c.isThreefoldRepetition() ? 'Draw by repetition' : 'Draw (50-move rule)';
  }
  saveResult(result);
  renderGamePanel(text, result);
  return true;
}

function saveResult(result) {
  if (G.resultSaved) return;
  G.resultSaved = true;
  state.update('play', (p) => {
    p.games.push({ color: G.color, level: G.level.n, result, ts: Date.now() });
    if (p.games.length > 200) p.games = p.games.slice(-150);
  });
}

function resign() {
  if (!G || G.over) return;
  G.over = true;
  saveResult('loss');
  renderGamePanel('You resigned.', 'loss');
}

async function hint() {
  if (!G || G.over || turnColor() !== G.color) return;
  try {
    const res = await engine.quickEval(G.chess.fen(), { movetime: 400 });
    if (res?.bestmove && G && !G.over) {
      board.shapes([{ orig: uciFrom(res.bestmove), dest: uciTo(res.bestmove), brush: 'green' }]);
    }
  } catch { toast('Engine busy…'); }
}

function takeback() {
  if (!G || G.thinking) return;
  const u1 = G.chess.undo();
  if (u1) G.sans.pop();
  if (u1 && turnColor() !== G.color) { const u2 = G.chess.undo(); if (u2) G.sans.pop(); }
  G.over = false;
  G.resultSaved = false;
  board.shapes([]);
  board.sync(G.chess, { movableColor: G.color });
  renderGamePanel();
  if (turnColor() !== G.color) engineTurn();
}

function renderGamePanel(endText, endResult) {
  clear(dom.panel);
  const statusCard = el('div', { class: 'card' });
  if (endText) {
    statusCard.append(el('div', {
      class: `result-banner ${endResult === 'win' ? 'good' : endResult === 'loss' ? 'bad' : ''}`,
      text: endText,
    }));
    statusCard.append(el('div', { class: 'btn-row mt' },
      btn('New game', () => { G = null; renderSetup(); }, 'primary'),
      btn('Analyze game', analyzeGame, ''),
      btn('Rematch', () => startGame({ fen: G.startFen === new Chess().fen() ? null : G.startFen, color: G.color, level: G.level.n }), 'ghost')));
  } else {
    statusCard.append(el('div', { class: 'status-line' },
      el('span', { class: `turn-dot ${turnColor()}` }),
      el('strong', { text: G.thinking ? 'Engine thinking…' : (turnColor() === G.color ? 'Your move' : '…') }),
      el('span', { class: 'muted small', text: `· Level ${G.level.n}` })));
    statusCard.append(el('div', { class: 'btn-row mt' },
      btn('Hint', hint, 'ghost'),
      btn('Take back', takeback, 'ghost'),
      btn('Flip', () => board.toggleOrientation(), 'ghost'),
      btn('Resign', resign, 'ghost danger-ghost')));
  }
  const ml = el('div', { class: 'movelist' });
  G.sans.forEach((san, i) => {
    if (i % 2 === 0) ml.append(el('span', { class: 'mvnum', text: `${i / 2 + 1}.` }));
    ml.append(el('span', { class: 'mv' + (i === G.sans.length - 1 ? ' current' : ''), text: san }));
  });
  if (!G.sans.length) ml.append(el('span', { class: 'faint', text: '—' }));
  dom.panel.append(statusCard, el('div', { class: 'card' }, el('h3', { text: 'Moves' }), ml));
}

function analyzeGame() {
  const ucis = [];
  const replay = new Chess(G.startFen);
  for (const san of G.sans) {
    const m = replay.move(san);
    ucis.push(m.from + m.to + (m.promotion || ''));
  }
  sessionStorage.setItem('analysis.load', JSON.stringify({ fen: G.startFen, moves: ucis }));
  location.hash = '#/analysis';
}

function btn(label, fn, cls = '') {
  const b = el('button', { class: `btn ${cls}`, text: label });
  b.addEventListener('click', fn);
  return b;
}

export function destroy() {
  engine.stopSearch();
  if (board) { board.destroy(); board = null; }
  G = null;
}
