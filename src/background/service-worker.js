// Background service worker: routes messages, orchestrates screenshot capture, and manages the
// recording lifecycle. The actual recording runs in an offscreen document so that it keeps going
// when the popup closes; this worker only holds small state (in chrome.storage.session).
import { getSettings } from '../shared/settings.js';
import { captureFullPage, captureVisible, CaptureError, restrictionReason } from '../screenshot/capture-controller.js';
import { listChunkSets } from '../storage/db.js';

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const setSession = (o) => chrome.storage.session.set(o);
const getSession = async (k) => (await chrome.storage.session.get(k))[k];

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {}); // no listeners is fine
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
  try { await chrome.action.setBadgeTextColor({ color: '#ffffff' }); } catch { /* older Chrome */ }
}

async function openPage(path) {
  const url = chrome.runtime.getURL(path);
  return chrome.tabs.create({ url });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// ---------------------------------------------------------------------------------------------
// Screenshot capture
// ---------------------------------------------------------------------------------------------
let capture = null; // {tabId, cancelled}

async function startCapture({ mode = 'full', tabId = null, openEditor = true } = {}) {
  if (capture) throw new Error('A capture is already in progress.');
  let tab = tabId ? await chrome.tabs.get(tabId) : await activeTab();
  if (!tab) throw new Error('No tab to capture.');
  if (tabId && !tab.active) {
    // Bring the requested tab to the front (captureVisibleTab captures what is visible).
    await chrome.windows.update(tab.windowId, { focused: true });
    tab = await chrome.tabs.update(tab.id, { active: true });
    await new Promise((r) => setTimeout(r, 400));
  }
  const settings = await getSettings();
  capture = { tabId: tab.id, cancelled: false, mode };
  const state = { active: true, mode, tabId: tab.id, title: tab.title, phase: 'starting', progress: 0, startedAt: Date.now() };
  await setSession({ captureState: state });
  broadcast({ type: 'capture:progress', ...state });

  const onProgress = async (p) => {
    Object.assign(state, p);
    await setSession({ captureState: state });
    broadcast({ type: 'capture:progress', ...state });
    const pct = Math.round((p.progress || 0) * 100);
    await setBadge(p.phase === 'loading' ? '…' : `${pct}%`, '#2563eb');
  };

  try {
    const item = mode === 'visible'
      ? await captureVisible(tab, settings, { onProgress })
      : await captureFullPage(tab, settings, { onProgress, isCancelled: () => capture?.cancelled });
    const done = { active: false, mode, phase: 'done', progress: 1, itemId: item.id, finishedAt: Date.now() };
    await setSession({ captureState: done });
    broadcast({ type: 'capture:done', itemId: item.id, item });
    if (openEditor && settings.openEditorAfterCapture !== false) await openPage(`screenshot.html?id=${encodeURIComponent(item.id)}`);
    return item;
  } catch (e) {
    const cancelled = e instanceof CaptureError && e.code === 'cancelled';
    const err = { active: false, mode, phase: cancelled ? 'cancelled' : 'error', error: e.message, code: e.code || 'error', finishedAt: Date.now() };
    await setSession({ captureState: err });
    broadcast({ type: cancelled ? 'capture:cancelled' : 'capture:error', error: e.message, code: e.code });
    if (!cancelled) throw e;
    return null;
  } finally {
    capture = null;
    const r = await getSession('recState');
    if (!r?.active) await setBadge('', null);
  }
}

// ---------------------------------------------------------------------------------------------
// Recording (offscreen document)
// ---------------------------------------------------------------------------------------------
const OFFSCREEN_URL = 'offscreen.html';

async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)] });
  return ctx.length > 0;
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Records the tab/screen with MediaRecorder, mixes audio and composites the webcam overlay.',
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
}

// The recorder runs in one "host" document at a time:
//   'offscreen'     – the offscreen document (tab capture; survives popup/page closing)
//   'window:<req>'  – the recording-control window (screen/window capture: Chrome binds
//                     desktop-capture stream IDs to the document that requested them)
function sendToHost(hostId, msg) {
  return chrome.runtime.sendMessage({ ...msg, target: 'recorder', hostId });
}

