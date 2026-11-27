// Popup: quick actions, capture progress and recording controls.
import { $, h, icon, send, applyTheme, toast } from '../shared/ui.js';
import { getSettings, saveSettings } from '../shared/settings.js';
import { listItems, getBlob } from '../storage/db.js';
import { restrictionReason } from '../screenshot/capture-controller.js';
import { formatDuration, formatBytes } from '../shared/format.js';

const main = $('#main');
let tab = null; let settings = null;
let view = 'home'; // home | record-setup

function openApp(hash) { chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#${hash}`) }); window.close(); }

async function permissionState(name) {
  try { return (await navigator.permissions.query({ name })).state; } catch { return 'prompt'; }
}

function tabInfo() {
  if (!tab) return h('div', { class: 'notice' }, 'No active tab.');
  const fav = tab.favIconUrl && /^https?:/.test(tab.favIconUrl) ? h('img', { src: tab.favIconUrl, alt: '' }) : h('span', { html: icon('page') });
  return h('div', { class: 'tab-info' }, fav,
    h('div', { class: 'grow' }, h('div', { class: 't', title: tab.title }, tab.title || 'Untitled'), h('div', { class: 'u', title: tab.url }, tab.url || '')));
}

async function renderHome() {
  const reason = tab ? restrictionReason(tab.url) : 'No tab';
  const capState = (await send('capture:get-state').catch(() => null));
  main.replaceChildren(tabInfo());
  if (capState?.busy && capState.state?.active) return renderCaptureProgress(capState.state);
  if (capState?.state?.phase === 'error' && Date.now() - (capState.state.finishedAt || 0) < 15000) {
    main.append(h('div', { class: 'notice error' }, capState.state.error));
  }
  if (reason) main.append(h('div', { class: 'notice warn' }, reason, ' ', h('span', { class: 'muted' }, 'Screen recording is still available.')));

  const capBtn = h('button', { class: 'hero-btn capture', id: 'capture-full', disabled: !!reason, html: `${icon('page')}<span>CAPTURE FULL PAGE</span><small>Entire page · HD · JPG / PDF</small>` });
  capBtn.addEventListener('click', () => startCapture('full'));
  const recBtn = h('button', { class: 'hero-btn record', id: 'record', html: `${icon('record')}<span>RECORD SCREEN</span><small>Tab or screen · mic · webcam</small>` });
  recBtn.addEventListener('click', () => { view = 'record-setup'; render(); });
  main.append(h('div', { class: 'heroes' }, capBtn, recBtn));

  const act = (id, ic, label, fn, disabled = false) => {
    const b = h('button', { class: 'btn', id, disabled, html: `${icon(ic)}<span>${label}</span>` }); b.addEventListener('click', fn); return b;
  };
  main.append(h('div', { class: 'actions' },
    act('capture-visible', 'visible', 'Capture Visible Screen', () => startCapture('visible'), !tab || /^(chrome|edge|about|devtools):/i.test(tab.url || '') && !/^chrome:\/\/newtab/.test(tab.url)),
    act('open-editor', 'editor', 'Open Video Editor', () => openApp('editor')),
    act('open-history', 'history', 'Capture History', () => openApp('history')),
    act('open-settings2', 'settings', 'Settings', () => openApp('settings'))));

  const items = (await listItems().catch(() => [])).slice(0, 3);
  if (items.length) {
    const grid = h('div', { class: 'recent' });
    for (const it of items) {
      const a = h('a', { href: '#', title: it.title });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL(it.kind === 'video' ? `video-editor.html?id=${it.id}` : `screenshot.html?id=${it.id}`) });
        window.close();
      });
      if (it.thumbKey) getBlob(it.thumbKey).then((b) => { if (b) a.prepend(h('img', { src: URL.createObjectURL(b), alt: '' })); });
      a.append(h('span', {}, it.kind === 'video' ? `▶ ${formatDuration(it.duration)}` : `${it.width}×${it.height}`));
      grid.append(a);
    }
    main.append(h('div', { class: 'col' }, h('div', { class: 'row' }, h('b', { class: 'grow small' }, 'Recent captures'), h('a', { href: '#', class: 'small', onclick: (e) => { e.preventDefault(); openApp('history'); } }, 'View all')), grid));
  }
}

function renderCaptureProgress(st) {
  main.replaceChildren(tabInfo());
  const labels = { starting: 'Starting…', preparing: 'Preparing page…', loading: 'Loading lazy content…', capturing: 'Capturing', finalizing: 'Finalizing image…' };
  const pct = Math.round((st.progress || 0) * 100);
  const cancel = h('button', { class: 'btn danger', id: 'cancel-capture' }, 'Cancel');
  cancel.addEventListener('click', () => send('capture:cancel'));
  main.append(h('div', { class: 'card col' },
    h('div', { class: 'row' }, h('b', { class: 'grow' }, `${labels[st.phase] || 'Working…'} ${st.phase === 'capturing' ? `${pct}%` : ''}`), st.frames ? h('span', { class: 'muted small' }, `${st.frames} frames`) : null),
    h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })),
    h('div', { class: 'muted small' }, 'Keep this tab visible. You can close this popup; press Esc on the page to cancel.'),
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, cancel)));
}

