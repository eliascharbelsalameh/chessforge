#!/usr/bin/env node
// ChessForge test suite: content validation (every FEN and move in the app),
// unit tests for rating/SRS logic, and import-graph integrity.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Chess } from '../public/vendor/chess.js';

// --- tiny harness ---
let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); console.error('  ✗ FAIL:', label); }
}

// browser shims so app modules can be imported under node
globalThis.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
globalThis.fetch = async () => { throw new Error('no network in tests'); };

const { REPERTOIRES, allLines } = await import('../public/js/content/repertoires.js');
const { DRILLS } = await import('../public/js/content/endgames.js');
const { LESSONS } = await import('../public/js/content/lessons.js');
const { THEMES, PICKER_THEMES } = await import('../public/js/content/themes.js');
const { INTERVALS, initEntry, applyReview, isDue } = await import('../public/js/srs.js');
const util = await import('../public/js/util.js');
const state = await import('../public/js/state.js');

// ---------- 1. repertoire lines replay ----------
console.log('\n[1] Repertoires');
for (const rep of REPERTOIRES) {
  for (const line of rep.lines) {
    const chess = new Chess();
    let legal = true, badMove = '';
    for (const step of line.moves) {
      try { chess.move(step.san); } catch { legal = false; badMove = step.san; break; }
    }
    ok(legal, `${rep.id}/${line.id}: illegal move "${badMove}"`);
    ok(line.moves.length >= 8, `${rep.id}/${line.id}: too short`);
    const ids = new Set();
    ok(!ids.has(line.id), `duplicate line id ${line.id}`);
    ids.add(line.id);
  }
  ok(['white', 'black'].includes(rep.color), `${rep.id}: bad color`);
}
ok(new Set(allLines().map((x) => x.line.id)).size === allLines().length, 'line ids unique');
console.log(`  ${REPERTOIRES.length} repertoires, ${allLines().length} lines replayed`);

// ---------- 2. endgame drills ----------
console.log('[2] Endgame drills');
for (const d of DRILLS) {
  let c = null;
  try { c = new Chess(d.fen); } catch { /* invalid */ }
  ok(c !== null, `${d.id}: FEN invalid`);
  if (!c) continue;
  const stm = c.turn() === 'w' ? 'white' : 'black';
  ok(stm === d.side, `${d.id}: side-to-move ${stm} ≠ drill.side ${d.side}`);
  ok(!c.isGameOver(), `${d.id}: position already over`);
  ok(['win', 'draw'].includes(d.goal), `${d.id}: bad goal`);
  ok(Array.isArray(d.hints) && d.hints.length >= 2, `${d.id}: needs hints`);
  ok(typeof d.theory === 'string' && d.theory.length > 80, `${d.id}: theory too thin`);
}
console.log(`  ${DRILLS.length} drills validated`);

// ---------- 3. lessons: full simulation ----------
console.log('[3] Lessons');
const SQ = /^[a-h][1-8]$/;
for (const lesson of LESSONS) {
  let chess = new Chess();
  for (const [i, step] of lesson.steps.entries()) {
    const tag = `${lesson.id} step ${i + 1}`;
    if (step.fen) {
      try { chess = new Chess(step.fen); } catch { ok(false, `${tag}: bad FEN`); continue; }
    }
    for (const s of step.shapes || []) {
      ok(SQ.test(s.orig) && (!s.dest || SQ.test(s.dest)), `${tag}: bad shape square`);
    }
    if (step.moves) {
      for (const san of step.moves) {
        let mv = null;
        try { mv = chess.move(san); } catch { /* illegal */ }
        ok(mv !== null, `${tag}: demo move "${san}" illegal`);
        if (mv && san.includes('#')) ok(chess.isCheckmate(), `${tag}: "${san}" not actually mate`);
        if (!mv) break;
      }
    }
    if (step.challenge) {
      const { line, replies = [] } = step.challenge;
      for (let k = 0; k < line.length; k++) {
        let mv = null;
        try { mv = chess.move(line[k]); } catch { /* illegal */ }
        ok(mv !== null, `${tag}: challenge move "${line[k]}" illegal`);
        if (mv && line[k].includes('#')) ok(chess.isCheckmate(), `${tag}: "${line[k]}" not mate`);
        if (!mv) break;
        if (k < line.length - 1) {
          const rep = replies[k];
          ok(rep != null, `${tag}: missing reply after "${line[k]}"`);
          if (rep == null) break;
          let rv = null;
          try { rv = chess.move(rep); } catch { /* illegal */ }
          ok(rv !== null, `${tag}: reply "${rep}" illegal`);
          if (!rv) break;
        }
      }
    }
  }
  if (lesson.practice) ok(THEMES[lesson.practice.theme] != null, `${lesson.id}: unknown practice theme ${lesson.practice?.theme}`);
}
ok(new Set(LESSONS.map((l) => l.id)).size === LESSONS.length, 'lesson ids unique');
console.log(`  ${LESSONS.length} lessons simulated end-to-end`);

