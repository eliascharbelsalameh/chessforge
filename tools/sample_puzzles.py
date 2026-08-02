#!/usr/bin/env python3
"""Stratified sampler for the Lichess puzzle database (CC0).

Reads the decompressed CSV on stdin, reservoir-samples high-quality puzzles
per rating band, and writes compact JSON files the app lazy-loads per band.

CSV columns:
PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
"""
import csv, json, os, random, sys

OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "public/data/puzzles"
PER_BAND = 3000
BANDS = [(0, 800), (800, 1000), (1000, 1200), (1200, 1400), (1400, 1600),
         (1600, 1800), (1800, 2000), (2000, 2200), (2200, 2400), (2400, 2700), (2700, 9999)]

random.seed(42)
reservoirs = [[] for _ in BANDS]
seen = [0] * len(BANDS)
theme_counts = {}
total = kept_candidates = 0

def band_index(rating):
    for i, (lo, hi) in enumerate(BANDS):
        if lo <= rating < hi:
            return i
    return None

reader = csv.reader(sys.stdin)
header = next(reader)
for row in reader:
    total += 1
    try:
        pid, fen, moves, rating, rd, pop, plays, themes = (
            row[0], row[1], row[2], int(row[3]), int(row[4]), int(row[5]), int(row[6]), row[7])
    except (ValueError, IndexError):
        continue
    # quality gates: well-established rating, liked by players, enough plays
    if rating >= 2400:
        if plays < 30 or pop < 40 or rd > 110:
            continue
    else:
        if plays < 150 or pop < 70 or rd > 90:
            continue
    bi = band_index(rating)
    if bi is None:
        continue
    kept_candidates += 1
    seen[bi] += 1
    entry = [pid, fen, moves, rating, themes]
    if len(reservoirs[bi]) < PER_BAND:
        reservoirs[bi].append(entry)
    else:
        j = random.randrange(seen[bi])
        if j < PER_BAND:
            reservoirs[bi][j] = entry

os.makedirs(OUT, exist_ok=True)
manifest = {"bands": [], "themes": {}}
for (lo, hi), res in zip(BANDS, reservoirs):
    res.sort(key=lambda e: e[3])
    name = f"band-{lo}"
    with open(os.path.join(OUT, name + ".json"), "w") as f:
        json.dump(res, f, separators=(",", ":"))
    manifest["bands"].append({"file": name + ".json", "lo": lo, "hi": hi, "count": len(res)})
    for e in res:
        for t in e[4].split():
            theme_counts[t] = theme_counts.get(t, 0) + 1

manifest["themes"] = dict(sorted(theme_counts.items(), key=lambda kv: -kv[1]))
with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(manifest, f, separators=(",", ":"))

sampled = sum(len(r) for r in reservoirs)
print(f"rows={total} candidates={kept_candidates} sampled={sampled}")
for (lo, hi), res in zip(BANDS, reservoirs):
    print(f"  band {lo}-{hi}: {len(res)}")
