// App shell: hash router + navigation.
import { el, clear, svgIcon } from './util.js';
import * as state from './state.js';
import * as dashboard from './views/dashboard.js';
import * as puzzles from './views/puzzles.js';
import * as openings from './views/openings.js';
import * as endgames from './views/endgames.js';
import * as lessons from './views/lessons.js';
import * as play from './views/play.js';
import * as positions from './views/positions.js';
import * as analysis from './views/analysis.js';
import * as settings from './views/settings.js';

const routes = {
  home: dashboard,
  puzzles,
  openings,
  endgames,
  lessons,
  play,
  positions,
  analysis,
  settings,
};

const NAV = [
  ['home', 'Home', 'home'],
  ['puzzles', 'Puzzles', 'puzzles'],
  ['openings', 'Openings', 'openings'],
  ['endgames', 'Endgames', 'endgames'],
  ['lessons', 'Lessons', 'lessons'],
  ['play', 'Play', 'play'],
  ['positions', 'Positions', 'positions'],
  ['analysis', 'Analysis', 'analysis'],
  ['settings', 'Settings', 'settings'],
];

function buildNav() {
  const topnav = document.getElementById('topnav');
  const tabbar = document.getElementById('tabbar');
  for (const [route, label, icon] of NAV) {
    topnav.append(el('a', { href: `#/${route}`, dataset: { route } }, svgIcon(icon), label));
    tabbar.append(el('a', { href: `#/${route}`, dataset: { route } }, svgIcon(icon), el('span', { text: label })));
  }
}

function setActive(route) {
  for (const a of document.querySelectorAll('#topnav a, #tabbar a')) {
    a.classList.toggle('active', a.dataset.route === route);
  }
  const tab = document.querySelector(`#tabbar a[data-route="${route}"]`);
  if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let current = null;

async function navigate() {
  const hash = location.hash || '#/home';
  const [pathStr, queryStr] = hash.slice(2).split('?');
  const parts = pathStr.split('/').filter(Boolean);
  const route = routes[parts[0]] ? parts[0] : 'home';
  const view = routes[route];
  if (current && current.destroy) {
    try { current.destroy(); } catch (e) { console.warn(e); }
  }
  current = view;
  const container = document.getElementById('view');
  clear(container);
  setActive(route);
  document.title = `${NAV.find(([r]) => r === route)?.[1] || 'ChessForge'} · ChessForge`;
  try {
    await view.render(container, { path: parts.slice(1), query: new URLSearchParams(queryStr || '') });
  } catch (e) {
    console.error(e);
    container.append(el('div', { class: 'card' },
      el('h3', { text: 'Something went wrong' }),
      el('p', { class: 'muted', text: String(e.message || e) })));
  }
  container.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function updateStatus() {
  const s = state.get();
  const status = document.getElementById('topbar-status');
  clear(status).append(el('span', { title: 'Puzzle rating' }, `⚡ ${s.puzzles.rating}`));
}

buildNav();
state.initSync();
state.onChange(updateStatus);
updateStatus();
window.addEventListener('hashchange', navigate);
navigate();
