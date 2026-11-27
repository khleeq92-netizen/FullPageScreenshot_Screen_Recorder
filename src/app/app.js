// Dashboard application (app.html): hash-routed views.
import { $, $$, h, icon, send, toast, applyTheme } from '../shared/ui.js';
import { getSettings, saveSettings } from '../shared/settings.js';
import { listItems, putItem, putBlob, newId } from '../storage/db.js';
import { capturableTabs, tabSelect, startTabCapture, captureCard, itemUrl } from './common.js';
import { renderRecorder } from '../screen-recorder/recorder-view.js';
import { renderHistory } from '../history/history-view.js';
import { renderSettings } from '../settings/settings-view.js';
import { formatDuration } from '../shared/format.js';

const view = $('#view');
const NAV = {
  dashboard: ['dashboard', 'Dashboard'], studio: ['page', 'Screenshot Studio'], recorder: ['record', 'Screen Recorder'],
  editor: ['editor', 'Video Editor'], history: ['history', 'Capture History'], settings: ['settings', 'Settings'],
};
let cleanup = null;

function head(title, sub, ...right) {
  return h('div', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', {}, title), sub ? h('p', {}, sub) : null), ...right);
}

async function lastWebTab() {
  const tabs = await capturableTabs();
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  return tabs.filter((t) => !win || t.windowId === win.id).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || tabs[0];
}

// ------------------------------------------------------------------ Dashboard
async function renderDashboard() {
  const tabs = await capturableTabs();
  const def = await lastWebTab();
  const sel = tabSelect(tabs, def?.id);
  const capture = h('button', { class: 'hero-btn capture', id: 'dash-capture', html: `${icon('page')}<span>CAPTURE FULL PAGE</span><small>Scrolls and stitches the selected tab at full device resolution</small>` });
  capture.addEventListener('click', async () => {
    try { await startTabCapture(sel.value, 'full'); toast('Capturing… keep the page visible.'); } catch (e) { toast(e.message, 'error', 6000); }
  });
  const record = h('button', { class: 'hero-btn record', id: 'dash-record', html: `${icon('record')}<span>RECORD SCREEN</span><small>Tab, window or entire screen · microphone · webcam</small>` });
  record.addEventListener('click', () => { location.hash = 'recorder'; });
  const sec = (id, ic, label, fn) => { const b = h('button', { class: 'btn', id, html: `${icon(ic)}<span>${label}</span>` }); b.addEventListener('click', fn); return b; };
  const items = (await listItems()).slice(0, 8);
  view.replaceChildren(
    head('FullPage HD Capture', 'Full-page HD screenshots, screen recording and video editing — processed entirely on this computer.'),
    h('div', { class: 'card col', style: { marginBottom: '16px' } },
      h('div', { class: 'row' }, h('b', {}, 'Tab to capture'), sel),
      h('div', { class: 'big-actions' }, capture, record),
      h('div', { class: 'row wrap' },
        sec('dash-visible', 'visible', 'Capture Visible Screen', async () => { try { await startTabCapture(sel.value, 'visible'); } catch (e) { toast(e.message, 'error'); } }),
        sec('dash-editor', 'editor', 'Open Video Editor', () => { location.hash = 'editor'; }),
        sec('dash-history', 'history', 'Recent Captures', () => { location.hash = 'history'; }),
        sec('dash-settings', 'settings', 'Settings', () => { location.hash = 'settings'; })),
      h('div', { class: 'muted small' }, 'Tip: the quickest way is the toolbar icon on the page itself — ', h('kbd', {}, 'Alt+Shift+P'), ' captures the current page.')),
    h('div', { class: 'section-title' }, h('h2', { class: 'grow' }, 'Recent captures'), h('a', { href: '#history' }, 'View all')),
    items.length ? h('div', { class: 'cards' }, items.map((it) => captureCard(it))) : h('div', { class: 'empty' }, 'Nothing captured yet.'),
  );
}

// ------------------------------------------------------------------ Screenshot Studio
async function renderStudio() {
  const s = await getSettings();
  const tabs = await capturableTabs();
  const def = await lastWebTab();
  const sel = tabSelect(tabs, def?.id);
  const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
  const select = (key, opts) => {
    const el = h('select', {});
    for (const [v, l] of opts) el.append(h('option', { value: v, selected: String(s[key]) === String(v) }, l));
    el.addEventListener('change', () => saveSettings({ [key]: typeof s[key] === 'number' ? Number(el.value) : el.value }));
    return el;
  };
  const check = (key, label) => {
    const c = h('input', { type: 'checkbox', checked: !!s[key] });
    c.addEventListener('change', () => saveSettings({ [key]: c.checked }));
    return h('label', { class: 'check' }, c, label);
  };
  const num = (key, min, max, step = 1) => {
    const el = h('input', { type: 'number', min, max, step, value: s[key] });
    el.addEventListener('change', () => saveSettings({ [key]: Math.max(min, Math.min(max, Number(el.value) || s[key])) }));
    return el;
  };
  const progress = h('div', { class: 'card col', id: 'studio-progress', style: { display: 'none' } });
  const go = (mode) => async () => { try { await startTabCapture(sel.value, mode); } catch (e) { toast(e.message, 'error', 6000); } };
  const items = (await listItems()).filter((i) => i.kind === 'screenshot').slice(0, 12);
  view.replaceChildren(
    head('Screenshot Studio', 'Capture options, progress and your screenshots. Exports happen in the preview window.'),
    h('div', { class: 'card col' },
      h('div', { class: 'row' }, h('b', {}, 'Tab'), sel),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', id: 'studio-full', html: `${icon('page')}<span>Capture Entire Page</span>`, onclick: go('full') }),
        h('button', { class: 'btn', id: 'studio-visible', html: `${icon('visible')}<span>Capture Visible Screen</span>`, onclick: go('visible') }),
        h('button', { class: 'btn danger', id: 'studio-cancel', html: `${icon('x')}<span>Cancel Capture</span>`, onclick: () => send('capture:cancel') })),
      h('hr'),
      h('div', { class: 'form-grid' },
        field('Sticky / fixed elements', select('stickyMode', [['minimize', 'Minimise repeated sticky elements'], ['normal', 'Handle normally (as displayed)']])),
        field('Scroll delay (ms)', num('scrollDelay', 0, 5000, 50)),
        field('Maximum capture height (CSS px)', num('maxCaptureHeight', 1000, 500000, 1000)),
        field('Lazy-load step delay (ms)', num('lazyLoadDelay', 50, 3000, 50))),
      h('div', { class: 'row wrap', style: { gap: '18px' } },
        check('lazyLoadPrep', 'Pre-scroll to load lazy content'), check('hideScrollbars', 'Hide scrollbars'), check('captureHorizontal', 'Include horizontal overflow'))),
    progress,
    h('div', { class: 'section-title' }, h('h2', { class: 'grow' }, 'Screenshots')),
    items.length ? h('div', { class: 'cards' }, items.map((it) => captureCard(it, [
      { icon: 'open', label: 'Open', run: (i) => chrome.tabs.create({ url: itemUrl(i) }) },
    ]))) : h('div', { class: 'empty' }, 'No screenshots yet.'),
  );
  const show = (st) => {
    if (!st) return;
    progress.style.display = '';
    if (st.active) {
      const pct = Math.round((st.progress || 0) * 100);
      progress.replaceChildren(h('b', {}, `Capturing “${st.title || ''}” – ${st.phase} ${pct}%`), h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })));
    } else if (st.phase === 'error') progress.replaceChildren(h('div', { class: 'notice error' }, st.error));
    else if (st.phase === 'cancelled') progress.replaceChildren(h('div', { class: 'notice' }, 'Capture cancelled.'));
    else progress.style.display = 'none';
  };
  const l = (ch, area) => { if (area === 'session' && ch.captureState) show(ch.captureState.newValue); };
  chrome.storage.onChanged.addListener(l);
  cleanup = () => chrome.storage.onChanged.removeListener(l);
}

