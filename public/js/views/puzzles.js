// Puzzle trainer: Rated mode (Elo tracked), Theme practice, and Streak runs.
// Uses the Lichess puzzle format: moves[0] is the opponent's move leading into
// the puzzle; the player must find every odd-indexed move.
import { Chess } from '../../vendor/chess.js';
import { el, clear, toast, fenTurn, opposite, eloUpdate, uciFrom, uciTo } from '../util.js';
import { Board, applyUci } from '../board.js';
import { pickPuzzle, puzzleManifest } from '../data.js';
import * as state from '../state.js';
import { THEMES, PICKER_THEMES } from '../content/themes.js';

let board = null;
let chess = null;
let puzzle = null;
let solIdx = 0;          // next expected move index in puzzle.moves
let playerColor = 'white';
let phase = 'idle';      // idle | solving | done
let failed = false;
let usedHelp = false;
let recorded = false;
let mode = 'rated';      // rated | themes | streak
let theme = null;
let streak = { n: 0, skips: 1, over: false };
let session = { solved: 0, tried: 0 };
let timers = [];
let keyHandler = null;

const $ = {};

function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

export async function render(container, { query }) {
  mode = query.get('mode') || 'rated';
  theme = query.get('theme');
  if (theme && !query.get('mode')) mode = 'themes';
  session = { solved: 0, tried: 0 };
  streak = { n: 0, skips: 1, over: false };

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Puzzles' }),
      el('div', { class: 'tabs', id: 'pz-tabs' },
        tabBtn('rated', 'Rated'),
        tabBtn('themes', 'By theme'),
        tabBtn('streak', 'Streak'))),
    el('div', { class: 'board-layout' },
      el('div', { class: 'board-col' }, $.boardWrap = el('div', { class: 'board-wrap' })),
      $.panel = el('div', { class: 'side-panel' })));

  board = new Board($.boardWrap, {
    onUserMove: handleUserMove,
    showDests: state.get().settings.showDests,
    animate: state.get().settings.animate,
  });

  keyHandler = (e) => {
    if (e.key === 'ArrowRight' && phase === 'done') { nextPuzzle(); }
    if ((e.key === 'h' || e.key === 'H') && phase === 'solving') { hint(); }
  };
  window.addEventListener('keydown', keyHandler);

  if (mode === 'themes' && !theme) renderThemePicker();
  else nextPuzzle();
}

function tabBtn(m, label) {
  const b = el('button', { class: mode === m ? 'active' : '', text: label });
  b.addEventListener('click', () => {
    location.hash = `#/puzzles?mode=${m}`;
  });
  return b;
}

async function renderThemePicker() {
  const man = await puzzleManifest();
  clear($.panel);
  $.panel.append(el('div', { class: 'card' },
    el('h3', { text: 'Pick a theme' }),
    el('p', { class: 'muted small', text: 'Practice a specific motif. Theme puzzles don’t change your rating.' }),
    el('div', { class: 'chip-row' },
      PICKER_THEMES.filter((t) => man.themes[t]).map((t) => {
        const chip = el('button', { class: 'chip', text: THEMES[t]?.name || t, title: THEMES[t]?.desc || '' });
        chip.addEventListener('click', () => { location.hash = `#/puzzles?mode=themes&theme=${t}`; });
        return chip;
      }))));
  board.setFen('8/8/8/8/8/8/8/8 w - - 0 1');
}

async function nextPuzzle() {
  clearTimers();
  phase = 'idle';
  failed = false;
  usedHelp = false;
  recorded = false;
  const s = state.get();
  let target = s.puzzles.rating;
  let spread = 150;
  let th = null;
  if (mode === 'themes') { th = theme; spread = 300; }
  if (mode === 'streak') {
    if (streak.over) { streak = { n: 0, skips: 1, over: false }; }
    target = 600 + streak.n * 170;
    spread = 120;
  }
  renderPanel('loading');
  const attempted = s.puzzles.attempted;
  const cutoff = Date.now() - 30 * 86400000;
  puzzle = await pickPuzzle({
    target, spread, theme: th,
    exclude: (id) => (attempted[id] || 0) > cutoff,
  });
  if (!puzzle) {
    renderPanel('empty');
    return;
  }
  chess = new Chess(puzzle.fen);
  playerColor = opposite(fenTurn(puzzle.fen));
  solIdx = 0;
  board.orient(playerColor);
  board.setFen(puzzle.fen);
  renderPanel('setup');
  later(() => {
    playForcedMove(puzzle.moves[0]);
    solIdx = 1;
    phase = 'solving';
    syncBoard();
    renderPanel('solving');
  }, 550);
}

function playForcedMove(uci) {
  applyUci(chess, uci);
  board.chess = chess;
  board.sync(chess, { lastMove: [uciFrom(uci), uciTo(uci)], movableColor: playerColor });
}

function syncBoard(lastUci) {
  board.sync(chess, {
    lastMove: lastUci ? [uciFrom(lastUci), uciTo(lastUci)] : undefined,
    movableColor: phase === 'solving' ? playerColor : undefined,
  });
}

