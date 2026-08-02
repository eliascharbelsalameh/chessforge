#!/usr/bin/env node
// Precompute openings.json from the lichess-org/chess-openings TSVs (CC0).
// For each opening: replay the PGN with chess.js to derive UCI moves and the
// final EPD, so the client can match positions without parsing SAN itself.
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from '../public/vendor/chess.js';

const srcDir = process.argv[2] || 'tools/openings-src';
const out = process.argv[3] || 'public/data/openings.json';

const entries = [];
let failures = 0;
for (const letter of ['a', 'b', 'c', 'd', 'e']) {
  const tsv = readFileSync(`${srcDir}/${letter}.tsv`, 'utf8');
  for (const line of tsv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    const sans = pgn.replace(/\d+\./g, ' ').trim().split(/\s+/);
    const chess = new Chess();
    let ok = true;
    const ucis = [];
    for (const san of sans) {
      try {
        const m = chess.move(san);
        ucis.push(m.from + m.to + (m.promotion || ''));
      } catch {
        ok = false;
        break;
      }
    }
    if (!ok) { failures++; console.error(`FAIL ${eco} ${name}: ${pgn}`); continue; }
    const epd = chess.fen().split(' ').slice(0, 4).join(' ');
    entries.push([eco, name, sans.join(' '), ucis.join(' '), epd]);
  }
}

writeFileSync(out, JSON.stringify({ n: entries.length, entries }));
console.log(`openings=${entries.length} failures=${failures} -> ${out}`);
