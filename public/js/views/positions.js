// Positions: a drag-and-drop board editor for rebuilding positions out of
// books, plus a saved library you can play out against the engine or analyse.
import { el, clear, toast, modal, timeAgo } from '../util.js';
import { PositionEditor } from '../editor.js';
import { LEVELS } from '../engine.js';
import * as state from '../state.js';
import {
  START_FEN, EMPTY_FEN, FILES, ROLES, CASTLE_FLAGS,
  placementOf, piecesFromPlacement, buildFen, parseCastling, castlingAvailable,
  validate, describe,
} from '../setup.js';

let ed = null;
let P = null;
let dom = {};

const SPARE_ORDER = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];

export async function render(container) {
  dom = {};
  P = {
    placement: placementOf(START_FEN),
    turn: 'w',
    rights: { K: true, Q: true, k: true, q: true },
    ep: '-',
    halfmove: 0,
    fullmove: 1,
    tool: null,
    editingId: null,
    loading: false,
    result: null,
  };

  container.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Positions' }),
      el('p', { text: 'Rebuild a position from a book or a video — drag the pieces on, then play it out against the engine or open it in analysis.' })),
    el('div', { class: 'board-layout' },
      el('div', { class: 'board-col editor-col' },
        dom.spareBlack = spareBar('black'),
        dom.board = el('div', { class: 'board-wrap' }),
        dom.spareWhite = spareBar('white'),
        el('p', { class: 'small faint editor-hint' },
          'Drag pieces on, and drag a piece off the board to remove it. On a touch screen, tap a piece from the tray, then tap squares.')),
      el('div', { class: 'side-panel' },
        setupCard(),
        trainCard())),
    el('h2', { class: 'mt' }, '📚 My positions'),
    dom.library = el('div', {}));

  ed = new PositionEditor(dom.board, { onChange: boardChanged });
  ed.setPlacement(START_FEN);

  const preset = sessionStorage.getItem('positions.fen');
  sessionStorage.removeItem('positions.fen');
  if (preset) loadFen(preset, { quiet: true });

  renderLibrary();
  refresh();
}

// ---------- piece tray ----------

function spareBar(color) {
  const bar = el('div', { class: 'spare-bar cg-wrap' });
  for (const role of SPARE_ORDER) bar.append(spare(color, role));
  if (color === 'white') {
    const eraser = el('button', { class: 'spare-tool', title: 'Eraser — tap squares to clear them', text: '⌫' });
    eraser.addEventListener('click', () => selectTool(P.tool === 'erase' ? null : 'erase'));
    eraser.dataset.tool = 'erase';
    bar.append(eraser);
  }
  return bar;
}

function spare(color, role) {
  const piece = { role, color };
  const node = el('piece', { class: `${color} ${role}`, role: 'button', 'aria-label': `${color} ${role}`, title: `${color} ${role}` });
  node.dataset.tool = `${color}-${role}`;
  let origin = null;
  const start = (ev) => {
    if (ev.type === 'mousedown' && ev.button !== 0) return;
    ev.preventDefault();
    const pt = ev.touches ? ev.touches[0] : ev;
    origin = { x: pt.clientX, y: pt.clientY };
    ed.dragSpare(piece, ev);
  };
  // Released over the tray rather than the board = a tap: arm tap-to-place.
  const end = (ev) => {
    if (!origin) return;
    const pt = ev.changedTouches ? ev.changedTouches[0] : ev;
    const near = Math.abs(pt.clientX - origin.x) < 12 && Math.abs(pt.clientY - origin.y) < 12;
    origin = null;
    if (near) selectTool(sameTool(P.tool, piece) ? null : piece);
  };
  node.addEventListener('mousedown', start);
  node.addEventListener('mouseup', end);
  node.addEventListener('touchstart', start, { passive: false });
  node.addEventListener('touchend', end);
  return node;
}

const sameTool = (a, b) => !!a && a !== 'erase' && a.role === b.role && a.color === b.color;