function handleUserMove(from, to, promotion) {
  if (phase !== 'solving') return;
  const move = (() => { try { return chess.move({ from, to, promotion: promotion || 'q' }); } catch { return null; } })();
  if (!move) { syncBoard(); return; }
  const uci = from + to + (promotion || '');
  const expected = puzzle.moves[solIdx];
  const isMate = chess.isCheckmate();
  if (uci === expected || isMate) {
    solIdx++;
    board.shapes([]);
    if (solIdx >= puzzle.moves.length || isMate) return solved();
    syncBoard(uci);
    // opponent reply
    phase = 'waiting';
    later(() => {
      const reply = puzzle.moves[solIdx];
      solIdx++;
      applyUci(chess, reply);
      phase = 'solving';
      board.sync(chess, { lastMove: [uciFrom(reply), uciTo(reply)], movableColor: playerColor });
      renderPanel('solving', { progressed: true });
    }, 320);
  } else {
    // wrong: flash, undo, keep solving (already counted as failed)
    const wasFirst = !failed && !usedHelp;
    failed = true;
    board.sync(chess, { lastMove: [from, to], movableColor: undefined });
    board.shapes([{ orig: to, brush: 'red' }]);
    if (wasFirst) recordResult(false);
    later(() => {
      chess.undo();
      board.shapes([]);
      syncBoard();
      if (mode === 'streak') { streakOver(); }
      else renderPanel('wrong');
    }, 600);
  }
}

function solved() {
  phase = 'done';
  const win = !failed && !usedHelp;
  board.sync(chess, { lastMove: undefined, movableColor: undefined });
  recordResult(win);
  if (mode === 'streak') {
    if (win) { streak.n++; renderPanel('streak-solved'); }
    else streakOver();
  } else {
    renderPanel(win ? 'solved' : 'solved-late');
  }
}

function recordResult(win) {
  if (recorded) return;
  recorded = true;
  const s = state.get();
  if (mode === 'rated') {
    const before = s.puzzles.rating;
    const after = eloUpdate(before, puzzle.rating, win);
    state.update('puzzles', (p) => {
      p.rating = after;
      p.history.push({ id: puzzle.id, pr: puzzle.rating, r: after, win, ts: Date.now() });
      if (p.history.length > 600) p.history = p.history.slice(-500);
    });
    puzzle.delta = after - before;
  }
  state.recordPuzzleResult({
    id: puzzle.id, puzzleRating: puzzle.rating, win,
    themes: puzzle.themes.filter((t) => THEMES[t]), rated: mode === 'rated', usedHelp,
  });
  session.tried++;
  if (win) session.solved++;
}

function streakOver() {
  streak.over = true;
  phase = 'done';
  const best = Math.max(state.get().puzzles.streakBest, streak.n);
  state.update('puzzles', (p) => { p.streakBest = best; });
  renderPanel('streak-over');
}

function hint() {
  if (phase !== 'solving') return;
  usedHelp = true;
  if (!recorded) recordResult(false);
  const expected = puzzle.moves[solIdx];
  board.shapes([{ orig: uciFrom(expected), brush: 'green' }]);
  renderPanel('hinted');
}

function showSolution() {
  if (phase === 'done') return;
  usedHelp = true;
  if (!recorded) recordResult(false);
  phase = 'replay';
  const remaining = puzzle.moves.slice(solIdx);
  board.shapes([]);
  let i = 0;
  const step = () => {
    if (i >= remaining.length) { phase = 'done'; renderPanel('solved-late'); return; }
    const uci = remaining[i++];
    applyUci(chess, uci);
    board.sync(chess, { lastMove: [uciFrom(uci), uciTo(uci)], movableColor: undefined });
    later(step, 650);
  };
  step();
}

function skipStreak() {
  if (streak.skips <= 0) return;
  streak.skips--;
  toast('Skipped — no more skips this run');
  nextPuzzle();
}

