# Diagram Desk

The **Positions** tab (`public/js/views/positions.js`) rebuilt as one
self-contained HTML page, for sharing as a Claude artifact — a board you can
drag pieces onto to reproduce a position out of a book, play out, and keep.

```sh
node tools/diagram-desk/build.mjs            # -> tools/diagram-desk/diagram-desk.html (gitignored)
node tools/diagram-desk/build.mjs /tmp/x.html
```

The build inlines `public/vendor/chess.js`, `chessground.min.js` and the three
chessground stylesheets, rewriting each module's `export` into a global. The
output loads nothing from the network, which is what the artifact sandbox
requires.

## What differs from the app

| | ChessForge | Diagram Desk |
| --- | --- | --- |
| Opponent | Stockfish 18 lite (7 MB WASM worker) | `app.js`: alpha-beta + piece-square tables, 5 levels |
| Analysis | the Analysis tab (MultiPV, eval bar) | **Evaluate** — score, bar and a 5-move line, in place |
| Storage | `/api/state` sync + localStorage | localStorage only, plus JSON export/import |

Stockfish cannot come along: the artifact must be a single file with no
fetches, and a 7 MB WASM blob base64-encoded into the page is neither.
Everything else — the editor, castling/turn/FEN handling, the legality checks
from `public/js/setup.js`, the saved library with per-position records, the
human pacing from `public/js/pacing.js` — is the same behaviour, reimplemented
without the module system.

`page.html` holds the markup with `/*__PLACEHOLDER__*/` slots, `style.css` the
design (light and dark, since the artifact renders in the viewer's theme), and
`app.js` the whole application in one IIFE.
