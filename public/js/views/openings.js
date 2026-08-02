// Openings: repertoire trainer (guided learn + spaced-repetition review)
// and a full explorer over the Lichess openings database.
import { Chess } from '../../vendor/chess.js';
import { el, clear, toast, debounce, uciFrom, uciTo, opposite } from '../util.js';
import { Board, applyUci } from '../board.js';
import { loadOpenings } from '../data.js';
import * as state from '../state.js';
import { initEntry, applyReview, isDue, dueInDays, dueLines } from '../srs.js';
import { REPERTOIRES, findLine, allLines } from '../content/repertoires.js';

let board = null;
let timers = [];
let keyHandler = null;
function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

export async function render(container, { path, query }) {
  if (path[0] === 'rep' && path[1]) return renderRepertoire(container, path[1]);
  if (path[0] === 'train' && path[1]) return renderTrainer(container, path[1], query.get('mode') || 'review');
  if (path[0] === 'view' && path[1] != null) return renderExplorerViewer(container, Number(path[1]));
  return renderIndex(container, query.get('tab') || 'repertoires');
}

// ---------- index: repertoires + explorer ----------
function renderIndex(container, tab) {
  container.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Openings' }),
      el('div', { class: 'tabs' },
        tabBtn('repertoires', 'Repertoires', tab),
        tabBtn('explorer', 'Explorer', tab))));
  if (tab === 'explorer') renderExplorer(container);
  else renderRepList(container);
}

function tabBtn(t, label, active) {
  const b = el('button', { class: t === active ? 'active' : '', text: label });
  b.addEventListener('click', () => { location.hash = `#/openings?tab=${t}`; });
  return b;
}

function lineState(lineId) { return state.get().openings.lines[lineId]; }

function repProgress(rep) {
  let learned = 0, due = 0;
  for (const line of rep.lines) {
    const ls = lineState(line.id);
    if (ls) { learned++; if (isDue(ls)) due++; }
  }
  return { learned, due, total: rep.lines.length };
}

function renderRepList(container) {
  const s = state.get();
  const allIds = allLines().map((x) => x.line.id);
  const totalDue = dueLines(s.openings.lines, allIds).length;

  if (totalDue > 0) {
    const card = el('div', { class: 'card row between' },
      el('div', {},
        el('h3', { text: `${totalDue} line${totalDue > 1 ? 's' : ''} due for review` }),
        el('p', { class: 'muted small', text: 'Spaced repetition keeps your repertoire sharp.' })),
      el('button', { class: 'btn primary', text: 'Review now' }));
    card.querySelector('button').addEventListener('click', () => startNextDue());
    container.append(card);
  }

  const whiteReps = REPERTOIRES.filter((r) => r.color === 'white');
  const blackReps = REPERTOIRES.filter((r) => r.color === 'black');
  for (const [label, reps] of [['As White', whiteReps], ['As Black', blackReps]]) {
    container.append(el('h2', { class: 'mt', text: label }));
    const list = el('div', { class: 'list' });
    for (const rep of reps) {
      const prog = repProgress(rep);
      const item = el('a', { class: 'list-item', href: `#/openings/rep/${rep.id}` },
        el('span', { class: 'li-icon', text: rep.color === 'white' ? '♔' : '♚' }),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, rep.name, ' ',
            prog.due ? el('span', { class: 'badge', text: `${prog.due} due` }) : ''),
          el('div', { class: 'li-sub', text: `${rep.eco} · ${rep.level} · ${prog.learned}/${prog.total} lines learned` })),
        el('span', { class: 'faint', text: '›' }));
      list.append(item);
    }
    container.append(list);
  }
}

function startNextDue() {
  const s = state.get();
  const due = allLines().filter(({ line }) => isDue(s.openings.lines[line.id]));
  if (!due.length) { toast('Nothing due — well done!', 'good'); return; }
  location.hash = `#/openings/train/${due[0].line.id}?mode=review`;
}

