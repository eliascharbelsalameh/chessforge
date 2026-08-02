// Stockfish 18 (lite, single-threaded WASM) wrapper.
// One shared worker, one request at a time — callers queue through run().
// The engine runs entirely in the browser of whatever device is viewing.

const SF_PATH = 'vendor/stockfish/stockfish-18-lite-single.js';

class Engine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.queue = Promise.resolve();
    this.lineHandler = null;
    this.currentResolve = null;
    this.lastOptions = {};
  }

  ensure() {
    if (this.ready) return this.ready;
    this.worker = new Worker(SF_PATH);
    this.ready = new Promise((resolve, reject) => {
      const onMsg = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line === 'uciok') {
          this.worker.removeEventListener('message', onMsg);
          this.worker.addEventListener('message', (ev) => this.onLine(typeof ev.data === 'string' ? ev.data : ''));
          this.send('setoption name Use NNUE value true');
          resolve();
        }
      };
      this.worker.addEventListener('message', onMsg);
      this.worker.addEventListener('error', (e) => reject(new Error('engine failed: ' + e.message)));
      this.send('uci');
      setTimeout(() => reject(new Error('engine init timeout')), 30000);
    });
    return this.ready;
  }

  send(cmd) { this.worker.postMessage(cmd); }

  onLine(line) {
    if (this.lineHandler) this.lineHandler(line);
  }

  // Serialized access to the engine.
  run(job) {
    const p = this.queue.then(() => job()).catch((e) => { console.warn('engine job failed', e); throw e; });
    this.queue = p.catch(() => {});
    return p;
  }

  async setOptions(opts) {
    for (const [name, value] of Object.entries(opts)) {
      if (this.lastOptions[name] !== value) {
        this.send(`setoption name ${name} value ${value}`);
        this.lastOptions[name] = value;
      }
    }
  }

  /**
   * Search a position.
   * @param {object} spec {fen, moves?: uci[], movetime?, depth?, multipv?, skill?, elo?, onInfo?}
   * @returns {Promise<{bestmove, lines: [{multipv, score:{cp?,mate?}, depth, pvUci[]}]}>}
   */
  search(spec) {
    return this.run(async () => {
      await this.ensure();
      const multipv = spec.multipv || 1;
      await this.setOptions({
        'Skill Level': spec.skill != null ? spec.skill : 20,
        MultiPV: multipv,
        ...(spec.elo
          ? { UCI_LimitStrength: 'true', UCI_Elo: spec.elo }
          : { UCI_LimitStrength: 'false' }),
      });
      const pos = `position fen ${spec.fen}${spec.moves && spec.moves.length ? ' moves ' + spec.moves.join(' ') : ''}`;
      this.send(pos);
      const lines = [];
      return new Promise((resolve) => {
        this.lineHandler = (line) => {
          if (line.startsWith('info ') && line.includes(' pv ')) {
            const info = parseInfo(line);
            if (info) {
              lines[info.multipv - 1] = info;
              spec.onInfo && spec.onInfo(lines.filter(Boolean));
            }
          } else if (line.startsWith('bestmove')) {
            this.lineHandler = null;
            const bestmove = line.split(/\s+/)[1];
            resolve({ bestmove: bestmove === '(none)' ? null : bestmove, lines: lines.filter(Boolean) });
          }
        };
        if (spec.depth) this.send(`go depth ${spec.depth}`);
        else this.send(`go movetime ${spec.movetime || 800}`);
      });
    });
  }

  // Ask for engine's move at a given playing strength.
  bestMove(fen, moves, { skill = 20, movetime = 400, elo = null } = {}) {
    return this.search({ fen, moves, movetime, skill, elo, multipv: 1 }).then((r) => r.bestmove);
  }

  // Quick evaluation of a position (white POV score).
  async quickEval(fen, { movetime = 300, depth = null } = {}) {
    const r = await this.search({ fen, movetime, depth, multipv: 1 });
    const line = r.lines[0];
    if (!line) return null;
    // engine reports from side-to-move POV; normalize to white POV
    const stm = fen.split(' ')[1];
    const score = { ...line.score };
    if (stm === 'b') {
      if (score.cp != null) score.cp = -score.cp;
      if (score.mate != null) score.mate = -score.mate;
    }
    return { score, bestmove: r.bestmove, pvUci: line.pvUci };
  }

  stopSearch() {
    if (this.worker) this.send('stop');
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.ready = null;
      this.lastOptions = {};
    }
  }
}

function parseInfo(line) {
  const t = line.split(/\s+/);
  const info = { multipv: 1, depth: 0, score: {}, pvUci: [] };
  for (let i = 0; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': info.depth = +t[++i]; break;
      case 'multipv': info.multipv = +t[++i]; break;
      case 'score':
        if (t[i + 1] === 'cp') { info.score.cp = +t[i + 2]; i += 2; }
        else if (t[i + 1] === 'mate') { info.score.mate = +t[i + 2]; i += 2; }
        break;
      case 'pv': info.pvUci = t.slice(i + 1); i = t.length; break;
    }
  }
  if (info.score.cp == null && info.score.mate == null) return null;
  return info;
}

export const engine = new Engine();

// difficulty presets for play & drills
export const LEVELS = [
  { n: 1, label: 'Beginner (~600)', skill: 0, movetime: 60 },
  { n: 2, label: 'Casual (~900)', skill: 2, movetime: 90 },
  { n: 3, label: 'Improver (~1200)', skill: 5, movetime: 120 },
  { n: 4, label: 'Club (~1500)', skill: 8, movetime: 160 },
  { n: 5, label: 'Strong club (~1800)', skill: 11, movetime: 220 },
  { n: 6, label: 'Expert (~2000)', skill: 14, movetime: 280 },
  { n: 7, label: 'Master (~2300)', skill: 17, movetime: 350 },
  { n: 8, label: 'Maximum', skill: 20, movetime: 500 },
];