// ---------- panel rendering ----------
function renderPanel(kind, extra = {}) {
  const s = state.get();
  clear($.panel);
  const items = [];

  if (mode === 'streak') {
    items.push(el('div', { class: 'card center' },
      el('div', { class: 'label muted small', text: 'CURRENT STREAK' }),
      el('div', { class: 'big-number', text: String(streak.n) }),
      el('div', { class: 'muted small', text: `Best: ${Math.max(s.puzzles.streakBest, streak.n)}` })));
  }

  const statusCard = el('div', { class: 'card' });
  items.push(statusCard);

  if (kind === 'loading') {
    statusCard.append(el('p', { class: 'muted', text: 'Finding a puzzle…' }));
  } else if (kind === 'empty') {
    statusCard.append(
      el('h3', { text: 'No puzzles found' }),
      el('p', { class: 'muted', text: 'You’ve seen everything matching this filter recently. Try another theme.' }));
  } else if (kind === 'setup' || kind === 'solving' || kind === 'hinted' || kind === 'wrong') {
    const turnRow = el('div', { class: 'status-line' },
      el('span', { class: `turn-dot ${playerColor}` }),
      el('strong', { text: `Your move — ${playerColor === 'white' ? 'White' : 'Black'}` }));
    statusCard.append(turnRow);
    if (kind === 'wrong') statusCard.append(el('p', { class: 'muted', html: 'Not the best move — <b>keep trying</b>, or view the solution.' }));
    else if (kind === 'hinted') statusCard.append(el('p', { class: 'muted', text: 'The highlighted piece makes the best move.' }));
    else if (extra.progressed) statusCard.append(el('p', { class: 'muted', text: 'Correct! Keep going…' }));
    else statusCard.append(el('p', { class: 'muted', text: mode === 'rated' ? 'Find the best continuation.' : (theme && THEMES[theme] ? THEMES[theme].desc : 'Find the best continuation.') }));
    const btns = el('div', { class: 'btn-row' },
      btn('Hint', hint, 'ghost', phase !== 'solving'),
      btn('Solution', showSolution, 'ghost'),
      mode === 'streak'
        ? btn(`Skip (${streak.skips})`, skipStreak, '', streak.skips <= 0)
        : btn('New puzzle', nextPuzzle, ''));
    statusCard.append(btns);
  } else if (kind === 'solved' || kind === 'solved-late') {
    const win = kind === 'solved';
    statusCard.append(
      el('div', { class: `result-banner ${win ? 'good' : ''}`, text: win ? '✓ Solved!' : 'Solution shown' }));
    if (mode === 'rated' && puzzle.delta != null) {
      statusCard.append(el('p', { class: 'mt' },
        el('strong', { text: `Rating: ${s.puzzles.rating} ` }),
        el('span', { class: puzzle.delta >= 0 ? 'small' : 'small muted', text: `(${puzzle.delta >= 0 ? '+' : ''}${puzzle.delta})` })));
    }
    statusCard.append(puzzleMeta());
    statusCard.append(el('div', { class: 'btn-row mt' },
      btn('Next puzzle →', nextPuzzle, 'primary'),
      btn('Analyze', openAnalysis, 'ghost')));
  } else if (kind === 'streak-solved') {
    statusCard.append(el('div', { class: 'result-banner good', text: `✓ Streak: ${streak.n}` }));
    statusCard.append(el('div', { class: 'btn-row mt' }, btn('Next →', nextPuzzle, 'primary')));
    later(nextPuzzle, 900);
  } else if (kind === 'streak-over') {
    statusCard.append(
      el('div', { class: 'result-banner bad', text: `Run over — streak of ${streak.n}` }),
      el('p', { class: 'muted mt', text: `Best ever: ${Math.max(s.puzzles.streakBest, streak.n)}` }),
      puzzleMeta(),
      el('div', { class: 'btn-row mt' },
        btn('New run', () => { streak = { n: 0, skips: 1, over: false }; nextPuzzle(); }, 'primary'),
        btn('Analyze', openAnalysis, 'ghost')));
  }

  if (mode === 'rated') {
    items.push(el('div', { class: 'tile-grid' },
      tile('Rating', String(s.puzzles.rating)),
      tile('Session', `${session.solved}/${session.tried}`)));
  }
  if (mode === 'themes') {
    const chipRow = el('div', { class: 'row wrap' });
    if (theme) {
      chipRow.append(el('span', { class: 'chip active', text: THEMES[theme]?.name || theme }));
      chipRow.append(btn('Change theme', () => { location.hash = '#/puzzles?mode=themes'; }, 'small ghost'));
    }
    items.push(el('div', { class: 'card' }, el('h3', { text: 'Theme practice' }), chipRow));
  }

  $.panel.append(...items);
}

function puzzleMeta() {
  if (!puzzle) return el('span');
  return el('div', { class: 'mt' },
    el('p', { class: 'small muted', text: `Puzzle ${puzzle.id} · rated ${puzzle.rating}` }),
    el('div', { class: 'chip-row' },
      puzzle.themes.filter((t) => THEMES[t]).slice(0, 6).map((t) =>
        el('span', { class: 'chip', text: THEMES[t].name, title: THEMES[t].desc }))));
}

function openAnalysis() {
  if (!puzzle) return;
  sessionStorage.setItem('analysis.load', JSON.stringify({ fen: puzzle.fen, moves: puzzle.moves }));
  location.hash = '#/analysis';
}

function btn(label, fn, cls = '', disabled = false) {
  const b = el('button', { class: `btn ${cls}`, text: label });
  if (disabled) b.disabled = true;
  b.addEventListener('click', fn);
  return b;
}

function tile(label, value) {
  return el('div', { class: 'stat-tile' },
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }));
}

export function destroy() {
  clearTimers();
  window.removeEventListener('keydown', keyHandler);
  if (board) { board.destroy(); board = null; }
  puzzle = null;
  phase = 'idle';
}