// ---------- repertoire detail ----------
function renderRepertoire(container, repId) {
  const rep = REPERTOIRES.find((r) => r.id === repId);
  if (!rep) { location.hash = '#/openings'; return; }
  container.append(
    el('div', { class: 'page-head' },
      el('p', { class: 'small' }, el('a', { href: '#/openings', text: '← Openings' })),
      el('h1', { text: `${rep.name} ` }),
      el('p', { text: `${rep.color === 'white' ? 'For White' : 'For Black'} · ${rep.eco} · ${rep.level}` })),
    el('div', { class: 'card' },
      el('p', { text: rep.summary }),
      el('h3', { text: 'Key ideas' }),
      el('ul', { class: 'prose' }, rep.ideas.map((i) => el('li', { text: i })))));

  const list = el('div', { class: 'list mt' });
  for (const line of rep.lines) {
    const ls = lineState(line.id);
    let status, cls = 'gray';
    if (!ls) status = 'New';
    else if (isDue(ls)) { status = 'Due now'; cls = ''; }
    else { const d = dueInDays(ls); status = `Review in ${d}d`; cls = 'good'; }
    const item = el('div', { class: 'list-item' },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title', text: line.name }),
        el('div', { class: 'li-sub', text: `${Math.ceil(line.moves.length / 2)} moves · ${ls ? `reviewed ${ls.reps || 0}×` : 'not learned yet'}` })),
      el('span', { class: `badge ${cls}`, text: status }),
      el('button', { class: 'btn small', text: ls ? 'Review' : 'Learn' }));
    item.querySelector('button').addEventListener('click', () =>
      { location.hash = `#/openings/train/${line.id}?mode=${ls ? 'review' : 'learn'}`; });
    list.append(item);
  }
  container.append(el('h2', { class: 'mt', text: 'Lines' }), list);
}

// ---------- line trainer ----------
let T = null; // trainer state

function renderTrainer(container, lineId, mode) {
  const found = findLine(lineId);
  if (!found) { location.hash = '#/openings'; return; }
  const { rep, line } = found;
  T = {
    rep, line, mode,
    chess: new Chess(),
    idx: 0,            // next move index in line.moves
    fails: 0,          // fails on current move
    anyFail: false,
    finished: false,
    playerColor: rep.color,
  };

  const dom = {};
  container.append(
    el('div', { class: 'page-head' },
      el('p', { class: 'small' }, el('a', { href: `#/openings/rep/${rep.id}`, text: `← ${rep.name}` })),
      el('h1', { text: line.name }),
      el('p', { text: mode === 'learn' ? 'Learn mode — follow the annotations and play each of your moves.' : 'Review mode — play your repertoire moves from memory.' })),
    el('div', { class: 'board-layout' },
      el('div', { class: 'board-col' }, dom.board = el('div', { class: 'board-wrap' })),
      el('div', { class: 'side-panel' },
        dom.status = el('div', { class: 'card' }),
        dom.moves = el('div', { class: 'card' },
          el('h3', { text: 'Moves so far' }),
          dom.movelist = el('div', { class: 'movelist' })))));
  T.dom = dom;

  board = new Board(dom.board, {
    orientation: T.playerColor,
    onUserMove: trainerUserMove,
    showDests: state.get().settings.showDests,
  });
  board.sync(T.chess, { movableColor: null });
  advanceTrainer();
}

function trainerExpected() { return T.line.moves[T.idx]; }

function trainerTurnColor() { return T.chess.turn() === 'w' ? 'white' : 'black'; }

function advanceTrainer() {
  if (T.idx >= T.line.moves.length) return finishTrainer();
  const isPlayers = trainerTurnColor() === T.playerColor;
  if (isPlayers) {
    T.fails = 0;
    if (T.mode === 'learn') {
      // show the move to play with an arrow + comment
      const mv = sanToMove(T.chess, trainerExpected().san);
      board.shapes(mv ? [{ orig: mv.from, dest: mv.to, brush: 'green' }] : []);
      trainerStatus('your-move-guided');
    } else {
      board.shapes([]);
      trainerStatus('your-move');
    }
    board.sync(T.chess, { movableColor: T.playerColor });
  } else {
    board.sync(T.chess, { movableColor: null });
    trainerStatus('opp-thinking');
    later(() => {
      const step = trainerExpected();
      const mv = T.chess.move(step.san);
      T.idx++;
      board.sync(T.chess, { lastMove: [mv.from, mv.to], movableColor: null });
      trainerStatus('opp-played', step);
      later(advanceTrainer, T.mode === 'learn' && step.c ? 900 : 450);
    }, 500);
  }
}