// ---------- 4. puzzle + opening data ----------
console.log('[4] Generated data');
const dataDir = 'public/data';
const manifest = JSON.parse(readFileSync(`${dataDir}/puzzles/manifest.json`, 'utf8'));
ok(manifest.bands.length === 11, 'manifest bands = 11');
let checked = 0;
for (const band of manifest.bands) {
  const rows = JSON.parse(readFileSync(`${dataDir}/puzzles/${band.file}`, 'utf8'));
  ok(rows.length === band.count, `${band.file}: count mismatch`);
  // spot-check 25 random puzzles per band: FEN + full solution legality
  for (let i = 0; i < 25; i++) {
    const [id, fen, moves, rating] = rows[Math.floor(Math.random() * rows.length)];
    let good = true;
    try {
      const c = new Chess(fen);
      for (const u of moves.split(' ')) {
        const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
        if (!mv) { good = false; break; }
      }
    } catch { good = false; }
    ok(good, `puzzle ${id} (band ${band.lo}): illegal solution`);
    ok(rating >= band.lo && rating < band.hi, `puzzle ${id}: rating outside band`);
    checked++;
  }
}
for (const t of PICKER_THEMES) ok(THEMES[t], `picker theme ${t} missing info`);
console.log(`  ${checked} puzzles spot-checked across ${manifest.bands.length} bands`);

const openings = JSON.parse(readFileSync(`${dataDir}/openings.json`, 'utf8'));
ok(openings.entries.length > 3500, 'openings count');
for (let i = 0; i < 100; i++) {
  const [eco, name, san, uci] = openings.entries[Math.floor(Math.random() * openings.entries.length)];
  const c = new Chess();
  let good = true;
  const sans = san.split(' '), ucis = uci.split(' ');
  ok(sans.length === ucis.length, `${name}: san/uci length mismatch`);
  for (let k = 0; k < sans.length; k++) {
    let mv = null;
    try { mv = c.move(sans[k]); } catch { /* illegal */ }
    if (!mv || mv.from + mv.to + (mv.promotion || '') !== ucis[k]) { good = false; break; }
  }
  ok(good, `opening ${eco} ${name}: replay mismatch`);
}
console.log(`  ${openings.entries.length} openings, 100 replayed`);

// ---------- 5. unit: elo + srs + state ----------
console.log('[5] Logic units');
ok(util.eloUpdate(1200, 1200, true) === 1216, 'elo win vs equal = +16');
ok(util.eloUpdate(1200, 1200, false) === 1184, 'elo loss vs equal = -16');
ok(util.eloUpdate(1200, 1600, true) > 1224, 'elo big win pays more');
ok(util.eloUpdate(1200, 800, false) < 1176, 'elo bad loss costs more');
ok(Math.abs(util.cpToWinPct(0) - 50) < 0.01, 'cp 0 = 50%');
ok(util.cpToWinPct(1000) > 95, 'cp +10 ≈ winning');
ok(util.scoreText({ mate: 3 }) === '#3' && util.scoreText({ mate: -2 }) === '#-2', 'mate text');
ok(util.scoreText({ cp: -350 }) === '-3.5', 'cp text');

let e = initEntry();
ok(isDue({ due: 0 }) && !isDue(e), 'due semantics');
e = applyReview(e, true);
ok(e.idx === 1 && e.reps === 1, 'srs advance');
e = applyReview(e, false);
ok(e.idx === 0 && e.lapses === 1, 'srs lapse resets');
for (let i = 0; i < 20; i++) e = applyReview(e, true);
ok(e.idx === INTERVALS.length - 1, 'srs caps at max interval');

state.update('puzzles', (p) => { p.rating = 1337; });
ok(state.get().puzzles.rating === 1337, 'state update');
ok(JSON.parse(globalThis.localStorage._s['chessforge.v1'] ?? '{}')?.puzzles === undefined, 'state persist debounced (not yet written)');
state.recordPuzzleResult({ id: 'test1', puzzleRating: 1200, win: true, themes: ['fork'], rated: true });
ok(state.get().puzzles.themeStats.fork.w === 1, 'theme stats recorded');

// ---------- 6. import graph + syntax of all modules ----------
console.log('[6] Import graph');
const jsRoot = 'public/js';
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) files.push(p);
  }
})(jsRoot);
const IMPORT_RE = /import\s+[^'"]*['"]([^'"]+)['"]/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.normalize(path.join(path.dirname(f), spec));
    ok(existsSync(resolved), `${f}: unresolved import ${spec}`);
  }
}
// import every non-DOM module to catch syntax errors (main.js/views touch DOM at render only)
for (const f of files.filter((x) => !x.endsWith('main.js') && !x.includes('views/') && !x.endsWith('board.js'))) {
  try { await import(path.resolve(f)); ok(true, ''); }
  catch (err) { ok(false, `${f}: import failed — ${err.message}`); }
}
// node --check parses ALL modules (views included) for pure syntax errors
const { execFileSync } = await import('node:child_process');
for (const f of [...files, 'server.js']) {
  try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); ok(true, ''); }
  catch (err) { ok(false, `${f}: syntax error — ${String(err.stderr).split('\n')[1] || ''}`); }
}
console.log(`  ${files.length} modules scanned`);

// ---------- summary ----------
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) { console.error('FAILURES:\n - ' + failures.filter(Boolean).join('\n - ')); process.exit(1); }
