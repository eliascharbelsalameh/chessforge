// Chessground in free-placement mode: the drag-and-drop board editor.
// Pieces can be dragged in from a palette, moved anywhere, or dragged off the
// board to delete them; tapping with a tool selected works on touch screens.
import { Chessground } from '../vendor/chessground.min.js';
import { el, clear } from './util.js';
import { placementOf } from './setup.js';

export class PositionEditor {
  /**
   * @param {HTMLElement} container square element (.board-wrap)
   * @param {object} opts {orientation, onChange(placement)}
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.tool = null; // {role, color} | 'erase' | null — used by tap-to-place
    this.cgEl = el('div');
    container.append(this.cgEl);
    this.cg = Chessground(this.cgEl, {
      orientation: opts.orientation || 'white',
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
      events: { change: () => this.changed() },
    });
    this.onClick = (e) => this.tap(e);
    this.cgEl.addEventListener('click', this.onClick);
    this.ro = new ResizeObserver(() => this.cg.redrawAll());
    this.ro.observe(container);
  }

  changed() { if (this.opts.onChange) this.opts.onChange(this.placement()); }

  // FEN placement field only — the view owns side to move, castling, etc.
  placement() { return this.cg.getFen(); }

  // Accepts a placement or a full FEN (chessground reads up to the first space).
  setPlacement(fen) {
    this.cg.set({ fen: placementOf(fen) });
    this.changed();
  }

  clearBoard() { this.setPlacement('8/8/8/8/8/8/8/8'); }

  // Start a drag straight out of the palette (mousedown / touchstart).
  dragSpare(piece, ev) {
    this.cg.dragNewPiece({ ...piece }, ev, true);
  }

  setTool(tool) { this.tool = tool; }

  tap(ev) {
    if (!this.tool) return;
    const key = this.cg.getKeyAtDomPos([ev.clientX, ev.clientY]);
    if (!key) return;
    if (this.tool === 'erase') this.removeAt(key);
    else this.placeAt(key, this.tool);
  }

  placeAt(key, piece) {
    this.cg.setPieces(new Map([[key, { ...piece }]]));
    this.changed();
  }

  removeAt(key) {
    this.cg.setPieces(new Map([[key, undefined]]));
    this.changed();
  }

  orient(color) { this.cg.set({ orientation: color }); }
  toggleOrientation() { this.cg.toggleOrientation(); }
  orientation() { return this.cg.state.orientation; }

  destroy() {
    this.ro.disconnect();
    this.cgEl.removeEventListener('click', this.onClick);
    this.cg.destroy();
    clear(this.container);
  }
}