function sanToMove(chess, san) {
  const c = new Chess(chess.fen());
  try { return c.move(san); } catch { return null; }
}

function trainerUserMove(from, to, promotion) {
  if (T.finished || trainerTurnColor() !== T.playerColor) return;
  const step = trainerExpected();
  const expected = sanToMove(T.chess, step.san);
  const played = (() => { try { return T.chess.move({ from, to, promotion: promotion || 'q' }); } catch { return null; } })();
  if (!played) { board.sync(T.chess, { movableColor: T.playerColor }); return; }
  if (expected && played.san === expected.san) {
    T.idx++;
    board.shapes([]);
    board.sync(T.chess, { lastMove: [from, to], movableColor: null });
    trainerStatus('correct', step);
    later(advanceTrainer, step.c && T.mode === 'learn' ? 900 : 350);
  } else {
    T.chess.undo();
    T.fails++;
    if (T.mode === 'review') T.anyFail = T.anyFail || T.fails >= 1;
    board.sync(T.chess, { movableColor: T.playerColor, animate: false });
    if (T.fails >= 2 && expected) {
      board.shapes([{ orig: expected.from, dest: expected.to, brush: 'green' }]);
      trainerStatus('shown', step);
    } else {
      trainerStatus('wrong');
    }
  }
}

function finishTrainer() {
  T.finished = true;
  board.shapes([]);
  const pass = T.mode === 'learn' ? true : !T.anyFail;
  const lineId = T.line.id;
  state.update('openings', (o) => {
    const cur = o.lines[lineId];
    o.lines[lineId] = !cur ? initEntry() : applyReview(cur, pass);
  });
  const entry = state.get().openings.lines[lineId];
  trainerStatus('done', null, { pass, days: entry.due != null ? dueInDays(entry) : null });
  renderTrainerMoves();
}

function trainerStatus(kind, step, extra = {}) {
  const d = T.dom.status;
  clear(d);
  const moveNo = Math.floor(T.idx / 2) + 1;
  if (kind === 'your-move' || kind === 'your-move-guided') {
    d.append(el('div', { class: 'status-line' },
      el('span', { class: `turn-dot ${T.playerColor}` }),
      el('strong', { text: 'Your move' })));
    const step2 = trainerExpected();
    if (kind === 'your-move-guided') {
      d.append(el('p', { class: 'mt' }, el('b', { text: `${moveNo}. ${step2.san}` }), step2.c ? ` — ${step2.c}` : ''));
      d.append(el('p', { class: 'muted small', text: 'Play the highlighted move on the board.' }));
    } else {
      d.append(el('p', { class: 'muted', text: 'What does your repertoire play here?' }));
    }
  } else if (kind === 'opp-thinking') {
    d.append(el('p', { class: 'muted', text: '…' }));
  } else if (kind === 'opp-played') {
    d.append(el('p', {}, el('b', { text: step.san }), step.c ? ` — ${step.c}` : ''));
  } else if (kind === 'correct') {
    d.append(el('p', { class: 'good', style: 'color:var(--good-strong)' }, '✓ ', el('b', { text: step.san }),
      step.c && T.mode === 'learn' ? ` — ${step.c}` : ''));
  } else if (kind === 'wrong') {
    d.append(el('p', { style: 'color:var(--bad)', text: 'Not the repertoire move — try again.' }));
  } else if (kind === 'shown') {
    d.append(el('p', {}, el('span', { style: 'color:var(--bad)', text: 'The line continues ' }),
      el('b', { text: step.san }), ' (highlighted).'));
  } else if (kind === 'done') {
    d.append(el('div', { class: `result-banner ${extra.pass ? 'good' : 'bad'}`,
      text: T.mode === 'learn' ? '✓ Line learned!' : (extra.pass ? '✓ Perfect recall!' : 'Line needs work') }));
    if (extra.days != null) d.append(el('p', { class: 'muted small mt', text: `Next review in ${extra.days} day${extra.days === 1 ? '' : 's'}.` }));
    const btns = el('div', { class: 'btn-row mt' });
    btns.append(btn('Replay line', () => renderReload(), ''));
    const s = state.get();
    const due = allLines().filter(({ line }) => line.id !== T.line.id && isDue(s.openings.lines[line.id]));
    if (due.length) btns.append(btn(`Next due (${due.length})`, () => { location.hash = `#/openings/train/${due[0].line.id}?mode=review`; }, 'primary'));
    else btns.append(btn('Back to repertoire', () => { location.hash = `#/openings/rep/${T.rep.id}`; }, 'primary'));
    btns.append(btn('Play vs engine from here', () => {
      sessionStorage.setItem('play.fen', T.chess.fen());
      sessionStorage.setItem('play.color', T.playerColor);
      location.hash = '#/play';
    }, 'ghost'));
    d.append(btns);
  }
  renderTrainerMoves();
}