// Pending recording-control windows: reqId -> {resolve, windowId}
const pickers = new Map();

/** Open the recording-control window, which shows Chrome's share picker and then hosts the recording. */
async function openRecorderWindow(sources) {
  const reqId = Math.random().toString(36).slice(2);
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`recorder.html?req=${reqId}&sources=${sources.join(',')}`),
    type: 'popup', width: 380, height: 330, focused: true,
  });
  return new Promise((resolve) => {
    pickers.set(reqId, { resolve: (r) => resolve({ ...r, windowId: win.id, hostId: `window:${reqId}` }), windowId: win.id });
  });
}

async function hostAlive(st) {
  if (!st?.hostId) return false;
  if (st.hostId === 'offscreen') return hasOffscreen();
  if (st.hostWindowId == null) return false;
  return chrome.windows.get(st.hostWindowId).then(() => true, () => false);
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  for (const [id, p] of pickers) if (p.windowId === windowId) { pickers.delete(id); p.resolve({ streamId: null, options: {} }); }
  const st = await getSession('recState');
  if (st?.active && st.hostWindowId === windowId) {
    // The control window was closed mid-recording: whatever was written is offered for recovery.
    await setSession({ recState: { active: false, state: 'error', error: 'The recording-control window was closed. Unsaved data can be recovered from Capture History.' } });
    await setBadge('', null);
    if (st.overlayTabId) chrome.tabs.sendMessage(st.overlayTabId, { type: 'overlay:teardown' }).catch(() => {});
  }
});

async function injectOverlay(tabId, settings, mode) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (restrictionReason(tab.url)) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['recording-overlay.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'overlay:init', settings, mode });
    return true;
  } catch {
    return false; // page not scriptable (e.g. chrome://) – recording still works without page effects
  }
}

async function overlayMessage(msg) {
  const st = await getSession('recState');
  if (st?.overlayTabId) chrome.tabs.sendMessage(st.overlayTabId, msg).catch(() => {});
}

/**
 * Start a recording.
 * @param {{source:'tab'|'screen', tabId?:number, streamId?:string, config?:object}} req
 */