function selectTool(tool) {
  P.tool = tool;
  ed.setTool(tool);
  const key = tool === 'erase' ? 'erase' : tool ? `${tool.color}-${tool.role}` : '';
  for (const node of document.querySelectorAll('.spare-bar [data-tool]')) {
    node.classList.toggle('selected', node.dataset.tool === key);
  }
}

// ---------- side panel ----------

function setupCard() {
  const card = el('div', { class: 'card' });
  dom.turnChips = {};
  dom.castleChips = {};

  const turnRow = el('div', { class: 'chip-row' });
  for (const [value, label] of [['w', 'White to move'], ['b', 'Black to move']]) {
    const chip = el('button', { class: 'chip', text: label });
    chip.addEventListener('click', () => { P.turn = value; P.ep = '-'; refresh(); });
    dom.turnChips[value] = chip;
    turnRow.append(chip);
  }

  const castleRow = el('div', { class: 'chip-row' });
  for (const [flag, label] of [['K', 'White O-O'], ['Q', 'White O-O-O'], ['k', 'Black O-O'], ['q', 'Black O-O-O']]) {
    const chip = el('button', { class: 'chip', text: label });
    chip.addEventListener('click', () => { P.rights[flag] = !P.rights[flag]; refresh(); });
    dom.castleChips[flag] = chip;
    castleRow.append(chip);
  }

  dom.fenInput = el('input', { type: 'text', spellcheck: 'false', placeholder: 'Paste a FEN from your book…' });
  dom.fenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFen(dom.fenInput.value); });

  card.append(
    el('h3', { text: 'Set up the position' }),
    el('div', { class: 'btn-row' },
      btn('Start position', () => loadFen(START_FEN), 'ghost'),
      btn('Clear board', () => loadFen(EMPTY_FEN, { quiet: true }), 'ghost'),
      btn('Flip', () => ed.toggleOrientation(), 'ghost')),
    el('div', { class: 'setup-row' }, el('span', { class: 'lbl', text: 'Turn' }), turnRow),
    el('div', { class: 'setup-row' }, el('span', { class: 'lbl', text: 'Castling' }), castleRow),
    el('div', { class: 'setup-row stack' },
      el('span', { class: 'lbl', text: 'FEN' }),
      dom.fenInput,
      el('div', { class: 'btn-row' },
        btn('Load FEN', () => loadFen(dom.fenInput.value), 'small'),
        btn('Copy', copyFen, 'small ghost'))),
    dom.status = el('div', { class: 'setup-status' }));
  return card;
}

function trainCard() {
  const card = el('div', { class: 'card' });
  dom.sideSel = el('select', {},
    el('option', { value: 'auto', text: 'Whoever is to move' }),
    el('option', { value: 'white', text: 'White' }),
    el('option', { value: 'black', text: 'Black' }));
  dom.levelSel = el('select', {}, LEVELS.map((l) => el('option', { value: String(l.n), text: `Level ${l.n} — ${l.label}` })));
  dom.levelSel.value = String(state.get().play.lastLevel || 4);

  dom.playBtn = btn('▶ Play from here', () => playFromHere(), 'primary');
  dom.analyseBtn = btn('🔍 Analyse', () => analyse(), '');
  dom.saveBtn = btn('💾 Save to library', saveDialog, 'ghost');

  card.append(
    el('h3', { text: 'Put it into practice' }),
    el('p', { class: 'muted small' }, 'Play the position out against Stockfish to test what the book taught you — every game from a saved position is scored below.'),
    el('label', { class: 'field' }, el('span', { text: 'You play' }), dom.sideSel),
    el('label', { class: 'field' }, el('span', { text: 'Engine strength' }), dom.levelSel),
    el('div', { class: 'btn-row' }, dom.playBtn, dom.analyseBtn, dom.saveBtn));
  return card;
}

function btn(label, fn, cls = '') {
  const b = el('button', { class: `btn ${cls}`, text: label });
  b.addEventListener('click', fn);
  return b;
}

// ---------- position plumbing ----------

function boardChanged(placement) {
  P.placement = placement;
  if (!P.loading) { P.ep = '-'; P.halfmove = 0; }
  refresh();
}