async function startCapture(mode) {
  try {
    await send('capture:start', { mode, tabId: tab?.id });
    if (mode === 'visible') { toast('Capturing…'); }
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------- recording setup ----------------
async function renderRecordSetup() {
  settings = await getSettings();
  const reason = tab ? restrictionReason(tab.url) : 'No tab';
  let source = reason ? 'screen' : settings.recSource;
  const seg = (name, options, value, onChange) => {
    const el = h('div', { class: 'seg', id: name });
    for (const [v, label] of options) {
      const b = h('button', { class: v === value ? 'sel' : '' }, label);
      b.addEventListener('click', () => { [...el.children].forEach((c) => c.classList.remove('sel')); b.classList.add('sel'); onChange(v); });
      el.append(b);
    }
    return el;
  };
  const sel = (id, options, value) => {
    const s = h('select', { id });
    for (const [v, label] of options) s.append(h('option', { value: v, selected: String(v) === String(value) }, label));
    return s;
  };
  const audio = sel('rec-audio', [['none', 'No audio'], ['mic', 'Microphone only'], ['tab', 'Tab / system audio'], ['both', 'Microphone + tab/system']], settings.recAudio);
  const res = sel('rec-res', [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K (if supported)'], ['source', 'Source (max)']], settings.recResolution);
  const fps = sel('rec-fps', [[24, '24 FPS'], [30, '30 FPS'], [60, '60 FPS']], settings.recFps);
  const cd = sel('rec-cd', [[0, 'No countdown'], [3, '3 s countdown'], [5, '5 s countdown'], [10, '10 s countdown']], settings.countdown);
  const cam = h('input', { type: 'checkbox', id: 'rec-cam', checked: settings.webcamEnabled });
  const fxc = h('input', { type: 'checkbox', id: 'rec-clicks', checked: settings.clickEffects });
  const hl = h('input', { type: 'checkbox', id: 'rec-cursor', checked: settings.cursorHighlight });
  const note = h('div', { class: 'muted small' });
  const updNote = () => {
    note.textContent = source === 'tab'
      ? 'Records only this tab’s content (no browser UI). Tab audio is captured directly.'
      : 'Chrome will ask you to choose a screen, window or tab. The extension cannot record without your selection.';
  };
  updNote();
  const start = h('button', { class: 'btn primary', id: 'rec-start', style: { flex: 1, padding: '10px' }, html: `${icon('record')}<span>Start recording</span>` });
  const back = h('button', { class: 'btn' }, 'Back');
  back.addEventListener('click', () => { view = 'home'; render(); });

  start.addEventListener('click', async () => {
    const config = {
      recSource: source, recAudio: audio.value, recResolution: res.value, recFps: Number(fps.value), countdown: Number(cd.value),
      webcamEnabled: cam.checked, clickEffects: fxc.checked, cursorHighlight: hl.checked,
    };
    await saveSettings(config);
    // Microphone / camera permission must be granted on a visible extension page first
    // (the hidden recorder document cannot show permission prompts).
    const needMic = config.recAudio === 'mic' || config.recAudio === 'both';
    const needCam = config.webcamEnabled;
    if ((needMic && (await permissionState('microphone')) !== 'granted') || (needCam && (await permissionState('camera')) !== 'granted')) {
      chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#recorder?grant=${[needMic && 'mic', needCam && 'cam'].filter(Boolean).join(',')}&tab=${tab?.id || ''}`) });
      window.close();
      return;
    }
    start.disabled = true;
    try {
      const r = await send('rec:start', { source, tabId: tab?.id, config });
      if (r?.cancelled) { start.disabled = false; toast('Recording cancelled.'); return; }
    } catch (e) {
      start.disabled = false; toast(e.message, 'error', 6000);
    }
  });

  main.replaceChildren(
    tabInfo(),
    h('div', { class: 'col' }, h('b', {}, 'What to record'),
      seg('rec-source', [['tab', 'Current tab'], ['screen', 'Entire screen / window']], source, (v) => { source = v; updNote(); }),
      note),
    h('div', { class: 'opt-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Audio'), audio),
      h('label', { class: 'field' }, h('span', {}, 'Countdown'), cd),
      h('label', { class: 'field' }, h('span', {}, 'Resolution'), res),
      h('label', { class: 'field' }, h('span', {}, 'Frame rate'), fps)),
    h('div', { class: 'col' },
      h('label', { class: 'check' }, cam, 'Webcam overlay'),
      h('label', { class: 'check' }, fxc, 'Click effects'),
      h('label', { class: 'check' }, hl, 'Cursor highlight')),
    h('div', { class: 'row' }, back, start),
    h('a', { href: '#', class: 'small', onclick: (e) => { e.preventDefault(); openApp('recorder'); } }, 'Advanced recorder settings (quality, webcam layout, devices)…'),
  );
  if (reason) { $('#rec-source').firstChild.disabled = true; }
}

// ---------------- active recording ----------------
function renderRecording(st) {
  const isPaused = st.state === 'paused';
  const ctl = (id, ic, label, fn, cls = '') => { const b = h('button', { class: `btn ${cls}`, id, html: `${icon(ic)}<span>${label}</span>` }); b.addEventListener('click', fn); return b; };
  const header = st.state === 'countdown'
    ? h('div', { class: 'rec-time' }, `Starting in ${st.countdown}…`)
    : st.state === 'preparing' || st.state === 'starting' ? h('div', { class: 'rec-time' }, 'Starting…')
      : st.state === 'stopping' ? h('div', { class: 'rec-time' }, 'Saving…')
        : h('div', { class: 'row' }, h('span', { class: `badge ${isPaused ? '' : 'rec'}` }, isPaused ? 'PAUSED' : '● REC'), h('div', { class: 'rec-time grow' }, formatDuration(st.elapsed)));
  const info = h('div', { class: 'muted small' },
    `${st.source === 'tab' ? 'Tab' : 'Screen'} · ${st.width || '?'}×${st.height || '?'}${st.fps ? ` · ${st.fps} fps` : ''} · ${formatBytes(st.bytes)}`);
  const meter = st.hasMic ? h('div', { class: 'col' }, h('span', { class: 'small muted' }, st.muted ? 'Microphone muted' : 'Microphone level'), h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round((st.muted ? 0 : st.micLevel || 0) * 100)}%` } }))) : null;
  const controls = h('div', { class: 'rec-controls' },
    ctl('rec-pause', isPaused ? 'play' : 'pause', isPaused ? 'Resume' : 'Pause', () => send(isPaused ? 'rec:resume' : 'rec:pause')),
    ctl('rec-stop', 'stop', 'Stop & save', () => send('rec:stop'), 'primary'),
    ctl('rec-mute', st.muted ? 'micOff' : 'mic', st.muted ? 'Unmute' : 'Mute mic', () => send('rec:mute', { muted: !st.muted })),
    ctl('rec-annotate', 'pen', 'Annotate', () => send('rec:annotate-toggle').then(() => window.close())),
    ctl('rec-shot', 'camera', 'Screenshot', () => send('rec:screenshot').then(() => toast('Screenshot saved', 'ok'))),
    ctl('rec-cancel', 'x', 'Discard', () => { if (confirm('Discard this recording?')) send('rec:cancel'); }, 'danger'));
  if (!st.hasMic) controls.querySelector('#rec-mute').disabled = true;
  if (st.state !== 'recording' && st.state !== 'paused') controls.querySelectorAll('button:not(#rec-cancel):not(#rec-stop)').forEach((b) => { b.disabled = true; });
  const warn = (st.warnings || []).length ? h('div', { class: 'notice warn small' }, st.warnings.join(' ')) : null;
  main.replaceChildren(h('div', { class: 'card rec-card' }, header, info, meter, controls, warn),
    h('div', { class: 'muted small' }, 'Shortcuts: ', h('kbd', {}, 'Alt+Shift+K'), ' pause · ', h('kbd', {}, 'Alt+Shift+S'), ' stop'));
}

async function render() {
  const { recState } = await chrome.storage.session.get('recState');
  if (recState?.active) return renderRecording(recState);
  if (view === 'record-setup') return renderRecordSetup();
  return renderHome();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes.recState) {
    const st = changes.recState.newValue;
    if (st?.active) renderRecording(st);
    else if (changes.recState.oldValue?.active) { view = 'home'; render(); if (st?.error) toast(st.error, 'error', 6000); }
  }
  if (changes.captureState) {
    const st = changes.captureState.newValue;
    if (st?.active) renderCaptureProgress(st);
    else if (st?.phase === 'done') window.close();
    else if (st?.phase === 'error') { render(); }
    else render();
  }
});

(async () => {
  await applyTheme();
  $('#open-settings').innerHTML = icon('settings');
  $('#open-settings').addEventListener('click', () => openApp('settings'));
  $('#open-app').addEventListener('click', (e) => { e.preventDefault(); openApp('dashboard'); });
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await render();
})();
