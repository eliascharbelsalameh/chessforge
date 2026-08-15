#!/usr/bin/env node
// Build Diagram Desk: the Positions board editor as one self-contained HTML
// page (a Claude artifact). The vendored chess.js and chessground are ES
// modules — here they become classic scripts that hand their exports to the
// page through globals, so the whole thing is a single file with no imports,
// no fetches, and no Stockfish (the engine lives in app.js instead).
//
//   node tools/diagram-desk/build.mjs [out.html]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const VENDOR = path.join(ROOT, 'public/vendor');
const OUT = process.argv[2] || path.join(HERE, 'diagram-desk.html');

const read = (p) => readFileSync(p, 'utf8');

// --- rules engine ---
let chessjs = read(path.join(VENDOR, 'chess.js'));
const chessExport = /export \{[^}]*\};?\s*$/m;
if (!chessExport.test(chessjs)) throw new Error('chess.js: export statement not found');
chessjs = chessjs.replace(chessExport, 'window.__CHESSLIB__ = { Chess, validateFen };');

// --- board ---
let cground = read(path.join(VENDOR, 'chessground.min.js'));
const cgExport = /export\{([^}]*)\};?\s*$/m;
const cgMatch = cground.match(cgExport);
if (!cgMatch) throw new Error('chessground: export statement not found');
const local = cgMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/))
  .find(([, alias]) => alias === 'Chessground');
if (!local) throw new Error('chessground: Chessground export not found');
cground = cground.replace(cgExport, `window.__CHESSGROUND__ = ${local[0]};`);

// Both must be self-contained once their exports are gone.
for (const [name, src] of [['chess.js', chessjs], ['chessground', cground]]) {
  if (/(^|[;\n])\s*import[ {*(]/.test(src)) throw new Error(`${name}: unexpected import statement`);
  if (/(^|[;\n])\s*export[ {*]/.test(src)) throw new Error(`${name}: leftover export statement`);
}

const vendorCss = ['chessground.base.css', 'chessground.brown.css', 'chessground.cburnett.css']
  .map((f) => read(path.join(VENDOR, f))).join('\n');
const app = read(path.join(HERE, 'app.js'));

const page = read(path.join(HERE, 'page.html'))
  .replace('/*__VENDOR_CSS__*/', () => vendorCss)
  .replace('/*__STYLE__*/', () => read(path.join(HERE, 'style.css')))
  .replace('/*__CHESSJS__*/', () => chessjs)
  .replace('/*__CHESSGROUND__*/', () => cground)
  .replace('/*__APP__*/', () => app);

if (page.includes('/*__')) throw new Error('unreplaced placeholder left in the page');
if (/<\/script>/i.test(chessjs + cground + app)) throw new Error('script source would close its own tag');

writeFileSync(OUT, page);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${(page.length / 1024).toFixed(0)} KB`);