function currentFen() {
  return buildFen({
    placement: P.placement,
    turn: P.turn,
    rights: P.rights,
    ep: P.ep,
    halfmove: P.halfmove,
    fullmove: P.fullmove,
  });
}

function refresh() {
  const fen = currentFen();
  const res = validate(fen);
  P.result = res;

  for (const [value, chip] of Object.entries(dom.turnChips)) chip.classList.toggle('active', P.turn === value);
  const avail = castlingAvailable(P.placement);
  for (const flag of CASTLE_FLAGS) {
    const chip = dom.castleChips[flag];
    chip.disabled = !avail[flag];
    chip.classList.toggle('active', !!P.rights[flag] && avail[flag]);
    chip.title = avail[flag] ? '' : 'Needs the king and that rook on their starting squares';
  }

  if (document.activeElement !== dom.fenInput) dom.fenInput.value = fen;

  clear(dom.status);
  if (res.ok) {
    dom.status.append(el('div', { class: 'ok-line' }, '✓ Legal position — ', el('span', { class: 'muted', text: describe(fen) })));
  } else {
    dom.status.append(el('div', { class: 'bad-line', text: '✗ Not playable yet' }));
  }
  for (const e of res.errors) dom.status.append(el('div', { class: 'bad-line small', text: `· ${e}` }));
  for (const w of res.warnings) dom.status.append(el('div', { class: 'warn-line small', text: `· ${w}` }));

  dom.playBtn.disabled = !res.playable;
  dom.analyseBtn.disabled = !res.ok;
  dom.saveBtn.disabled = !res.ok;
}

function loadFen(text, { quiet = false } = {}) {
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
  const res = validate(fen);
  if (!res.ok && placementOf(fen).split('/').length !== 8) {
    if (!quiet) toast('That does not look like a FEN', 'bad');
    return false;
  }
  P.loading = true;
  P.turn = fen.split(' ')[1];
  P.rights = parseCastling(fen.split(' ')[2]);
  P.ep = fen.split(' ')[3];
  P.halfmove = Number(fen.split(' ')[4]) || 0;
  P.fullmove = Number(fen.split(' ')[5]) || 1;
  ed.setPlacement(fen); // fires boardChanged -> refresh
  P.loading = false;
  if (!quiet && !res.ok) toast(res.errors[0] || 'Position is not legal', 'bad');
  return true;
}

function copyFen() {
  const fen = currentFen();
  navigator.clipboard?.writeText(fen).then(() => toast('FEN copied', 'good'), () => toast('Copy failed', 'bad'));
}

