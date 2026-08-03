// Chessground wrapper: keeps a chess.js instance and the board in sync,
// handles promotion picking, legal-move dests, and container resizing.
import { Chessground } from '../vendor/chessground.min.js';
import { el, clear, uciFrom, uciTo, uciPromo } from './util.js';

export function legalDests(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

const PROMO_PIECES = ['queen', 'knight', 'rook', 'bishop'];
const PROMO_LETTER = { queen: 'q', knight: 'n', rook: 'r', bishop: 'b' };

export class Board {
  /**
   * @param {HTMLElement} container square element (.board-wrap)
   * @param {object} opts {orientation, onUserMove(from, to, promotion), animate}
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.cgEl = el('div');
    container.append(this.cgEl);
    this.cg = Chessground(this.cgEl, {
      orientation: opts.orientation || 'white',
      animation: { enabled: opts.animate !== false, duration: 180 },
      movable: { free: false, color: undefined, showDests: opts.showDests !== false },
      draggable: { showGhost: true },
      selectable: { enabled: true },
      highlight: { lastMove: true, check: true },
      coordinates: true,
      events: {
        move: (orig, dest) => this.handleMove(orig, dest),
      },
      drawable: { enabled: true },
    });
    this.chess = null;
    this.movableColor = undefined;
    this.promoOverlay = null;
    this.ro = new ResizeObserver(() => {
      this.cg.redrawAll();
      // redrawAll re-renders the wrap from scratch — put an open picker back.
      if (this.promoOverlay) this.cgEl.append(this.promoOverlay);
    });
    this.ro.observe(container);
  }

  // Wire the board to a chess.js instance. movableColor: 'white'|'black'|'both'|undefined
  sync(chess, { lastMove, movableColor, animate } = {}) {
    this.chess = chess;
    this.movableColor = movableColor;
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    const canMove = movableColor === 'both' ? turn : movableColor;
    this.cg.set({
      fen: chess.fen(),
      turnColor: turn,
      check: chess.inCheck(),
      lastMove: lastMove || undefined,
      animation: { enabled: animate !== false && this.opts.animate !== false },
      movable: {
        free: false,
        color: canMove,
        dests: canMove ? legalDests(chess) : new Map(),
        showDests: this.opts.showDests !== false,
      },
    });
  }

  // Show a static FEN (no interaction).
  setFen(fen, { lastMove, orientation } = {}) {
    if (orientation) this.cg.set({ orientation });
    this.cg.set({
      fen,
      lastMove: lastMove || undefined,
      turnColor: fen.split(' ')[1] === 'b' ? 'black' : 'white',
      movable: { free: false, color: undefined, dests: new Map() },
    });
  }

  async handleMove(orig, dest) {
    if (!this.chess || !this.opts.onUserMove) return;
    let promotion;
    const piece = this.chess.get(orig);
    if (piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
      promotion = await this.pickPromotion(dest, piece.color === 'w' ? 'white' : 'black');
      if (!promotion) { this.sync(this.chess, { movableColor: this.movableColor, animate: false }); return; }
    }
    this.opts.onUserMove(orig, dest, promotion);
  }

  pickPromotion(dest, color) {
    return new Promise((resolve) => {
      const overlay = el('div', { class: 'promo-overlay' });
      const fileIdx = dest.charCodeAt(0) - 97;
      const orient = this.cg.state.orientation;
      const leftPct = (orient === 'white' ? fileIdx : 7 - fileIdx) * 12.5;
      const fromTop = (orient === 'white') === (dest[1] === '8');
      const col = el('div', { class: 'promo-col', style: `left:${leftPct}%; ${fromTop ? 'top:0' : 'bottom:0; flex-direction:column-reverse'}` });
      const close = (letter) => { this.promoOverlay = null; overlay.remove(); resolve(letter); };
      for (const p of PROMO_PIECES) {
        const btn = el('piece', { class: `${color} ${p}`, role: 'button', 'aria-label': p });
        btn.addEventListener('click', (e) => { e.stopPropagation(); close(PROMO_LETTER[p]); });
        col.append(btn);
      }
      overlay.addEventListener('click', () => close(null));
      overlay.append(col);
      this.promoOverlay = overlay;
      this.cgEl.append(overlay); // Chessground puts .cg-wrap ON cgEl, not inside it
    });
  }

  // animate a uci move applied to the synced chess instance by the caller
  showMove(uci) {
    if (!this.chess) return;
    this.sync(this.chess, { lastMove: [uciFrom(uci), uciTo(uci)], movableColor: this.movableColor });
  }

  shapes(list) { this.cg.setAutoShapes(list || []); }
  userShapes(list) { this.cg.setShapes(list || []); }
  orient(color) { this.cg.set({ orientation: color }); }
  toggleOrientation() { this.cg.toggleOrientation(); }
  orientation() { return this.cg.state.orientation; }

  freeze() { this.cg.set({ movable: { color: undefined, dests: new Map() } }); }

  destroy() {
    this.ro.disconnect();
    this.cg.destroy();
    clear(this.container);
  }
}

// convenience: apply a uci string to a chess.js game, returns the Move or null
export function applyUci(chess, uci) {
  try {
    return chess.move({ from: uciFrom(uci), to: uciTo(uci), promotion: uciPromo(uci) });
  } catch {
    return null;
  }
}
