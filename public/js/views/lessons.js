// Interactive lesson player: text + board demos + move challenges.
import { Chess } from '../../vendor/chess.js';
import { el, clear, uciFrom, uciTo } from '../util.js';
import { Board } from '../board.js';
import * as state from '../state.js';
import { TRACKS, LESSONS, lessonsByTrack, findLesson, nextLesson } from '../content/lessons.js';
import { THEMES } from '../content/themes.js';

let board = null;
let L = null;
let timers = [];
function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

export async function render(container, { path }) {
  if (path[0]) return renderLesson(container, path[0]);
  renderIndex(container);
}

function renderIndex(container) {
  const done = state.get().lessons.done;
  const doneCount = LESSONS.filter((l) => done[l.id]).length;
  container.append(el('div', { class: 'page-head' },
    el('h1', { text: 'Lessons' }),
    el('p', { text: `A guided course from first principles to master patterns · ${doneCount}/${LESSONS.length} complete` })));

  for (const track of TRACKS) {
    const lessons = lessonsByTrack(track.id);
    const tdone = lessons.filter((l) => done[l.id]).length;
    container.append(el('h2', { class: 'mt' }, `${track.icon} ${track.name} `,
      el('span', { class: 'badge gray', text: `${tdone}/${lessons.length}` })));
    container.append(el('p', { class: 'muted small', text: track.blurb }));
    const list = el('div', { class: 'list' });
    for (const lesson of lessons) {
      list.append(el('a', { class: 'list-item', href: `#/lessons/${lesson.id}` },
        el('span', { class: 'li-icon', text: done[lesson.id] ? '✅' : '📖' }),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title', text: lesson.title }),
          el('div', { class: 'li-sub', text: `~${lesson.minutes} min` })),
        el('span', { class: 'faint', text: '›' })));
    }
    container.append(list);
  }
}

function renderLesson(container, lessonId) {
  const lesson = findLesson(lessonId);
  if (!lesson) { location.hash = '#/lessons'; return; }
  L = {
    lesson,
    stepIdx: -1,
    chess: new Chess(),
    challengeIdx: 0,
    fails: 0,
    stepDone: false,
    busy: false,
  };
  const dom = {};
  L.dom = dom;

  container.append(
    el('div', { class: 'page-head' },
      el('p', { class: 'small' }, el('a', { href: '#/lessons', text: '← Lessons' })),
      el('h1', { text: lesson.title }),
      el('p', { text: lesson.intro })),
    el('div', { class: 'board-layout' },
      el('div', { class: 'board-col' }, dom.board = el('div', { class: 'board-wrap' })),
      el('div', { class: 'side-panel' },
        dom.panel = el('div', { class: 'card' }),
        dom.progressWrap = el('div', { class: 'card' },
          el('div', { class: 'row between small muted' },
            el('span', { text: 'Progress' }),
            dom.progressLabel = el('span')),
          el('div', { class: 'progress mt', style: 'margin-top:.5rem' }, dom.progressBar = el('div'))))));

  board = new Board(dom.board, {
    orientation: lesson.pov || 'white',
    onUserMove: challengeMove,
    showDests: state.get().settings.showDests,
  });
  nextStep();
}

function currentStep() { return L.lesson.steps[L.stepIdx]; }

function nextStep() {
  clearTimers();
  if (L.stepIdx + 1 >= L.lesson.steps.length) return finishLesson();
  L.stepIdx++;
  L.challengeIdx = 0;
  L.fails = 0;
  L.stepDone = false;
  const step = currentStep();
  if (step.fen) L.chess = new Chess(step.fen);
  if (step.pov) board.orient(step.pov);
  else if (L.stepIdx === 0) board.orient(L.lesson.pov || 'white');
  board.shapes([]);
  board.sync(L.chess, { movableColor: null, animate: L.stepIdx > 0 && !step.fen });
  if (step.shapes) board.shapes(step.shapes.map((s) => ({ ...s, brush: s.brush || 'green' })));
  renderPanel();
  if (step.moves && step.moves.length) {
    L.busy = true;
    playDemo([...step.moves]);
  } else if (step.challenge) {
    startChallenge();
  } else {
    L.stepDone = true;
    renderPanel();
  }
}

function playDemo(queue) {
  if (!queue.length) { L.busy = false; L.stepDone = !currentStep().challenge; if (currentStep().challenge) startChallenge(); renderPanel(); return; }
  later(() => {
    const san = queue.shift();
    const mv = L.chess.move(san);
    board.sync(L.chess, { lastMove: [mv.from, mv.to], movableColor: null });
    renderPanel(san);
    playDemo(queue);
  }, 750);
}

function startChallenge() {
  const turn = L.chess.turn() === 'w' ? 'white' : 'black';
  board.sync(L.chess, { movableColor: turn });
  renderPanel();
}

function expectedMove() {
  const step = currentStep();
  const c = new Chess(L.chess.fen());
  try { return c.move(step.challenge.line[L.challengeIdx]); } catch { return null; }
}

