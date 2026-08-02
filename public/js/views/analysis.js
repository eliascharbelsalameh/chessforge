// Analysis board: free play, engine evaluation (MultiPV), PGN/FEN import,
// eval bar, opening detection.
import { Chess } from '../../vendor/chess.js';
import { el, clear, toast, modal, uciFrom, uciTo, cpToWinPct, scoreText } from '../util.js';
import { Board, applyUci } from '../board.js';
import { engine } from '../engine.js';
import { loadOpenings } from '../data.js';
import * as state from '../state.js';

let board = null;
let A = null;
let dom = {};
let keyHandler = null;
let searchToken = 0;

export async function render(container) {
  dom = {};
  A = {
    startFen: new Chess().fen(),
    sans: [],       // mainline
    ucis: [],
    ply: 0,         // current position = startFen + sans[0..ply)
    engineOn: false,
    lines: [],
    openings: null,
  };

  container.append(
    el('div', { class: 'page-head' }, el('h1', { text: 'Analysis' })),
    el('div', { class: 'board-layout' },
      el('div', { class: 'board-col' },
        dom.evalBar = el('div', { class: 'eval-bar' },
          dom.evalFill = el('div', { class: 'white-fill', style: 'height:50%' })),
        dom.board = el('div', { class: 'board-wrap' })),
      el('div', { class: 'side-panel' },
        el('div', { class: 'card' },
          el('div', { class: 'row between' },
            el('h3', { text: 'Engine', style: 'margin:0' }),
            dom.engineToggle = el('button', { class: 'btn small', text: 'Off' })),
          dom.engineOut = el('div', { class: 'mt' }),
          dom.openingName = el('p', { class: 'muted small', style: 'margin:0.4rem 0 0' })),
        el('div', { class: 'card' },
          dom.movelist = el('div', { class: 'movelist' }),
          el('div', { class: 'btn-row mt' },
            btn('⏮', () => go(0), 'small'), btn('◀', () => go(A.ply - 1), 'small'),
            btn('▶', () => go(A.ply + 1), 'small'), btn('⏭', () => go(A.sans.length), 'small'),
            btn('Flip', () => board.toggleOrientation(), 'small ghost'))),
        el('div', { class: 'card' },
          el('div', { class: 'btn-row' },
            btn('Import', importDialog, ''),
            btn('Copy FEN', copyFen, 'ghost'),
            btn('Copy PGN', copyPgn, 'ghost'),
            btn('Reset', resetBoard, 'ghost'),
            btn('▶ Play from here', playFromHere, 'ghost'))))));

  board = new Board(dom.board, {
    onUserMove: userMove,
    showDests: state.get().settings.showDests,
    animate: state.get().settings.animate,
  });

  dom.engineToggle.addEventListener('click', toggleEngine);
  keyHandler = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(A.ply - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(A.ply + 1); }
  };
  window.addEventListener('keydown', keyHandler);

  loadOpenings().then((o) => { A.openings = o; updateOpening(); }).catch(() => {});

  const preset = sessionStorage.getItem('analysis.load');
  sessionStorage.removeItem('analysis.load');
  if (preset) {
    try {
      const { fen, moves } = JSON.parse(preset);
      A.startFen = !fen || fen === 'start' ? new Chess().fen() : fen;
      const c = new Chess(A.startFen);
      for (const u of moves || []) {
        const mv = applyUci(c, u);
        if (!mv) break;
        A.sans.push(mv.san);
        A.ucis.push(u);
      }
    } catch { /* ignore bad payload */ }
  }
  go(0, false);
}

function position(ply = A.ply) {
  const c = new Chess(A.startFen);
  for (let i = 0; i < ply; i++) c.move(A.sans[i]);
  return c;
}

function go(ply, animate = true) {
  A.ply = Math.max(0, Math.min(A.sans.length, ply));
  const c = position();
  const lastUci = A.ply > 0 ? A.ucis[A.ply - 1] : null;
  board.sync(c, {
    lastMove: lastUci ? [uciFrom(lastUci), uciTo(lastUci)] : undefined,
    movableColor: 'both',
    animate,
  });
  renderMoves();
  updateOpening();
  analyzeCurrent();
}

function userMove(from, to, promotion) {
  const c = position();
  const mv = (() => { try { return c.move({ from, to, promotion: promotion || 'q' }); } catch { return null; } })();
  if (!mv) { go(A.ply, false); return; }
  // truncate mainline at current ply, then append
  A.sans = A.sans.slice(0, A.ply);
  A.ucis = A.ucis.slice(0, A.ply);
  A.sans.push(mv.san);
  A.ucis.push(from + to + (mv.promotion || ''));
  A.ply++;
  board.sync(c, { lastMove: [from, to], movableColor: 'both' });
  renderMoves();
  updateOpening();
  analyzeCurrent();
}

function renderMoves() {
  const ml = dom.movelist;
  clear(ml);
  if (!A.sans.length) { ml.append(el('span', { class: 'faint', text: 'Play moves, or import a game / position.' })); return; }
  A.sans.forEach((san, i) => {
    if (i % 2 === 0) ml.append(el('span', { class: 'mvnum', text: `${i / 2 + 1}.` }));
    const mv = el('span', { class: 'mv' + (i === A.ply - 1 ? ' current' : ''), text: san });
    mv.addEventListener('click', () => go(i + 1));
    ml.append(mv);
  });
}

function updateOpening() {
  if (!A.openings || A.startFen !== new Chess().fen()) { dom.openingName.textContent = ''; return; }
  const hit = A.openings.detect(A.ucis.slice(0, A.ply));
  dom.openingName.textContent = hit ? `${hit.eco} · ${hit.name}` : '';
}

