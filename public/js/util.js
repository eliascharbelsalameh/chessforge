// Small DOM + misc helpers used across views.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function toast(msg, kind = '', ms = 2600) {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast ${kind}` , text: msg });
  root.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, ms - 300);
  setTimeout(() => t.remove(), ms);
}

export function modal(content, { onClose } = {}) {
  const root = document.getElementById('modal-root');
  const box = el('div', { class: 'modal' }, content);
  const backdrop = el('div', { class: 'modal-backdrop' }, box);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  function close() { backdrop.remove(); onClose && onClose(); }
  root.append(backdrop);
  return { close, box };
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
export const epochDay = (t = Date.now()) => Math.floor(t / 86400000);

export function fmtInt(n) { return Number(n).toLocaleString('en-US'); }

export function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// UCI helpers
export const uciFrom = (uci) => uci.slice(0, 2);
export const uciTo = (uci) => uci.slice(2, 4);
export const uciPromo = (uci) => uci.slice(4) || undefined;

// Does this uci move take back on the square the last move captured on?
// (Recaptures are the moves humans play fastest — see pacing.js.)
export function isRecapture(chess, uci) {
  const last = chess.history({ verbose: true }).slice(-1)[0];
  return !!(last && last.captured && uciTo(uci) === last.to);
}

export function fenTurn(fen) { return fen.split(' ')[1] === 'w' ? 'white' : 'black'; }
export function opposite(color) { return color === 'white' ? 'black' : 'white'; }

// Elo expected score + update
export function eloExpected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }
export function eloUpdate(rating, oppRating, won, k = 32) {
  return Math.round(rating + k * ((won ? 1 : 0) - eloExpected(rating, oppRating)));
}

// centipawn score → white winning probability (lichess formula)
export function cpToWinPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function scoreText(score, povWhite = true) {
  if (score == null) return '…';
  if (score.mate != null) {
    const m = povWhite ? score.mate : -score.mate;
    return (m > 0 ? '#' : '#-') + Math.abs(m);
  }
  const cp = (povWhite ? score.cp : -score.cp) / 100;
  return (cp > 0 ? '+' : '') + cp.toFixed(1);
}

export function svgIcon(name) {
  const paths = {
    home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z"/>',
    puzzles: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    openings: '<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
    endgames: '<path d="M4 22V4"/><path d="M4 4s1-1 4-1 4 2 8 2 4-1 4-1v11s-1 1-4 1-4-2-8-2-4 1-4 1"/>',
    lessons: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12.5V17c3 2.5 9 2.5 12 0v-4.5"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    positions: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    analysis: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
    flip: '<path d="M17 2v6h-6"/><path d="M3 11a9 9 0 0 1 14-6.5L17 8"/><path d="M7 22v-6h6"/><path d="M21 13a9 9 0 0 1-14 6.5L7 16"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    fwd: '<path d="m9 18 6-6-6-6"/>',
    first: '<path d="m17 18-6-6 6-6"/><path d="M7 6v12"/>',
    last: '<path d="m7 18 6-6-6-6"/><path d="M17 6v12"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 1 3.5 10.9c-.7.5-1 1.3-1 2.1h-5c0-.8-.3-1.6-1-2.1A6 6 0 0 1 12 3z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  return span.firstChild;
}
