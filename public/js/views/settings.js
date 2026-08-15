// Settings: preferences, cross-device sync, backup, licenses.
import { el, clear, toast, modal } from '../util.js';
import * as state from '../state.js';
import { PACES, DEFAULT_PACE } from '../pacing.js';
import { speech, voiceOptions } from '../speech.js';

const SAMPLE = '<p>After <b>1.e4 e5</b>, <b>Nf3</b> attacks the pawn — and if <b>Nxe5</b>, <b>Qe2</b> pins.</p>';

export async function render(container) {
  const s = state.get();

  const showDests = toggle('Show legal-move dots', s.settings.showDests, (v) =>
    state.update('settings', (st) => { st.showDests = v; }));
  const animate = toggle('Animate pieces', s.settings.animate, (v) =>
    state.update('settings', (st) => { st.animate = v; }));
  // ---- engine pacing ----
  const paceSel = el('select', {}, PACES.map((p) => el('option', { value: p.id, text: p.label })));
  paceSel.value = PACES.some((p) => p.id === s.settings.enginePace) ? s.settings.enginePace : DEFAULT_PACE;
  const paceBlurb = el('p', { class: 'muted small' });
  const showBlurb = () => {
    paceBlurb.textContent = (PACES.find((p) => p.id === paceSel.value) || {}).blurb || '';
  };
  showBlurb();
  paceSel.addEventListener('change', () => {
    state.update('settings', (st) => { st.enginePace = paceSel.value; });
    showBlurb();
  });

  // ---- lesson voiceover ----
  const voiceSel = el('select', {}, el('option', { value: '', text: 'Browser default voice' }));
  const rate = el('input', { type: 'range', min: '0.6', max: '1.4', step: '0.05' });
  rate.value = String(s.settings.voiceRate || 1);
  const rateLabel = el('span', { class: 'muted small', text: `${Number(rate.value).toFixed(2)}×` });
  rate.addEventListener('input', () => { rateLabel.textContent = `${Number(rate.value).toFixed(2)}×`; });
  rate.addEventListener('change', () => state.update('settings', (st) => { st.voiceRate = Number(rate.value); }));
  voiceSel.addEventListener('change', () => state.update('settings', (st) => { st.voiceURI = voiceSel.value; }));

  const voiceover = toggle('Read lessons aloud', s.settings.voiceover, (v) =>
    state.update('settings', (st) => { st.voiceover = v; }));

  const testBtn = el('button', { class: 'btn small', text: '▶ Test voice' });
  testBtn.addEventListener('click', () => {
    speech.speak(SAMPLE, voiceOptions(state.get().settings));
  });

  const voiceNote = el('p', { class: 'muted small' });
  const voiceCard = el('div', { class: 'card' },
    el('h3', { text: 'Lesson voiceover' }),
    el('p', { class: 'muted small', text: 'Lessons can be read aloud, with moves spoken as commentary ("knight takes e 5, check"). Uses your browser\'s built-in speech — no audio is sent anywhere.' }),
    voiceover,
    el('label', { class: 'field mt' }, el('span', { text: 'Voice' }), voiceSel),
    el('label', { class: 'field' }, el('span', { text: 'Speed' }), el('div', { class: 'row' }, rate, rateLabel)),
    el('div', { class: 'row' }, testBtn, voiceNote));

  if (!speech.supported()) {
    voiceNote.textContent = 'This browser has no speech synthesis.';
    [voiceSel, rate, testBtn].forEach((n) => { n.disabled = true; });
  } else {
    speech.voices().then((list) => {
      if (!list.length) {
        voiceNote.textContent = 'No voices installed for this browser yet.';
        return;
      }
      const sorted = [...list].sort((a, b) =>
        (b.lang.startsWith('en') - a.lang.startsWith('en')) || a.name.localeCompare(b.name));
      for (const v of sorted) voiceSel.append(el('option', { value: v.voiceURI, text: `${v.name} (${v.lang})` }));
      voiceSel.value = list.some((v) => v.voiceURI === s.settings.voiceURI) ? s.settings.voiceURI : '';
    });
  }

  const autoSync = toggle('Sync progress with server (all your devices share one profile)', s.settings.autoSync, (v) => {
    state.update('settings', (st) => { st.autoSync = v; });
    if (v) doSync();
  });

  const syncStatus = el('p', { class: 'muted small' });
  const refreshSyncLabel = () => {
    const st = state.getSyncStatus();
    syncStatus.textContent = st.at
      ? (st.ok ? `Last sync: ${new Date(st.at).toLocaleTimeString()} ✓` : 'Last sync failed — server unreachable?')
      : 'Not synced yet this session.';
  };
  refreshSyncLabel();

  const syncBtn = el('button', { class: 'btn small', text: 'Sync now' });
  syncBtn.addEventListener('click', doSync);
  async function doSync() {
    syncBtn.disabled = true;
    const res = await state.syncNow();
    syncBtn.disabled = false;
    refreshSyncLabel();
    toast(res.ok ? 'Synced ✓' : 'Sync failed', res.ok ? 'good' : 'bad');
  }

  const exportBtn = el('button', { class: 'btn', text: 'Export progress (JSON)' });
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([state.exportJSON()], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `chessforge-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const importBtn = el('button', { class: 'btn', text: 'Import progress' });
  importBtn.addEventListener('click', () => {
    const input = el('input', { type: 'file', accept: 'application/json' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        state.importJSON(await file.text());
        toast('Progress imported ✓', 'good');
        setTimeout(() => location.reload(), 600);
      } catch { toast('Invalid backup file', 'bad'); }
    });
    input.click();
  });

  const resetBtn = el('button', { class: 'btn danger-ghost', text: 'Reset ALL progress' });
  resetBtn.addEventListener('click', () => {
    const m = modal(el('div', {},
      el('h3', { text: 'Reset everything?' }),
      el('p', { class: 'muted', text: 'Rating, streaks, learned lines, lesson and drill progress — gone. This also overwrites the server copy.' }),
      el('div', { class: 'btn-row mt' },
        (() => { const b = el('button', { class: 'btn danger-ghost', text: 'Yes, reset' }); b.addEventListener('click', () => { state.resetAll(); m.close(); toast('Progress reset'); setTimeout(() => location.reload(), 500); }); return b; })(),
        (() => { const b = el('button', { class: 'btn primary', text: 'Keep my progress' }); b.addEventListener('click', () => m.close()); return b; })())));
  });

  container.append(
    el('div', { class: 'page-head' }, el('h1', { text: 'Settings' })),
    el('div', { class: 'card' },
      el('h3', { text: 'Board & play' }),
      showDests, animate,
      el('label', { class: 'field mt' }, el('span', { text: 'Engine move speed' }), paceSel),
      paceBlurb),
    voiceCard,
    el('div', { class: 'card' },
      el('h3', { text: 'Cross-device sync' }),
      el('p', { class: 'muted small', text: 'Progress saves in this browser and syncs to your server, so phone, tablet and laptop continue from the same place.' }),
      autoSync,
      el('div', { class: 'row mt' }, syncBtn, syncStatus)),
    el('div', { class: 'card' },
      el('h3', { text: 'Backup' }),
      el('div', { class: 'btn-row' }, exportBtn, importBtn, resetBtn)),
    el('div', { class: 'card' },
      el('h3', { text: 'About' }),
      el('div', { class: 'prose small muted', html:
        `<p>ChessForge — a self-hosted chess learning platform. Everything runs on your server and in your browser; no third-party services.</p>
         <p>Built with open source:</p>
         <ul>
           <li><b>chess.js</b> (BSD-2) — rules &amp; move validation</li>
           <li><b>Chessground</b> (GPL-3.0) — the board, from Lichess</li>
           <li><b>Stockfish 18 lite</b> (GPL-3.0) — WASM engine, runs client-side</li>
           <li><b>Lichess puzzle database</b> (CC0) — 33,000 curated tactics</li>
           <li><b>lichess-org/chess-openings</b> (CC0) — 3,800+ named openings</li>
         </ul>
         <p>License texts ship in <code>/vendor/</code>.</p>` })));
}

function toggle(label, value, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'row', style: 'padding:.35rem 0; cursor:pointer' }, input, el('span', { text: label }));
}

export function destroy() {}