function renderReload() {
  const hash = `#/openings/train/${T.line.id}?mode=${T.mode}`;
  if (location.hash === hash) { const c = document.getElementById('view'); clear(c); renderTrainer(c, T.line.id, T.mode); }
  else location.hash = hash;
}

function renderTrainerMoves() {
  const ml = T.dom.movelist;
  clear(ml);
  const hist = T.chess.history();
  hist.forEach((san, i) => {
    if (i % 2 === 0) ml.append(el('span', { class: 'mvnum', text: `${i / 2 + 1}.` }));
    ml.append(el('span', { class: 'mv' + (i === hist.length - 1 ? ' current' : ''), text: san }));
  });
  if (!hist.length) ml.append(el('span', { class: 'faint', text: '—' }));
}

// ---------- explorer ----------
async function renderExplorer(container) {
  const data = await loadOpenings();
  const wrap = el('div', {});
  const input = el('input', { type: 'search', placeholder: `Search ${data.entries.length.toLocaleString()} openings — try "Najdorf" or "C88"…` });
  const ecoRow = el('div', { class: 'chip-row mt' });
  const results = el('div', { class: 'list mt' });
  let ecoFilter = null;

  for (const letter of ['A', 'B', 'C', 'D', 'E']) {
    const chip = el('button', { class: 'chip', text: `ECO ${letter}` });
    chip.addEventListener('click', () => {
      ecoFilter = ecoFilter === letter ? null : letter;
      for (const c of ecoRow.children) c.classList.toggle('active', c.textContent === `ECO ${ecoFilter}`);
      update();
    });
    ecoRow.append(chip);
  }

  const update = () => {
    clear(results);
    const q = input.value.trim();
    let list;
    if (q) list = data.search(q);
    else if (ecoFilter) list = data.entries.filter((e) => e.eco[0] === ecoFilter);
    else list = famousDefaults(data);
    if (ecoFilter && q) list = list.filter((e) => e.eco[0] === ecoFilter);
    const capped = list.slice(0, 250);
    for (const e of capped) {
      const idx = data.entries.indexOf(e);
      results.append(el('a', { class: 'list-item', href: `#/openings/view/${idx}` },
        el('span', { class: 'badge gray', text: e.eco }),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title', text: e.name }),
          el('div', { class: 'li-sub', text: pgnPreview(e) })),
        el('span', { class: 'faint', text: '›' })));
    }
    if (!capped.length) results.append(el('p', { class: 'muted', text: 'No openings match.' }));
    else if (list.length > capped.length) results.append(el('p', { class: 'muted small center', text: `Showing 250 of ${list.length} — refine your search.` }));
  };
  input.addEventListener('input', debounce(update, 200));
  wrap.append(el('div', { class: 'card' }, input, ecoRow), results);
  container.append(wrap);
  update();
}