// ---------- engine ----------
function toggleEngine() {
  A.engineOn = !A.engineOn;
  dom.engineToggle.textContent = A.engineOn ? 'On' : 'Off';
  dom.engineToggle.classList.toggle('primary', A.engineOn);
  if (A.engineOn) analyzeCurrent();
  else { engine.stopSearch(); clear(dom.engineOut); setEvalBar(null); }
}

async function analyzeCurrent() {
  if (!A.engineOn) return;
  const c = position();
  const fen = c.fen();
  const token = ++searchToken;
  engine.stopSearch();
  if (c.isGameOver()) {
    clear(dom.engineOut).append(el('p', { class: 'muted small', text: c.isCheckmate() ? 'Checkmate.' : 'Game over — draw.' }));
    setEvalBar(c.isCheckmate() ? { mate: c.turn() === 'w' ? -1 : 1 } : { cp: 0 });
    return;
  }
  try {
    await engine.search({
      fen,
      movetime: 1500,
      multipv: 3,
      onInfo: (lines) => {
        if (token !== searchToken || !A.engineOn) return;
        renderLines(fen, lines);
      },
    });
  } catch { /* superseded or engine restart */ }
}

function renderLines(fen, lines) {
  const stmWhite = fen.split(' ')[1] === 'w';
  clear(dom.engineOut);
  const top = lines[0];
  if (top) {
    const s = { ...top.score };
    if (!stmWhite) { if (s.cp != null) s.cp = -s.cp; if (s.mate != null) s.mate = -s.mate; }
    setEvalBar(s);
    dom.depthLabel = el('p', { class: 'muted small', text: `depth ${top.depth}` });
  }
  for (const line of lines) {
    const s = { ...line.score };
    if (!stmWhite) { if (s.cp != null) s.cp = -s.cp; if (s.mate != null) s.mate = -s.mate; }
    const sanLine = pvToSan(fen, line.pvUci.slice(0, 8));
    const div = el('div', { class: 'engine-line' },
      el('span', { class: `score ${(s.mate != null ? s.mate > 0 : s.cp >= 0) ? 'white-adv' : 'black-adv'}`, text: scoreText(s, true) }),
      el('span', { class: 'pv', text: sanLine }));
    div.addEventListener('click', () => {
      const first = line.pvUci[0];
      if (first) userMove(uciFrom(first), uciTo(first), first.slice(4) || undefined);
    });
    dom.engineOut.append(div);
  }
  if (top) dom.engineOut.append(el('p', { class: 'faint small', style: 'margin:0.3rem 0 0', text: `depth ${top.depth} · Stockfish 18 lite (in your browser)` }));
}

function pvToSan(fen, ucis) {
  const c = new Chess(fen);
  const parts = [];
  for (const u of ucis) {
    const mv = applyUci(c, u);
    if (!mv) break;
    parts.push(mv.san);
  }
  return parts.join(' ');
}

function setEvalBar(score) {
  if (!score) { dom.evalFill.style.height = '50%'; return; }
  let pct;
  if (score.mate != null) pct = score.mate > 0 ? 100 : 0;
  else pct = cpToWinPct(score.cp);
  dom.evalFill.style.height = `${pct}%`;
}

// ---------- import/export ----------
function importDialog() {
  const ta = el('textarea', { placeholder: 'Paste a FEN or a PGN…' });
  const err = el('p', { class: 'small', style: 'color:var(--bad)' });
  const m = modal(el('div', {},
    el('h3', { text: 'Import position or game' }),
    ta, err,
    el('div', { class: 'btn-row mt' },
      btn('Load', () => {
        const text = ta.value.trim();
        if (!text) return;
        if (tryImport(text)) m.close();
        else err.textContent = 'Could not parse that as FEN or PGN.';
      }, 'primary'),
      btn('Cancel', () => m.close(), 'ghost'))));
}

function tryImport(text) {
  // FEN?
  try {
    const c = new Chess(text);
    A.startFen = c.fen();
    A.sans = []; A.ucis = [];
    go(0, false);
    return true;
  } catch { /* not a FEN */ }
  // PGN?
  try {
    const c = new Chess();
    c.loadPgn(text);
    const verbose = c.history({ verbose: true });
    A.startFen = new Chess().fen();
    A.sans = verbose.map((m) => m.san);
    A.ucis = verbose.map((m) => m.from + m.to + (m.promotion || ''));
    go(A.sans.length, false);
    return true;
  } catch { return false; }
}

function copyFen() {
  navigator.clipboard?.writeText(position().fen()).then(() => toast('FEN copied', 'good'), () => toast('Copy failed', 'bad'));
}

function copyPgn() {
  const c = position(A.sans.length);
  navigator.clipboard?.writeText(c.pgn()).then(() => toast('PGN copied', 'good'), () => toast('Copy failed', 'bad'));
}

function resetBoard() {
  A.startFen = new Chess().fen();
  A.sans = []; A.ucis = [];
  go(0, false);
}

function playFromHere() {
  sessionStorage.setItem('play.fen', position().fen());
  location.hash = '#/play';
}

function btn(label, fn, cls = '') {
  const b = el('button', { class: `btn ${cls}`, text: label });
  b.addEventListener('click', fn);
  return b;
}

export function destroy() {
  searchToken++;
  engine.stopSearch();
  window.removeEventListener('keydown', keyHandler);
  if (board) { board.destroy(); board = null; }
  A = null;
}