function challengeMove(from, to, promotion) {
  const step = currentStep();
  if (!step || !step.challenge || L.stepDone || L.busy) { board.sync(L.chess, { movableColor: null }); return; }
  const expected = expectedMove();
  const played = (() => { try { return L.chess.move({ from, to, promotion: promotion || 'q' }); } catch { return null; } })();
  if (!played) { startChallenge(); return; }
  const ok = expected && (played.san === expected.san || (L.chess.isCheckmate() && expected.san.includes('#')));
  if (ok) {
    board.shapes([]);
    board.sync(L.chess, { lastMove: [from, to], movableColor: null });
    L.challengeIdx++;
    const reply = step.challenge.replies && step.challenge.replies[L.challengeIdx - 1];
    if (L.challengeIdx >= step.challenge.line.length) {
      // play trailing reply if any (rare), then complete
      L.stepDone = true;
      renderPanel();
    } else if (reply) {
      L.busy = true;
      later(() => {
        const mv = L.chess.move(reply);
        board.sync(L.chess, { lastMove: [mv.from, mv.to], movableColor: null });
        L.busy = false;
        startChallenge();
      }, 550);
    } else {
      startChallenge();
    }
  } else {
    L.chess.undo();
    L.fails++;
    board.sync(L.chess, { movableColor: L.chess.turn() === 'w' ? 'white' : 'black', animate: false });
    if (L.fails >= 2 && expected) {
      board.shapes([{ orig: expected.from, dest: expected.to, brush: 'green' }]);
    }
    renderPanel(null, true);
  }
}

function finishLesson() {
  state.update('lessons', (l) => { l.done[L.lesson.id] = Date.now(); });
  const next = nextLesson(L.lesson.id);
  const dm = L.dom.panel;
  clear(dm);
  dm.append(
    el('div', { class: 'result-banner good', text: '✓ Lesson complete!' }));
  if (L.lesson.practice && THEMES[L.lesson.practice.theme]) {
    dm.append(el('p', { class: 'mt', text: 'Cement it with real positions:' }),
      el('a', { class: 'btn', href: `#/puzzles?mode=themes&theme=${L.lesson.practice.theme}`, text: `⚡ Practice: ${L.lesson.practice.label}` }));
  }
  const row = el('div', { class: 'btn-row mt' });
  if (next) row.append(el('a', { class: 'btn primary', href: `#/lessons/${next.id}`, text: `Next: ${next.title} →` }));
  row.append(el('a', { class: 'btn ghost', href: '#/lessons', text: 'All lessons' }));
  dm.append(row);
  updateProgress(1);
}

function renderPanel(lastSan, wrong = false) {
  if (L.stepIdx >= L.lesson.steps.length) return;
  const step = currentStep();
  const dm = L.dom.panel;
  clear(dm);
  dm.append(el('div', { class: 'prose', html: step.text }));
  if (step.moves && L.busy && lastSan) {
    dm.append(el('p', { class: 'muted small', text: `… ${lastSan}` }));
  }
  if (step.challenge && !L.stepDone) {
    const turn = L.chess.turn() === 'w' ? 'White' : 'Black';
    dm.append(el('p', { class: 'mt' },
      el('span', { class: `turn-dot ${turn.toLowerCase()}` }), ' ',
      el('strong', { text: ` Your move (${turn})` })));
    if (wrong) dm.append(el('p', { style: 'color:var(--bad)', text: 'Not quite — try again.' }));
    if (L.fails >= 1 && step.challenge.hint) dm.append(el('p', { class: 'muted', text: `💡 ${step.challenge.hint}` }));
  }
  if (L.stepDone) {
    if (step.challenge && step.challenge.success) {
      dm.append(el('p', { class: 'mt', style: 'color:var(--good-strong)', html: `✓ ${step.challenge.success}` }));
    }
    dm.append(el('div', { class: 'btn-row mt' },
      btn(L.stepIdx + 1 >= L.lesson.steps.length ? 'Finish ✓' : 'Continue →', nextStep, 'primary'),
      L.stepIdx > 0 ? btn('Back', prevStep, 'ghost') : null));
  } else if (!step.challenge && !step.moves) {
    L.stepDone = true;
  }
  updateProgress();
}

function prevStep() {
  L.stepIdx = Math.max(-1, L.stepIdx - 2);
  // replay from the nearest step with a fen
  let i = L.stepIdx + 1;
  while (i > 0 && !L.lesson.steps[i].fen) i--;
  const step = L.lesson.steps[i];
  L.chess = new Chess(step.fen);
  // fast-forward demo moves of intermediate steps without animation
  for (let j = i; j <= L.stepIdx; j++) {
    const s = L.lesson.steps[j];
    if (s.moves) for (const san of s.moves) L.chess.move(san);
    if (s.challenge) { for (let k = 0; k < s.challenge.line.length; k++) { L.chess.move(s.challenge.line[k]); const r = s.challenge.replies?.[k]; if (r) L.chess.move(r); } }
  }
  nextStep();
}

function updateProgress(done = 0) {
  const total = L.lesson.steps.length;
  const at = Math.min(L.stepIdx + (L.stepDone ? 1 : 0) + done, total);
  L.dom.progressLabel.textContent = `${Math.max(at, 0)}/${total}`;
  L.dom.progressBar.style.width = `${(Math.max(at, 0) / total) * 100}%`;
}

function btn(label, fn, cls = '') {
  const b = el('button', { class: `btn ${cls}`, text: label });
  b.addEventListener('click', fn);
  return b;
}

export function destroy() {
  clearTimers();
  if (board) { board.destroy(); board = null; }
  L = null;
}
