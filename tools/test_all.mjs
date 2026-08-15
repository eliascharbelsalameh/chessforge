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
const pacing = await import('../public/js/pacing.js');
const speechMod = await import('../public/js/speech.js');
const setup = await import('../public/js/setup.js');

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

// engine pacing model
{
  const { thinkingMs, phaseFromFen, remainingMs, PACES } = pacing;
  const mid = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
  const half = () => 0.5; // no jitter, no long think
  ok(thinkingMs({ pace: 'instant', fen: mid, rand: half }) === 0, 'instant pace never waits');
  const human = thinkingMs({ pace: 'human', fen: mid, legalMoves: 30, rand: half });
  ok(human > 280 && human < 1600, `human pace is a believable pause (got ${human})`);
  ok(thinkingMs({ pace: 'relaxed', fen: mid, rand: half }) > thinkingMs({ pace: 'brisk', fen: mid, rand: half }), 'relaxed > brisk');
  ok(thinkingMs({ pace: 'human', fen: mid, level: 8, rand: half }) > thinkingMs({ pace: 'human', fen: mid, level: 1, rand: half }), 'stronger levels ponder longer');
  ok(thinkingMs({ pace: 'human', fen: mid, legalMoves: 42, rand: half }) > thinkingMs({ pace: 'human', fen: mid, legalMoves: 8, rand: half }), 'busier positions take longer');
  ok(thinkingMs({ pace: 'human', fen: mid, recapture: true, rand: half }) < human, 'recaptures come back fast');
  const opening = thinkingMs({ pace: 'human', fen: new Chess().fen(), legalMoves: 20, rand: half });
  ok(opening < thinkingMs({ pace: 'human', fen: mid, legalMoves: 20, rand: half }), 'opening moves are quick');
  ok(thinkingMs({ pace: 'human', fen: mid, legalMoves: 1, rand: half }) <= 400, 'only-move is near-instant');
  for (const p of PACES) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 400; i++) {
      const v = thinkingMs({ pace: p.id, fen: mid, legalMoves: 30 });
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    ok(lo >= 0 && hi <= 9000, `${p.id}: stays inside sane bounds (${lo}-${hi}ms)`);
    ok(p.id === 'instant' || hi > lo, `${p.id}: pauses vary between moves`);
  }
  ok(phaseFromFen(new Chess().fen()).pieces === 32 && phaseFromFen(new Chess().fen()).ply === 0, 'phase from startpos');
  ok(phaseFromFen('8/P6k/8/8/8/8/8/K7 b - - 0 12').ply === 23, 'ply counts black to move');
  ok(remainingMs(1000, 300) === 700 && remainingMs(200, 900) === 0, 'remaining wait never negative');
}

// lesson voiceover text
{
  const { sanToWords, speakableText, chunkText, expandNotation } = speechMod;
  ok(sanToWords('e4') === 'e 4', 'pawn move spoken');
  ok(sanToWords('Nxe5+') === 'knight takes e 5, check', 'capture with check spoken');
  ok(sanToWords('Qd8#') === 'queen d 8, checkmate', 'mate spoken');
  ok(sanToWords('O-O') === 'castles kingside' && sanToWords('O-O-O') === 'castles queenside', 'castling spoken');
  ok(sanToWords('a8=Q').includes('promotes to queen'), 'promotion spoken');
  ok(sanToWords('Rfe1') === 'rook f e 1', 'disambiguated move spoken');
  ok(sanToWords('hello') === null && sanToWords('') === null, 'non-moves rejected');
  const spoken = speakableText('<p>Play <b>1.e4</b>!</p><ol><li>Then <b>Nf3</b>.</li></ol>');
  ok(!/[<>]/.test(spoken), 'html stripped');
  ok(spoken.includes('knight f 3'), 'notation expanded inside prose');
  ok(!/\.\s*\./.test(spoken), 'no doubled sentence breaks');
  ok(speakableText('Black&rsquo;s rook &amp; king').includes('’') && speakableText('a &amp; b').includes('&') === true, 'entities decoded');
  ok(expandNotation('The Bad move') === 'The Bad move', 'plain words untouched');
  const long = 'This is a sentence about the knight. '.repeat(20).trim();
  const chunks = chunkText(long, 120);
  ok(chunks.length > 1 && chunks.every((c) => c.length <= 120), 'long text chunked for the speech queue');
  ok(chunks.join(' ') === long, 'chunking loses no words');
  ok(chunkText('One. Two. Three.', 9).length === 2, 'chunks pack whole sentences');
  ok(chunkText(speakableText('<p>Hi.</p>')).join('') === 'Hi.', 'short text stays whole');
  // every lesson step must survive the conversion with something to say
  for (const lesson of LESSONS) {
    for (const step of lesson.steps) {
      const text = speakableText(step.text);
      ok(text.length > 0 && !/[<>]/.test(text), `${lesson.id}: step text not speakable`);
    }
  }
}