async function startRecording(req) {
  const cur = await getSession('recState');
  if (cur?.active) throw new Error('A recording is already in progress.');
  const settings = { ...(await getSettings()), ...(req.config || {}) };
  const source = req.source || settings.recSource;
  let streamId = req.streamId || null;
  let tab = req.tabId ? await chrome.tabs.get(req.tabId).catch(() => null) : await activeTab();
  let canTabAudio = false;
  let viaPicker = false; // tab chosen in Chrome's picker -> desktop media source
  let host = null; // recording-control window when the picker is used

  if (source === 'tab') {
    if (!tab) throw new Error('No tab selected for recording.');
    const reason = restrictionReason(tab.url);
    if (reason && !/^chrome-extension:/.test(tab.url || '')) throw new Error(`${reason} Choose “Entire screen / window” instead.`);
    if (!streamId) {
      try {
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        canTabAudio = true;
      } catch (e) {
        const msg = String(e?.message || e);
        if (/active stream/i.test(msg)) throw new Error('This tab is already being captured. Stop the other capture first.');
        if (!/invoked|activeTab|permission/i.test(msg)) throw new Error(`Tab capture failed: ${msg}`);
        if (!req.allowPicker) {
          throw new Error('Chrome only allows recording a tab directly after you click the extension icon on that tab. Open the popup on the tab you want to record and press Record.');
        }
        // Started from the dashboard: Chrome requires the user to pick the tab in its own share dialog.
        const pick = await openRecorderWindow(['tab', 'audio']);
        if (!pick.streamId) return { cancelled: true };
        streamId = pick.streamId; canTabAudio = !!pick.options?.canRequestAudioTrack; viaPicker = true; host = pick;
      }
    } else canTabAudio = true;
  } else {
    const pick = await openRecorderWindow(req.pickerSources || ['screen', 'window', 'tab', 'audio']);
    if (!pick.streamId) return { cancelled: true };
    streamId = pick.streamId; canTabAudio = !!pick.options?.canRequestAudioTrack; host = pick;
  }

  if (!host) await ensureOffscreen();
  const hostId = host ? host.hostId : 'offscreen';
  let overlayTabId = null;
  const wantsOverlay = settings.showToolbar || settings.cursorHighlight || settings.clickEffects || settings.syntheticCursor;
  if (tab && wantsOverlay && !viaPicker && (source === 'tab' || tab.active)) {
    if (await injectOverlay(tab.id, settings, source)) overlayTabId = tab.id;
  }
  await setSession({
    recState: {
      active: true, state: 'preparing', source, tabId: source === 'tab' ? tab?.id : null, overlayTabId, hostId, hostWindowId: host?.windowId ?? null,
      title: source === 'tab' ? tab?.title : 'Screen recording', url: source === 'tab' ? tab?.url : '', startedAt: Date.now(),
    },
  });
  // Tab capture scales the tab into the requested box; ask for the tab's own aspect ratio and physical
  // pixel size so the video has no letterbox bars and is never upscaled.
  let tabSize = null;
  if (source === 'tab' && !viaPicker && tab) {
    let dpr = 1;
    try { [{ result: dpr }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => devicePixelRatio }); } catch { dpr = (await chrome.tabs.getZoom(tab.id).catch(() => 1)) || 1; }
    if (tab.width && tab.height) tabSize = { width: Math.round(tab.width * dpr), height: Math.round(tab.height * dpr) };
  }
  const res = await sendToHost(hostId, {
    type: 'rec:begin', streamId, source: viaPicker ? 'screen' : source, canTabAudio, settings, tabSize,
    meta: { title: source === 'tab' ? tab?.title : '', url: source === 'tab' ? tab?.url : '' },
  }).catch((e) => ({ ok: false, error: e.message }));
  if (res?.cancelled && host) chrome.windows.remove(host.windowId).catch(() => {});
  if (!res?.ok) {
    await setSession({ recState: { active: false, state: 'error', error: res?.error || 'Recorder failed to start' } });
    if (overlayTabId) chrome.tabs.sendMessage(overlayTabId, { type: 'overlay:teardown' }).catch(() => {});
    await setBadge('', null);
    if (host) chrome.windows.remove(host.windowId).catch(() => {});
    throw new Error(res?.error || 'The recorder failed to start.');
  }
  return { ok: true, ...res };
}

function badgeTime(sec) {
  sec = Math.floor(sec);
  if (sec < 600) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return `${Math.floor(sec / 60)}m`;
}

async function onRecorderStatus(status, hostId) {
  const prev = (await getSession('recState')) || {};
  // Ignore late updates from a recording that already finished, or from a stale host.
  if (!prev.active || (hostId && prev.hostId && hostId !== prev.hostId)) return;
  const next = { ...prev, ...status, active: !['done', 'error', 'cancelled', 'idle'].includes(status.state) };
  await setSession({ recState: next });
  if (status.state === 'countdown') await setBadge(String(status.countdown), '#f59e0b');
  else if (status.state === 'recording') await setBadge(badgeTime(status.elapsed || 0), '#dc2626');
  else if (status.state === 'paused') await setBadge('II', '#f59e0b');
  else if (!next.active) await setBadge('', null);
  if (prev.overlayTabId) chrome.tabs.sendMessage(prev.overlayTabId, { type: 'rec:status', status: next }).catch(() => {});
}

async function onRecorderFinished({ itemId, error, cancelled }) {
  const st = (await getSession('recState')) || {};
  if (st.overlayTabId) chrome.tabs.sendMessage(st.overlayTabId, { type: 'overlay:teardown' }).catch(() => {});
  await setSession({ recState: { active: false, state: error ? 'error' : cancelled ? 'cancelled' : 'done', itemId, error, finishedAt: Date.now() } });
  await setBadge('', null);
  if (st.hostWindowId != null) chrome.windows.remove(st.hostWindowId).catch(() => {});
  else await closeOffscreen();
  const settings = await getSettings();
  if (itemId && settings.openEditorAfterRecording) await openPage(`video-editor.html?id=${encodeURIComponent(itemId)}`);
}