function famousDefaults(data) {
  const names = ['Italian Game', 'Ruy Lopez', 'Sicilian Defense', 'French Defense', 'Caro-Kann Defense',
    'Queen’s Gambit', 'Queen’s Gambit Declined', 'Queen’s Gambit Accepted', 'Slav Defense', 'London System',
    'King’s Indian Defense', 'King’s Gambit', 'English Opening', 'Scandinavian Defense', 'Scotch Game',
    'Vienna Game', 'Nimzo-Indian Defense', 'Grünfeld Defense', 'Dutch Defense', 'Alekhine Defense',
    'Pirc Defense', 'Catalan Opening', 'Réti Opening', 'Benoni Defense', 'Trompowsky Attack'];
  const out = [];
  for (const n of names) {
    const hit = data.entries.find((e) => e.name === n) || data.entries.find((e) => e.name.startsWith(n));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

function pgnPreview(e) {
  const parts = [];
  for (let i = 0; i < Math.min(e.san.length, 8); i++) {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(e.san[i]);
  }
  return parts.join(' ') + (e.san.length > 8 ? ' …' : '');
}

async function renderExplorerViewer(container, idx) {
  const data = await loadOpenings();
  const entry = data.entries[idx];
  if (!entry) { location.hash = '#/openings?tab=explorer'; return; }
  const chess = new Chess();
  let ply = 0;
  const sans = entry.san;

  const dom = {};
  container.append(
    el('div', { class: 'page-head' },
      el('p', { class: 'small' }, el('a', { href: '#/openings?tab=explorer', text: '← Explorer' })),
      el('h1', { text: entry.name }),
      el('p', { text: `ECO ${entry.eco}` })),
    el('div', { class: 'board-layout' },
      el('div', { class: 'board-col' }, dom.board = el('div', { class: 'board-wrap' })),
      el('div', { class: 'side-panel' },
        el('div', { class: 'card' },
          dom.movelist = el('div', { class: 'movelist' }),
          el('div', { class: 'btn-row mt' },
            btn('⏮', () => go(0), 'small'),
            btn('◀', () => go(ply - 1), 'small'),
            btn('▶', () => go(ply + 1), 'small'),
            btn('⏭', () => go(sans.length), 'small'),
            btn('Flip', () => board.toggleOrientation(), 'small ghost'))),
        el('div', { class: 'card' },
          el('h3', { text: 'Continue from here' }),
          el('div', { class: 'btn-row' },
            btn('Play vs engine', () => {
              sessionStorage.setItem('play.fen', chess.fen());
              location.hash = '#/play';
            }, 'primary'),
            btn('Analyze', () => {
              sessionStorage.setItem('analysis.load', JSON.stringify({ moves: entry.uci.slice(0, ply), fen: 'start' }));
              location.hash = '#/analysis';
            }, ''))))));

  board = new Board(dom.board, {});
  const go = (n) => {
    n = Math.max(0, Math.min(sans.length, n));
    while (ply > n) { chess.undo(); ply--; }
    while (ply < n) { chess.move(sans[ply]); ply++; }
    const last = ply > 0 ? entry.uci[ply - 1] : null;
    board.sync(chess, { lastMove: last ? [uciFrom(last), uciTo(last)] : undefined, movableColor: null });
    renderMoves();
  };
  const renderMoves = () => {
    clear(dom.movelist);
    sans.forEach((san, i) => {
      if (i % 2 === 0) dom.movelist.append(el('span', { class: 'mvnum', text: `${i / 2 + 1}.` }));
      const mv = el('span', { class: 'mv' + (i === ply - 1 ? ' current' : ''), text: san });
      mv.addEventListener('click', () => go(i + 1));
      dom.movelist.append(mv);
    });
  };
  keyHandler = (e) => {
    if (e.key === 'ArrowLeft') go(ply - 1);
    if (e.key === 'ArrowRight') go(ply + 1);
  };
  window.addEventListener('keydown', keyHandler);
  go(sans.length);
}

function btn(label, fn, cls = '') {
  const b = el('button', { class: `btn ${cls}`, text: label });
  b.addEventListener('click', fn);
  return b;
}

export function destroy() {
  clearTimers();
  if (keyHandler) { window.removeEventListener('keydown', keyHandler); keyHandler = null; }
  if (board) { board.destroy(); board = null; }
  T = null;
}