// board editor: FEN assembly + legality checks
{
  const {
    START_FEN, EMPTY_FEN, placementFromPieces, piecesFromPlacement, castlingAvailable,
    castlingString, parseCastling, buildFen, epValid, validate, materialLine, describe, countPieces,
  } = setup;
  const startPlacement = START_FEN.split(' ')[0];

  // placement <-> piece map round-trips
  ok(placementFromPieces(piecesFromPlacement(START_FEN)) === startPlacement, 'start position round-trips through the editor');
  const lucena = '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1';
  ok(placementFromPieces(piecesFromPlacement(lucena)) === lucena.split(' ')[0], 'sparse endgame round-trips');
  ok(piecesFromPlacement(EMPTY_FEN).size === 0, 'empty board has no pieces');
  const map = piecesFromPlacement(START_FEN);
  ok(map.get('e1').role === 'king' && map.get('e1').color === 'white', 'white king read off e1');
  ok(map.get('d8').role === 'queen' && map.get('d8').color === 'black', 'black queen read off d8');
  ok(map.size === 32, 'start position has 32 pieces');

  // castling rights follow the pieces on the board
  const avail = castlingAvailable(startPlacement);
  ok(avail.K && avail.Q && avail.k && avail.q, 'all castling available from the start');
  ok(!castlingAvailable('4k3/8/8/8/8/8/8/R3K3').K, 'no kingside right without the h1 rook');
  ok(castlingAvailable('4k3/8/8/8/8/8/8/R3K3').Q, 'queenside right with the a1 rook');
  ok(castlingString({ K: true, q: true }) === 'Kq' && castlingString({}) === '-', 'castling field built');
  ok(parseCastling('Kq').K && parseCastling('Kq').q && !parseCastling('Kq').Q, 'castling field parsed');

  // buildFen only claims rights the layout supports
  const built = buildFen({ placement: '4k3/8/8/8/8/8/8/R3K3', turn: 'b', rights: { K: true, Q: true, k: true, q: true } });
  ok(built === '4k3/8/8/8/8/8/8/R3K3 b Q - 0 1', `impossible rights dropped (got ${built})`);
  ok(buildFen({ placement: startPlacement, rights: avail }) === START_FEN, 'the start layout rebuilds the start FEN');
  ok(buildFen({ placement: startPlacement }).includes(' w - - '), 'castling defaults to none until asked for');
  ok(buildFen({ placement: startPlacement, halfmove: -4, fullmove: 0 }).endsWith(' 0 1'), 'move counters clamped');

  // en passant is kept only when a pawn could actually have just double-stepped
  ok(epValid('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR', 'w', 'c6'), 'ep square accepted');
  ok(!epValid('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR', 'b', 'c6'), 'ep square rejected for the wrong side');
  ok(!epValid(startPlacement, 'w', 'c6'), 'ep square rejected with no pawn behind it');
  ok(buildFen({ placement: startPlacement, ep: 'e6' }).includes(' - 0 1'), 'bogus ep dropped from the FEN');

  // validation of hand-made positions
  const good = validate(START_FEN);
  ok(good.ok && good.playable && !good.errors.length, 'start position validates');
  ok(!validate('8/8/8/8/8/8/8/8 w - - 0 1').ok, 'empty board is not playable');
  ok(validate('8/8/8/8/8/8/8/4K3 w - - 0 1').errors.some((e) => /Black needs a king/.test(e)), 'missing black king reported');
  ok(validate('4k3/8/8/8/8/8/8/4KK2 w - - 0 1').errors.some((e) => /2 kings/.test(e)), 'two white kings reported');
  ok(validate('4k2P/8/8/8/8/8/8/4K3 w - - 0 1').errors.some((e) => /Pawns cannot stand/.test(e)), 'pawn on the 8th rank reported');
  ok(validate('4k3/8/8/8/8/8/8/R3K3 b - - 0 1').ok, 'quiet position with black to move is fine');
  ok(validate('4k3/4R3/8/8/8/8/8/4K3 b - - 0 1').ok, 'checking the side to move is legal');
  const leftInCheck = validate('4k3/4R3/8/8/8/8/8/4K3 w - - 0 1');
  ok(!leftInCheck.ok && leftInCheck.errors.some((e) => /in check but it is/.test(e)), 'side that just moved cannot be left in check');
  const quiet = validate('6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1');
  ok(quiet.ok && quiet.playable, 'ordinary position is playable');
  const done = validate('7k/5KQ1/8/8/8/8/8/8 b - - 0 1');
  ok(done.ok && !done.playable && done.over === 'checkmate', 'finished position is legal but not playable');
  ok(done.warnings.some((w) => /already over/.test(w)), 'checkmate warned about');
  ok(validate('4k3/8/8/8/8/8/8/4K3 w - - 0 1').over === 'insufficient material', 'bare kings flagged');
  ok(validate('4k3/8/8/8/8/8/PPPPPPPPP/4K3 w - - 0 1').errors.length > 0, 'nine pawns on a rank rejected');

  // material shorthand used by the library cards
  ok(materialLine(START_FEN) === 'K+Q+2R+2B+2N+8P vs K+Q+2R+2B+2N+8P', `start material line (got ${materialLine(START_FEN)})`);
  ok(materialLine(lucena) === 'K+R+P vs K+R', `Lucena material line (got ${materialLine(lucena)})`);
  ok(describe(lucena).startsWith('White to move · '), 'description names the side to move');
  ok(countPieces(START_FEN).whiteTotal === 16 && countPieces(lucena).blackTotal === 2, 'piece counts');

  // every position the app ships must survive the editor's own validator
  for (const d of DRILLS) ok(validate(d.fen).ok, `${d.id}: drill FEN rejected by the position editor`);
  for (const lesson of LESSONS) {
    for (const [i, step] of lesson.steps.entries()) {
      if (step.fen) ok(validate(step.fen).ok, `${lesson.id} step ${i + 1}: diagram FEN rejected by the position editor`);
    }
  }
}

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
