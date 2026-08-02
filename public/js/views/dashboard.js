// Home dashboard: progress tiles, rating line chart, activity bars, quick actions.
// Chart color #b07f2c validated (dataviz six checks) against the dark surface.
import { el, clear, dayKey, timeAgo } from '../util.js';
import * as state from '../state.js';
import { allLines } from '../content/repertoires.js';
import { dueLines } from '../srs.js';
import { LESSONS } from '../content/lessons.js';
import { DRILLS } from '../content/endgames.js';

const SERIES = '#b07f2c';

export async function render(container) {
  const s = state.get();
  const p = s.puzzles;

  const streak = currentStreak(p.dayCounts);
  const due = dueLines(s.openings.lines, allLines().map((x) => x.line.id)).length;
  const lessonsDone = LESSONS.filter((l) => s.lessons.done[l.id]).length;
  const drillsDone = DRILLS.filter((d) => s.endgames.drills[d.id]?.done).length;
  const todayCount = p.dayCounts[dayKey()] || 0;

  container.append(el('div', { class: 'page-head' },
    el('h1', { text: 'Welcome back' }),
    el('p', { text: tagline(p, streak, due) })));

  container.append(el('div', { class: 'tile-grid' },
    tile('Puzzle rating', String(p.rating), ratingDelta(p)),
    tile('Day streak', String(streak), todayCount ? `${todayCount} solved today` : 'none yet today'),
    tile('Reviews due', String(due), due ? 'openings waiting' : 'all caught up'),
    tile('Course progress', `${lessonsDone + drillsDone}`, `${lessonsDone}/${LESSONS.length} lessons · ${drillsDone}/${DRILLS.length} drills`)));

  // quick actions
  const nextLesson = LESSONS.find((l) => !s.lessons.done[l.id]);
  const actions = el('div', { class: 'btn-row mt' },
    action('⚡ Rated puzzle', '#/puzzles'),
    due ? action(`📖 Review openings (${due})`, '#/openings') : action('📖 Openings', '#/openings'),
    nextLesson ? action(`🎓 ${nextLesson.title}`, `#/lessons/${nextLesson.id}`) : action('🎓 Lessons', '#/lessons'),
    action('♟ Play', '#/play'));
  container.append(actions);

  // rating chart
  const hist = p.history.slice(-60);
  const chartCard = el('div', { class: 'card mt' });
  chartCard.append(el('h3', { text: 'Puzzle rating — last 60 rated' }));
  if (hist.length >= 2) {
    chartCard.append(ratingChart(hist));
    chartCard.append(dataTable(
      ['#', 'Rating', 'Puzzle', 'Result'],
      hist.map((h, i) => [String(i + 1), String(h.r), String(h.pr), h.win ? 'solved' : 'failed']),
      'rating history'));
  } else {
    chartCard.append(el('p', { class: 'muted', text: 'Solve a few rated puzzles and your rating curve will grow here.' }));
  }
  container.append(chartCard);

  // activity bars
  const days = lastNDays(14);
  const counts = days.map((d) => p.dayCounts[d] || 0);
  const actCard = el('div', { class: 'card mt' });
  actCard.append(el('h3', { text: 'Puzzles solved — last 14 days' }));
  if (counts.some((c) => c > 0)) {
    actCard.append(activityChart(days, counts));
    actCard.append(dataTable(['Day', 'Solved'], days.map((d, i) => [d, String(counts[i])]), 'daily activity'));
  } else {
    actCard.append(el('p', { class: 'muted', text: 'Your daily activity will appear here.' }));
  }
  container.append(actCard);

  container.append(el('p', { class: 'faint small mt center', text: 'ChessForge · self-hosted · engine runs in your browser · data: Lichess (CC0)' }));
}

function tagline(p, streak, due) {
  if (!p.history.length) return 'Your chess training home. Start with a rated puzzle or the first lesson.';
  const bits = [];
  if (streak > 1) bits.push(`${streak}-day streak`);
  if (due) bits.push(`${due} opening review${due > 1 ? 's' : ''} due`);
  bits.push(`rating ${p.rating}`);
  return bits.join(' · ');
}

function ratingDelta(p) {
  const h = p.history;
  if (h.length < 2) return '—';
  const prev = h[Math.max(0, h.length - 11)].r;
  const d = p.rating - prev;
  return `${d >= 0 ? '+' : ''}${d} last ${Math.min(10, h.length - 1)} puzzles`;
}

function currentStreak(dayCounts) {
  let n = 0;
  const d = new Date();
  if (!dayCounts[dayKey(d)]) d.setDate(d.getDate() - 1); // today not played yet still counts yesterday's run
  while (dayCounts[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function lastNDays(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setDate(d.getDate() - i);
    out.push(dayKey(dd));
  }
  return out;
}

function tile(label, value, sub) {
  return el('div', { class: 'stat-tile' },
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }),
    el('div', { class: 'sub', text: sub || '' }));
}

function action(label, href) {
  return el('a', { class: 'btn', href, text: label });
}

