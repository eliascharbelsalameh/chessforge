// Progress store: localStorage-backed, section-level timestamps, optional
// server sync (last-write-wins per section) so phone/tablet/laptop share one
// profile on the private server.

const KEY = 'chessforge.v1';
const SECTIONS = ['puzzles', 'openings', 'endgames', 'lessons', 'play', 'settings'];

function defaults() {
  return {
    puzzles: {
      rating: 1200,
      history: [],          // [{id, pr, win, ts}] capped
      solved: {},           // id -> ts (success)
      attempted: {},        // id -> ts (any first attempt)
      dayCounts: {},        // '2026-08-02' -> n solved
      themeStats: {},       // theme -> {w, l}
      streakBest: 0,
      _ts: 0,
    },
    openings: { lines: {}, _ts: 0 }, // lineId -> {idx, due, reps, lapses, learned}
    endgames: { drills: {}, _ts: 0 }, // drillId -> {done, attempts, ts}
    lessons: { done: {}, _ts: 0 },   // lessonId -> ts
    play: { games: [], _ts: 0 },     // [{color, level, result, ts}] capped
    settings: {
      autoSync: true, showDests: true, animate: true,
      enginePace: 'human',            // see pacing.js PACES
      voiceover: false,               // read lessons aloud (speech.js)
      voiceURI: '', voiceRate: 1,
      _ts: 0,
    },
  };
}

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

let state = load();
let saveTimer = null;
let syncTimer = null;
let syncStatus = { at: 0, ok: null };
const listeners = new Set();

function load() {
  const s = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) deepMerge(s, JSON.parse(raw));
  } catch (e) {
    console.warn('state load failed', e);
  }
  return s;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('state save failed', e);
  }
}

export function get() { return state; }

// mutate a section through fn, stamp it, schedule persist+sync
export function update(section, fn) {
  fn(state[section]);
  state[section]._ts = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 150);
  scheduleSync();
  for (const l of listeners) l(section);
  return state[section];
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---- server sync ----
function mergeRemote(remote) {
  if (!remote || typeof remote !== 'object') return false;
  let changed = false;
  for (const sec of SECTIONS) {
    const r = remote[sec];
    if (r && typeof r === 'object' && (r._ts || 0) > (state[sec]._ts || 0)) {
      state[sec] = deepMerge(defaults()[sec], r);
      changed = true;
    }
  }
  if (changed) { persist(); for (const l of listeners) l('*'); }
  return changed;
}

async function push() {
  const body = JSON.stringify({ ts: Date.now(), state });
  const res = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  if (!res.ok) throw new Error('sync push failed');
}

export async function syncNow() {
  if (!state.settings.autoSync) return { ok: false, skipped: true };
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (data && data.state) mergeRemote(data.state);
    await push();
    syncStatus = { at: Date.now(), ok: true };
    return { ok: true };
  } catch (e) {
    syncStatus = { at: Date.now(), ok: false };
    return { ok: false, error: e };
  }
}

function scheduleSync() {
  if (!state.settings.autoSync) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), 2500);
}

export function getSyncStatus() { return syncStatus; }

export function exportJSON() { return JSON.stringify(state, null, 2); }

export function importJSON(text) {
  const incoming = JSON.parse(text);
  state = deepMerge(defaults(), incoming);
  for (const sec of SECTIONS) state[sec]._ts = Date.now();
  persist();
  scheduleSync();
  for (const l of listeners) l('*');
}

export function resetAll() {
  state = defaults();
  for (const sec of SECTIONS) state[sec]._ts = Date.now();
  persist();
  scheduleSync();
  for (const l of listeners) l('*');
}

// initial pull (async, non-blocking)
export function initSync() { if (state.settings.autoSync) syncNow(); }

// ---- domain helpers ----
export function recordPuzzleResult({ id, puzzleRating, win, themes, rated, usedHelp }) {
  return update('puzzles', (p) => {
    const now = Date.now();
    p.attempted[id] = now;
    if (win) {
      p.solved[id] = now;
      const dk = new Date().toISOString().slice(0, 10);
      p.dayCounts[dk] = (p.dayCounts[dk] || 0) + 1;
    }
    for (const t of themes || []) {
      if (!p.themeStats[t]) p.themeStats[t] = { w: 0, l: 0 };
      p.themeStats[t][win ? 'w' : 'l']++;
    }
    // (rating itself is updated by the caller, which owns the Elo math)
    // cap maps so localStorage stays lean
    capMap(p.attempted, 6000);
    capMap(p.solved, 6000);
    if (p.history.length > 600) p.history = p.history.slice(-500);
  });
}

function capMap(obj, max) {
  const keys = Object.keys(obj);
  if (keys.length <= max) return;
  keys.sort((a, b) => obj[a] - obj[b]);
  for (const k of keys.slice(0, keys.length - max)) delete obj[k];
}
