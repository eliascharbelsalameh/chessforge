// Settings: preferences, cross-device sync, backup, licenses.
import { el, clear, toast, modal } from '../util.js';
import * as state from '../state.js';

export async function render(container) {
  const s = state.get();

  const showDests = toggle('Show legal-move dots', s.settings.showDests, (v) =>
    state.update('settings', (st) => { st.showDests = v; }));
  const animate = toggle('Animate pieces', s.settings.animate, (v) =>
    state.update('settings', (st) => { st.animate = v; }));
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
      showDests, animate),
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
