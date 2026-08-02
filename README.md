# ♞ ChessForge

A self-hosted chess learning platform: **tactics puzzles, opening repertoires with
spaced repetition, endgame drills vs the engine, a 30-lesson course, play-vs-Stockfish,
and a full analysis board** — all served from this machine, with the engine running
in each device's browser (the server does zero chess computation).

## Access

The app is running as a systemd service on port **8420**:

| From | URL |
|---|---|
| this machine | http://localhost:8420 |
| home/VPN network | http://10.0.0.163:8420 |
| internet | http://89.168.55.202:8420 |

Phone, tablet and laptop all work — the UI is responsive and each device runs its own
Stockfish (WASM, single-threaded lite build, ~7 MB one-time download).

> **If the public URL doesn't load from your devices:** the OS firewall is already
> open (port 8420, persisted), but Oracle Cloud has a second firewall at the VCN
> level. In the OCI console: *Networking → Virtual Cloud Networks → your VCN →
> Security Lists → Default Security List → Add Ingress Rule*: source `0.0.0.0/0`
> (or better, just your own IPs), protocol TCP, destination port `8420`.

> **Note on privacy:** there is no login. Anyone who can reach the port shares the
> same progress profile and sync API. On a public IP, consider restricting the
> ingress rule to your own IP addresses.

## What's inside

- **Puzzles** — 33,000 curated tactics from the Lichess database (CC0), stratified
  from 600 to 2900+ rating. Rated mode tracks your Elo; theme mode drills 37 motifs;
  Streak mode ramps difficulty until you miss.
- **Openings** — two parts:
  - *Repertoires*: 8 annotated repertoires (Italian, London, Scotch for White;
    Caro-Kann, 1…e5, QGD, King's Indian, Accelerated Dragon for Black), 29 lines with
    move-by-move coaching. Learn mode guides you; review mode quizzes you on a
    spaced-repetition schedule (1→3→7→16→35→75→150 days).
  - *Explorer*: all 3,807 named openings (ECO A00–E99), searchable, steppable,
    launchable into play or analysis.
- **Endgames** — 16 essential positions (K+P opposition, Lucena, Philidor, queen vs
  pawn, wrong bishop, fortresses, the basic mates…) played out against full-strength
  Stockfish with theory, progressive hints, and a blunder-guard that offers takebacks.
- **Lessons** — 30 interactive lessons in 5 tracks (Fundamentals, Tactics, Checkmate
  patterns, Strategy, Endgame principles) with guided demos — including the Opera
  Game and Philidor's Legacy — and on-board challenges. Each links to matching
  puzzle-theme practice.
- **Play** — 8 strength levels (~600 to maximum), any color, any starting FEN,
  hints and takebacks.
- **Analysis** — multi-line engine analysis with eval bar, PGN/FEN import/export,
  opening detection, "play from here".
- **Sync** — progress lives in the browser (localStorage) and syncs through the
  server (`userdata/state.json`), so all your devices share one profile. Export /
  import / reset in Settings.

## Operations

```bash
sudo systemctl status chessforge     # status
sudo systemctl restart chessforge    # restart
journalctl -u chessforge -f          # logs
PORT=9000 node server.js             # run manually on another port
```

- Server: `server.js` — zero-dependency Node (static files + gzip + sync API).
- Progress data: `userdata/state.json` (back it up if you care about streaks).
- Config: port via `PORT` env var (edit `deploy/chessforge.service`).

## Rebuilding data

```bash
# openings.json from the TSV sources in tools/openings-src/
npm run build:openings

# resample puzzles from a fresh Lichess dump
curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
zstd -dc lichess_db_puzzle.csv.zst | python3 tools/sample_puzzles.py --out public/data/puzzles
```

## Tests

```bash
npm test        # 1,371 checks: replays every repertoire line, lesson step and
                # drill FEN through chess.js, validates puzzle/opening data,
                # unit-tests Elo/SRS logic, syntax-checks every module
```

A Playwright smoke suite (route rendering, engine boot, gameplay, mobile viewport)
was run during development; see the session scratchpad if you want to re-create it.

## Credits & licenses

| Component | License | Role |
|---|---|---|
| [chess.js](https://github.com/jhlywa/chess.js) | BSD-2 | rules & validation |
| [Chessground](https://github.com/lichess-org/chessground) | GPL-3.0 | board UI (from Lichess) |
| [Stockfish.js 18 lite](https://github.com/nmrugg/stockfish.js) | GPL-3.0 | engine (client-side WASM) |
| [Lichess puzzle DB](https://database.lichess.org/#puzzles) | CC0 | 33k tactics |
| [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) | CC0 | opening names/lines |

App code: GPL-3.0 (required by Chessground/Stockfish). License texts are in `public/vendor/`.