// ---------- rating line chart (single series, crosshair + tooltip) ----------
function ratingChart(hist) {
  const W = 640, H = 200, PL = 44, PR = 14, PT = 12, PB = 22;
  const xs = hist.map((_, i) => i);
  const ys = hist.map((h) => h.r);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const pad = Math.max(20, Math.round((yMax - yMin) * 0.15));
  const lo = yMin - pad, hi = yMax + pad;
  const X = (i) => PL + (i / Math.max(1, xs.length - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);

  const gridVals = niceTicks(lo, hi, 3);
  const grid = gridVals.map((v) =>
    `<g><line x1="${PL}" y1="${Y(v)}" x2="${W - PR}" y2="${Y(v)}" stroke="#3a342b" stroke-width="1"/>` +
    `<text x="${PL - 6}" y="${Y(v) + 3.5}" text-anchor="end" font-size="11" fill="#a89f92">${v}</text></g>`).join('');

  const pts = xs.map((i) => `${X(i).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ');
  const lastX = X(xs.length - 1), lastY = Y(ys[ys.length - 1]);

  const wrap = el('div', { class: 'chart-box' });
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Puzzle rating trend">
    ${grid}
    <polyline points="${pts}" fill="none" stroke="${SERIES}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lastX}" cy="${lastY}" r="4" fill="${SERIES}" stroke="#1e1b16" stroke-width="2"/>
    <text x="${Math.min(lastX + 6, W - PR - 30)}" y="${lastY - 8}" font-size="12" font-weight="700" fill="#ece7de">${ys[ys.length - 1]}</text>
    <line class="cross" x1="0" y1="${PT}" x2="0" y2="${H - PB}" stroke="#7d7566" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
    <circle class="dot" r="4.5" fill="${SERIES}" stroke="#1e1b16" stroke-width="2" opacity="0"/>
    <rect class="hit" x="${PL}" y="0" width="${W - PL - PR}" height="${H}" fill="transparent"/>
  </svg>`;
  const svg = wrap.firstElementChild;
  const tip = el('div', { class: 'chart-tip hidden' });
  wrap.append(tip);
  wrap.style.position = 'relative';

  const cross = svg.querySelector('.cross');
  const dot = svg.querySelector('.dot');
  const hit = svg.querySelector('.hit');
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const fx = ((clientX - r.left) / r.width) * W;
    let i = Math.round(((fx - PL) / (W - PL - PR)) * (xs.length - 1));
    i = Math.max(0, Math.min(xs.length - 1, i));
    const cx = X(i), cy = Y(ys[i]);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('opacity', '1');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('opacity', '1');
    const h = hist[i];
    tip.innerHTML = `<b>${h.r}</b> · vs ${h.pr} · ${h.win ? '✓ solved' : '✗ failed'}<br><span>${timeAgo(h.ts)}</span>`;
    tip.classList.remove('hidden');
    const leftPct = (cx / W) * 100;
    tip.style.left = `min(max(${leftPct}%, 60px), calc(100% - 70px))`;
    tip.style.top = `${(cy / H) * 100}%`;
  };
  hit.addEventListener('pointermove', (e) => move(e.clientX));
  hit.addEventListener('pointerdown', (e) => move(e.clientX));
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); tip.classList.add('hidden');
  });
  return wrap;
}

// ---------- activity bars ----------
function activityChart(days, counts) {
  const W = 640, H = 120, PL = 30, PR = 8, PT = 8, PB = 20;
  const max = Math.max(...counts, 1);
  const n = counts.length;
  const slot = (W - PL - PR) / n;
  const barW = Math.max(6, slot - 2); // 2px surface gap between bars
  const Y = (v) => PT + (1 - v / max) * (H - PT - PB);

  const bars = counts.map((c, i) => {
    const x = PL + i * slot + (slot - barW) / 2;
    const y = c > 0 ? Y(c) : H - PB - 1;
    const h = c > 0 ? (H - PB - y) : 1;
    const rr = Math.min(4, barW / 2, h);
    const label = days[i].slice(8); // day-of-month
    return `<g class="bar" data-i="${i}">
      <path d="M${x},${y + rr} a${rr},${rr} 0 0 1 ${rr},-${rr} h${barW - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - rr} h${-barW} z"
        fill="${SERIES}" opacity="${c > 0 ? 1 : 0.25}"/>
      <text x="${x + barW / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#7d7566">${label}</text>
      <rect x="${PL + i * slot}" y="0" width="${slot}" height="${H}" fill="transparent"/>
    </g>`;
  }).join('');

  const wrap = el('div', { class: 'chart-box', style: 'position:relative' });
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Puzzles solved per day">
    <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#3a342b"/>
    <text x="${PL - 6}" y="${Y(max) + 4}" text-anchor="end" font-size="11" fill="#a89f92">${max}</text>
    ${bars}
  </svg>`;
  const tip = el('div', { class: 'chart-tip hidden' });
  wrap.append(tip);
  for (const g of wrap.querySelectorAll('.bar')) {
    const i = Number(g.dataset.i);
    const show = () => {
      tip.innerHTML = `<b>${counts[i]}</b> on ${days[i]}`;
      tip.classList.remove('hidden');
      tip.style.left = `min(max(${((PL + i * slot + slot / 2) / W) * 100}%, 60px), calc(100% - 70px))`;
      tip.style.top = '0%';
    };
    g.addEventListener('pointermove', show);
    g.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  }
  return wrap;
}

function niceTicks(lo, hi, n) {
  const span = hi - lo;
  const step = Math.max(10, Math.round(span / n / 25) * 25);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out.length ? out : [Math.round((lo + hi) / 2)];
}

function dataTable(headers, rows, label) {
  const det = el('details', { class: 'small mt' });
  det.append(el('summary', { class: 'muted', text: `View ${label} as table` }));
  const table = el('table', { class: 'data-table' });
  table.append(el('tr', {}, headers.map((h) => el('th', { text: h }))));
  for (const r of rows.slice(-30)) table.append(el('tr', {}, r.map((c) => el('td', { text: c }))));
  det.append(table);
  return det;
}

export function destroy() {}