function chosenColor(fen) {
  const sel = dom.sideSel.value;
  if (sel === 'white' || sel === 'black') return sel;
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function playFromHere({ fen = null, positionId = null } = {}) {
  const target = fen || currentFen();
  const res = validate(target);
  if (!res.playable) { toast(res.errors[0] || 'This position cannot be played', 'bad'); return; }
  sessionStorage.setItem('play.fen', target);
  sessionStorage.setItem('play.color', chosenColor(target));
  sessionStorage.setItem('play.level', dom.levelSel.value);
  if (positionId) sessionStorage.setItem('play.positionId', positionId);
  else sessionStorage.removeItem('play.positionId');
  location.hash = '#/play';
}

function analyse(fen = null) {
  const target = fen || currentFen();
  sessionStorage.setItem('analysis.load', JSON.stringify({ fen: target, moves: [] }));
  location.hash = '#/analysis';
}

// ---------- library ----------

function items() { return state.get().positions.items; }

function saveDialog() {
  const fen = currentFen();
  if (!validate(fen).ok) { toast('Fix the position first', 'bad'); return; }
  const editing = P.editingId ? items().find((i) => i.id === P.editingId) : null;
  const name = el('input', { type: 'text', value: editing ? editing.name : '', placeholder: 'e.g. Lucena position' });
  const source = el('input', { type: 'text', value: editing ? editing.source : '', placeholder: 'Book, chapter, page — optional' });
  const save = (mode) => {
    const title = name.value.trim() || describe(fen);
    if (mode === 'update' && editing) {
      state.update('positions', (p) => {
        const it = p.items.find((i) => i.id === editing.id);
        if (it) { it.name = title; it.source = source.value.trim(); it.fen = fen; }
      });
      toast('Position updated', 'good');
    } else {
      const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
      state.update('positions', (p) => {
        p.items.unshift({
          id, name: title, source: source.value.trim(), fen,
          created: Date.now(), plays: 0, wins: 0, draws: 0, losses: 0, lastPlayed: 0,
        });
        if (p.items.length > 200) p.items.length = 200;
      });
      P.editingId = id;
      toast('Saved to your library', 'good');
    }
    m.close();
    renderLibrary();
  };
  const m = modal(el('div', {},
    el('h3', { text: editing ? 'Save position' : 'Save position to your library' }),
    el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
    el('label', { class: 'field' }, el('span', { text: 'Where it comes from' }), source),
    el('p', { class: 'faint small', text: fen }),
    el('div', { class: 'btn-row mt' },
      editing ? btn(`Update “${editing.name}”`, () => save('update'), 'primary') : null,
      btn(editing ? 'Save as new' : 'Save', () => save('new'), editing ? '' : 'primary'),
      btn('Cancel', () => m.close(), 'ghost'))));
  name.focus();
}

function renderLibrary() {
  const list = items();
  clear(dom.library);
  if (!list.length) {
    dom.library.append(el('div', { class: 'card' },
      el('p', { class: 'muted', text: 'Nothing saved yet. Build a position above and hit “Save to library” — the ones you keep here are the ones worth replaying until they are second nature.' })));
    return;
  }
  const grid = el('div', { class: 'pos-grid' });
  for (const it of list) {
    const played = it.plays || 0;
    const record = played
      ? `${played} played · ${it.wins || 0}W ${it.draws || 0}D ${it.losses || 0}L${it.lastPlayed ? ` · ${timeAgo(it.lastPlayed)}` : ''}`
      : 'Not played yet';
    grid.append(el('div', { class: 'pos-card' + (it.id === P.editingId ? ' current' : '') },
      miniBoard(it.fen),
      el('div', { class: 'pos-body' },
        el('div', { class: 'pos-title', text: it.name }),
        it.source ? el('div', { class: 'small muted', text: it.source }) : null,
        el('div', { class: 'small faint', text: describe(it.fen) }),
        el('div', { class: 'small faint', text: record }),
        el('div', { class: 'btn-row mt' },
          btn('Load', () => loadItem(it), 'small ghost'),
          btn('▶ Play', () => playFromHere({ fen: it.fen, positionId: it.id }), 'small'),
          btn('Analyse', () => analyse(it.fen), 'small ghost'),
          btn('Delete', () => removeItem(it), 'small ghost danger-ghost')))));
  }
  dom.library.append(grid);
}

function loadItem(it) {
  P.editingId = it.id;
  loadFen(it.fen);
  renderLibrary();
  toast(`Loaded “${it.name}”`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function removeItem(it) {
  const m = modal(el('div', {},
    el('h3', { text: 'Delete position?' }),
    el('p', { class: 'muted' }, `“${it.name}” will be removed from your library.`),
    el('div', { class: 'btn-row mt' },
      btn('Delete', () => {
        state.update('positions', (p) => { p.items = p.items.filter((x) => x.id !== it.id); });
        if (P.editingId === it.id) P.editingId = null;
        m.close();
        renderLibrary();
      }, 'primary'),
      btn('Cancel', () => m.close(), 'ghost'))));
}

// Static diagram for the library cards — reuses the chessground piece sprites.
function miniBoard(fen) {
  const wrap = el('div', { class: 'mini-board cg-wrap' });
  for (const [sq, piece] of piecesFromPlacement(fen)) {
    const x = FILES.indexOf(sq[0]);
    const y = 8 - Number(sq[1]);
    if (x < 0 || y < 0 || y > 7 || !ROLES.includes(piece.role)) continue;
    wrap.append(el('piece', { class: `${piece.color} ${piece.role}`, style: `transform: translate(${x * 100}%, ${y * 100}%)` }));
  }
  return wrap;
}

export function destroy() {
  if (ed) { ed.destroy(); ed = null; }
  P = null;
  dom = {};
}
