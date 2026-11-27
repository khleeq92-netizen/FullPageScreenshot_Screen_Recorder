// Recording-control window: shows Chrome's screen/window/tab picker and hosts the recording.
// Chrome binds desktop-capture stream IDs to the document that requested them, so the recording
// must run here (a visible page) rather than in the hidden offscreen document.
import { hostRecorder } from './recorder-host.js';
import { $, h, icon, applyTheme } from '../shared/ui.js';
import { formatDuration, formatBytes } from '../shared/format.js';

const q = new URLSearchParams(location.search);
const reqId = q.get('req');
const hostId = `window:${reqId}`;
const sources = (q.get('sources') || 'screen,window,tab,audio').split(',');
let lastState = 'idle';
let minimised = false;

const host = hostRecorder(hostId, { onStatus: render });

function render(st) {
  lastState = st.state;
  const badge = $('#badge');
  badge.textContent = st.state === 'recording' ? '● REC' : st.state === 'paused' ? 'PAUSED' : st.state === 'countdown' ? `Starting in ${st.countdown}` : st.state;
  badge.className = `badge ${st.state === 'recording' ? 'rec' : ''}`;
  $('#msg').style.display = 'none';
  for (const id of ['time', 'meta', 'controls', 'hint']) $(`#${id}`).style.display = '';
  $('#time').textContent = formatDuration(st.elapsed || 0);
  $('#meta').textContent = `${st.width || '?'}×${st.height || '?'}${st.fps ? ` · ${st.fps} fps` : ''} · ${formatBytes(st.bytes)}`;
  const meter = $('#meter'); meter.style.display = st.hasMic ? '' : 'none';
  meter.firstElementChild.style.width = `${Math.round((st.muted ? 0 : st.micLevel || 0) * 100)}%`;
  const warn = $('#warn');
  warn.style.display = st.warnings?.length ? '' : 'none'; warn.textContent = (st.warnings || []).join(' ');
  const c = $('#controls');
  const paused = st.state === 'paused';
  const mk = (ic, label, fn, cls = '') => { const b = h('button', { class: `btn ${cls}`, html: `${icon(ic)}<span>${label}</span>` }); b.addEventListener('click', fn); return b; };
  c.replaceChildren(
    mk(paused ? 'play' : 'pause', paused ? 'Resume' : 'Pause', () => host.handle(paused ? 'rec:resume' : 'rec:pause')),
    mk('stop', 'Stop', () => host.handle('rec:stop'), 'primary'),
    mk('x', 'Discard', () => { if (confirm('Discard this recording?')) host.handle('rec:cancel'); }, 'danger'),
    st.hasMic ? mk(st.muted ? 'micOff' : 'mic', st.muted ? 'Unmute' : 'Mute', () => host.handle('rec:mute', { muted: !st.muted })) : null,
    mk('camera', 'Screenshot', () => host.handle('rec:screenshot')),
  );
  if (st.state === 'recording' && !minimised) {
    minimised = true;
    // Keep this control window out of a full-screen recording.
    chrome.windows.getCurrent().then((w) => chrome.windows.update(w.id, { state: 'minimized' })).catch(() => {});
  }
}

addEventListener('beforeunload', (e) => {
  if (lastState === 'recording' || lastState === 'paused') { e.preventDefault(); e.returnValue = ''; }
});
addEventListener('pagehide', () => { if (host.session && ['recording', 'paused'].includes(host.session.state)) host.session.stop(); });

applyTheme();
chrome.desktopCapture.chooseDesktopMedia(sources, (streamId, options) => {
  chrome.runtime.sendMessage({ type: 'picker:result', reqId, hostId, streamId: streamId || null, canRequestAudioTrack: !!options?.canRequestAudioTrack });
  if (!streamId) window.close();
  else $('#msg').textContent = 'Starting…';
});
