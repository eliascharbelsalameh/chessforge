// Lazy loaders for the generated datasets (puzzles by rating band, openings).

let manifestP = null;
const bandCache = new Map();

export function puzzleManifest() {
  if (!manifestP) manifestP = fetch('data/puzzles/manifest.json').then((r) => r.json());
  return manifestP;
}

async function loadBand(lo) {
  if (!bandCache.has(lo)) {
    bandCache.set(lo, fetch(`data/puzzles/band-${lo}.json`).then((r) => r.json()).then((rows) =>
      rows.map(([id, fen, moves, rating, themes]) => ({
        id, fen, rating,
        moves: moves.split(' '),
        themes: themes.split(' '),
      }))));
  }
  return bandCache.get(lo);
}

async function bandsFor(lo, hi) {
  const man = await puzzleManifest();
  return man.bands.filter((b) => b.hi > lo && b.lo < hi);
}

/**
 * Pick a puzzle near a target rating.
 * @param {object} o {target, spread, theme, exclude: (id)=>bool}
 */
export async function pickPuzzle({ target = 1200, spread = 200, theme = null, exclude = () => false } = {}) {
  for (let s = spread; s <= 1600; s += 200) {
    const bands = await bandsFor(target - s, target + s);
    let pool = [];
    for (const b of bands) pool = pool.concat(await loadBand(b.lo));
    pool = pool.filter((p) => Math.abs(p.rating - target) <= s && !exclude(p.id) &&
      (!theme || p.themes.includes(theme)));
    if (pool.length > 0) {
      // prefer puzzles closest to target: weight by closeness
      pool.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target));
      const slice = pool.slice(0, Math.max(20, Math.floor(pool.length / 4)));
      return slice[Math.floor(Math.random() * slice.length)];
    }
  }
  return null;
}

export async function countTheme(theme) {
  const man = await puzzleManifest();
  return man.themes[theme] || 0;
}

// ---------- openings ----------
let openingsP = null;

export function loadOpenings() {
  if (!openingsP) {
    openingsP = fetch('data/openings.json').then((r) => r.json()).then((data) => {
      const entries = data.entries.map(([eco, name, san, uci, epd]) => ({
        eco, name, epd,
        san: san.split(' '),
        uci: uci.split(' '),
      }));
      // longest-prefix opening detection: map "e2e4 e7e5 ..." -> entry
      const byUci = new Map();
      for (const e of entries) byUci.set(e.uci.join(' '), e);
      return {
        entries,
        byUci,
        detect(ucis) {
          for (let n = Math.min(ucis.length, 36); n > 0; n--) {
            const hit = byUci.get(ucis.slice(0, n).join(' '));
            if (hit) return hit;
          }
          return null;
        },
        search(q) {
          q = q.trim().toLowerCase();
          if (!q) return [];
          const terms = q.split(/\s+/);
          return entries.filter((e) => {
            const hay = (e.eco + ' ' + e.name).toLowerCase();
            return terms.every((t) => hay.includes(t));
          });
        },
      };
    });
  }
  return openingsP;
}