// ------------------------------------------------------------------ Video editor launcher
async function renderEditorList() {
  const vids = (await listItems()).filter((i) => i.kind === 'video');
  const file = h('input', { type: 'file', accept: 'video/webm,video/mp4,video/quicktime,video/x-matroska,.mkv,.webm,.mp4,.mov', style: { display: 'none' } });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    const id = newId('imp');
    const t = toast('Importing video…');
    try {
      const meta = await probeVideo(f);
      await putBlob(`${id}:video`, f);
      await putItem({ id, kind: 'video', title: f.name.replace(/\.[^.]+$/, ''), url: '', createdAt: Date.now(), duration: meta.duration, width: meta.width, height: meta.height, fps: null, format: (f.name.split('.').pop() || 'webm').toLowerCase(), mimeType: f.type, size: f.size, blobKey: `${id}:video`, thumbKey: null, source: 'import', status: 'complete', warnings: [] });
      t.remove();
      chrome.tabs.create({ url: chrome.runtime.getURL(`video-editor.html?id=${id}`) });
      renderEditorList();
    } catch (e) { t.remove(); toast(`Could not import: ${e.message}`, 'error'); }
  });
  view.replaceChildren(
    head('Video Editor', 'Trim, split, crop, annotate and export your recordings. Originals are never modified.',
      h('button', { class: 'btn primary', id: 'import-video', html: `${icon('file')}<span>Open local video file…</span>`, onclick: () => file.click() }), file),
    vids.length ? h('div', { class: 'cards' }, vids.map((it) => captureCard(it, [
      { icon: 'editor', label: 'Edit', run: (i) => chrome.tabs.create({ url: itemUrl(i) }) },
    ]))) : h('div', { class: 'empty' }, 'No recordings yet. Record your screen or open a local video file.'),
  );
}

function probeVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata'; v.muted = true; v.src = url;
    v.onloadedmetadata = () => {
      const done = () => { URL.revokeObjectURL(url); resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); };
      if (v.duration === Infinity) { v.currentTime = 1e9; v.ontimeupdate = () => { v.ontimeupdate = null; done(); }; } else done();
    };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unsupported or damaged video file')); };
  });
}

// ------------------------------------------------------------------ Router
const ROUTES = { dashboard: renderDashboard, studio: renderStudio, recorder: renderRecorder, editor: renderEditorList, history: renderHistory, settings: renderSettings };

async function route() {
  const [name, query] = (location.hash.replace(/^#/, '') || 'dashboard').split('?');
  const key = ROUTES[name] ? name : 'dashboard';
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  $$('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  document.title = `${NAV[key][1]} – FullPage HD Capture`;
  try {
    const r = await ROUTES[key]({ view, params: new URLSearchParams(query || ''), head, setCleanup: (fn) => { cleanup = fn; } });
    if (typeof r === 'function') cleanup = r;
  } catch (e) {
    view.replaceChildren(h('div', { class: 'notice error' }, `Something went wrong: ${e.message}`));
    console.error(e);
  }
}

function updateRecPill(st) {
  const pill = $('#rec-pill');
  if (st?.active) {
    pill.innerHTML = '';
    pill.append(h('a', { href: '#recorder', class: 'badge rec', style: { textDecoration: 'none', padding: '4px 10px' } }, st.state === 'paused' ? '❚❚ Paused' : `● REC ${formatDuration(st.elapsed || 0)}`));
  } else pill.innerHTML = '';
}

(async () => {
  await applyTheme();
  for (const a of $$('.sidebar a')) { const [ic, label] = NAV[a.dataset.route]; a.innerHTML = `${icon(ic)}<span>${label}</span>`; }
  window.addEventListener('hashchange', route);
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'session' && ch.recState) updateRecPill(ch.recState.newValue);
    if (area === 'local' && ch.settings) applyTheme();
  });
  const { recState } = await chrome.storage.session.get('recState');
  updateRecPill(recState);
  route();
})();