async function recorderCommand(type, extra = {}) {
  const st = await getSession('recState');
  if (!st?.active) throw new Error('No active recording.');
  if (type === 'rec:annotate-toggle') { await overlayMessage({ type: 'overlay:annotate-toggle' }); return { ok: true }; }
  if (!(await hostAlive(st))) {
    await setSession({ recState: { active: false, state: 'error', error: 'The recorder stopped unexpectedly.' } });
    await setBadge('', null);
    throw new Error('The recorder is no longer running.');
  }
  return sendToHost(st.hostId, { type, ...extra });
}

// ---------------------------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------------------------
const handlers = {
  'capture:start': (m) => { startCapture(m).catch(() => {}); return { ok: true }; },
  'capture:start-wait': (m) => startCapture(m).then((item) => ({ ok: true, itemId: item?.id })),
  'capture:cancel': async () => {
    if (capture) {
      capture.cancelled = true;
      chrome.scripting.executeScript({ target: { tabId: capture.tabId }, func: () => window.__fphdAgent?.cancel() }).catch(() => {});
    }
    return { ok: true };
  },
  'capture:get-state': async () => ({ state: (await getSession('captureState')) || null, busy: !!capture }),

  'rec:start': (m) => startRecording(m),
  'rec:pause': () => recorderCommand('rec:pause'),
  'rec:resume': () => recorderCommand('rec:resume'),
  'rec:stop': () => recorderCommand('rec:stop'),
  'rec:cancel': () => recorderCommand('rec:cancel'),
  'rec:screenshot': () => recorderCommand('rec:screenshot'),
  'rec:mute': (m) => recorderCommand('rec:mute', { muted: m.muted }),
  'rec:webcam': (m) => recorderCommand('rec:webcam', { enabled: m.enabled, position: m.position }),
  'rec:annotate-toggle': () => recorderCommand('rec:annotate-toggle'),
  'rec:get-state': async () => ({ state: (await getSession('recState')) || null }),

  // from the offscreen recorder
  'rec:status': async (m) => { await onRecorderStatus(m.status, m.hostId); return { ok: true }; },
  'rec:finished': async (m) => { await onRecorderFinished(m); return { ok: true }; },
  'rec:notify': async (m) => { await overlayMessage({ type: 'overlay:toast', text: m.text }); broadcast({ type: 'rec:toast', text: m.text }); return { ok: true }; },

  'open:page': async (m) => { await openPage(m.path); return { ok: true }; },
  'picker:result': async (m) => { // from the recording-control window
    const p = pickers.get(m.reqId);
    if (p) { pickers.delete(m.reqId); p.resolve({ streamId: m.streamId, options: { canRequestAudioTrack: m.canRequestAudioTrack } }); }
    return { ok: true };
  },
  'recovery:list': async () => ({ sets: await listChunkSets() }),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false; // addressed to the offscreen document
  const h = handlers[msg.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg, sender))
    .then((r) => sendResponse(r ?? { ok: true }), (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

// ---------------------------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command, tab) => {
  try {
    if (command === 'capture-full-page') await startCapture({ mode: 'full', tabId: tab?.id });
    else if (command === 'toggle-recording-pause') {
      const st = await getSession('recState');
      if (st?.active) await recorderCommand(st.state === 'paused' ? 'rec:resume' : 'rec:pause');
    } else if (command === 'stop-recording') await recorderCommand('rec:stop');
    else if (command === 'toggle-annotation') await recorderCommand('rec:annotate-toggle');
  } catch { /* nothing to do */ }
});

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------
async function reconcile() {
  // If the browser restarted or the worker was killed, an "active" recording without an offscreen
  // document is stale. Unfinished chunks are offered for recovery in Capture History.
  const st = await getSession('recState');
  if (st?.active && !(await hostAlive(st))) {
    await setSession({ recState: { active: false, state: 'error', error: 'The recording was interrupted.' } });
    await setBadge('', null);
  }
}

chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await reconcile();
  if (reason === 'install') await openPage('app.html#dashboard');
});

// The user closing the recorded tab ends tab capture; the offscreen document notices the track
// ending and finalises the file. Here we only clean the overlay reference.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await getSession('recState');
  if (st?.overlayTabId === tabId) await setSession({ recState: { ...st, overlayTabId: null } });
  if (capture?.tabId === tabId) capture.cancelled = true;
});
