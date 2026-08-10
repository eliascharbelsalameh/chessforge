// Voiceover for lessons, via the browser's built-in speechSynthesis.
// Nothing leaves the device — same rule as the engine.
//
// The interesting half is turning lesson prose into something worth listening
// to: "Nxe5+" read literally is "en ex ee five plus". The helpers below are
// pure so tools/test_all.mjs can check them without a browser; only the Speech
// singleton at the bottom touches window.

const PIECE_WORDS = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', times: '×', frac12: 'a half',
};

// "e4" spoken as two tokens reads as "e four"; glued it becomes "ee-four".
const square = (sq) => `${sq[0]} ${sq[1]}`;

const SAN_RE = /^(?:([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBN]))?|(O-O-O|O-O|0-0-0|0-0))([+#])?$/;

/** "Nxe5+" -> "knight takes e 5, check". Returns null if it isn't a move. */
export function sanToWords(san) {
  const m = SAN_RE.exec(String(san || '').trim());
  if (!m) return null;
  const [, piece, fromFile, fromRank, capture, dest, promo, castle, suffix] = m;
  let out;
  if (castle) {
    out = castle.length > 3 ? 'castles queenside' : 'castles kingside';
  } else {
    const parts = [];
    if (piece) parts.push(PIECE_WORDS[piece]);
    if (fromFile) parts.push(fromFile);
    if (fromRank) parts.push(fromRank);
    if (capture) parts.push('takes');
    parts.push(square(dest));
    if (promo) parts.push(`, promotes to ${PIECE_WORDS[promo]}`);
    out = parts.join(' ').replace(' ,', ',');
  }
  if (suffix === '+') out += ', check';
  else if (suffix === '#') out += ', checkmate';
  return out;
}

// Only expand a token when it stands alone in the sentence, so "Bad" and
// "e.g." survive while "1.e4" and "(Bxh7+)" are read properly.
const INLINE_SAN = /(?<=^|[\s(["'“‘.—–-])(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?=$|[\s)\]"'”’.,;:!?—–-])/g;

export function expandNotation(text) {
  return String(text).replace(INLINE_SAN, (tok) => sanToWords(tok) || tok);
}

export function decodeEntities(text) {
  return String(text).replace(/&(#?\w+);/g, (whole, name) => (name in ENTITIES ? ENTITIES[name] : whole));
}

/** Lesson HTML -> a plain sentence stream fit for a speech engine. */
export function speakableText(html) {
  let t = String(html || '');
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<\/(p|li|ol|ul|h[1-6]|div|tr)>/gi, '. ');
  t = t.replace(/<br\s*\/?>/gi, '. ');
  t = t.replace(/<[^>]+>/g, '');
  t = decodeEntities(t);
  t = expandNotation(t);
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s+([.,;:!?])/g, '$1');
  t = t.replace(/\.(\s*\.)+/g, '.');          // collapse the runs the tag swap leaves
  return t.trim();
}

/** Split into utterance-sized pieces: Chrome cuts off long ones. */
export function chunkText(text, maxLen = 180) {
  const out = [];
  let buf = '';
  for (const sentence of String(text).split(/(?<=[.!?…])\s+/)) {
    for (const piece of sentence.length > maxLen ? sentence.match(new RegExp(`.{1,${maxLen}}(\\s|$)`, 'g')) || [sentence] : [sentence]) {
      const s = piece.trim();
      if (!s) continue;
      if (!buf) buf = s;
      else if (buf.length + s.length + 1 <= maxLen) buf += ' ' + s;
      else { out.push(buf); buf = s; }
    }
  }
  if (buf) out.push(buf);
  return out;
}

class Speech {
  constructor() {
    this.token = 0;
    this.speaking = false;
    this._voices = null;
  }

  get synth() {
    return typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
  }

  supported() { return !!this.synth; }

  // getVoices() is empty until the engine warms up in Chrome.
  voices() {
    const synth = this.synth;
    if (!synth) return Promise.resolve([]);
    const now = synth.getVoices();
    if (now.length) { this._voices = now; return Promise.resolve(now); }
    return new Promise((resolve) => {
      const done = () => { this._voices = synth.getVoices(); resolve(this._voices); };
      synth.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1200);
    });
  }

  pickVoice(voiceURI) {
    const list = this._voices || (this.synth ? this.synth.getVoices() : []);
    return list.find((v) => v.voiceURI === voiceURI) || null;
  }

  cancel() {
    this.token++;
    this.speaking = false;
    try { this.synth && this.synth.cancel(); } catch { /* nothing playing */ }
  }

  /**
   * Speak text, replacing anything already queued.
   * Resolves when the last chunk finishes (or is cancelled / fails), so callers
   * can wait for the narration before moving pieces.
   */
  speak(text, { rate = 1, pitch = 1, voiceURI = '' } = {}) {
    const synth = this.synth;
    const chunks = synth ? chunkText(speakableText(text)) : [];
    if (!chunks.length) return Promise.resolve(false);
    this.cancel();
    const token = this.token;
    const voice = voiceURI ? this.pickVoice(voiceURI) : null;
    this.speaking = true;
    return new Promise((resolve) => {
      let guards = [];
      const finish = (val) => {
        guards.forEach(clearTimeout);
        guards = [];
        if (token !== this.token) return resolve(false);
        this.speaking = false;
        resolve(val);
      };
      const utterances = chunks.map((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.rate = rate; u.pitch = pitch;
        // A voice saved on another device/browser may no longer be valid here.
        try { if (voice) { u.voice = voice; u.lang = voice.lang; } } catch { /* default voice */ }
        if (i === chunks.length - 1) {
          u.addEventListener('end', () => finish(true));
          u.addEventListener('error', () => finish(false));
        }
        return u;
      });
      // A browser with no voices installed accepts utterances and plays
      // nothing, so callers waiting on narration would wait forever. Give up
      // if audio never starts, and keep a long stop-loss on the whole run.
      let started = false;
      utterances[0].addEventListener('start', () => { started = true; });
      guards.push(setTimeout(() => { if (!started) finish(false); }, 1000));
      guards.push(setTimeout(() => finish(false), 4000 + chunks.join(' ').length * 120));
      // Never reject: callers gate lesson playback on this promise.
      try { utterances.forEach((u) => synth.speak(u)); } catch { finish(false); }
    });
  }
}

export const speech = new Speech();

// Voice options as stored in settings -> what speak() wants.
export function voiceOptions(settings = {}) {
  return { rate: settings.voiceRate || 1, voiceURI: settings.voiceURI || '' };
}
