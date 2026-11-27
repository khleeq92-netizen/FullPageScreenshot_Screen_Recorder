// Shared message handling for a document that hosts a RecordingSession (offscreen document or
// the recording-control window). The service worker addresses the active host by its id.
import { RecordingSession } from './recorder-engine.js';

export function hostRecorder(hostId, { onStatus } = {}) {
  let session = null;
  const send = (msg) => {
    if (msg.type === 'rec:status') onStatus?.(msg.status);
    return chrome.runtime.sendMessage({ ...msg, hostId }).catch(() => {});
  };
  const handlers = {
    'rec:begin': async (m) => {
      if (session && !['done', 'error', 'cancelled'].includes(session.state)) return { ok: false, error: 'Already recording' };
      session = new RecordingSession({ send });
      try {
        return await session.begin(m);
      } catch (e) {
        session.releaseMedia();
        session = null;
        send({ type: 'rec:finished', error: e.message });
        return { ok: false, error: e.message };
      }
    },
    'rec:pause': async () => { session?.pause(); return { ok: true }; },
    'rec:resume': async () => { session?.resume(); return { ok: true }; },
    'rec:stop': async () => {
      if (!session) return { ok: false, error: 'Not recording' };
      if (session.state === 'countdown' || session.state === 'starting') return session.cancel();
      return session.stop();
    },
    'rec:cancel': async () => (session ? session.cancel() : { ok: true }),
    'rec:mute': async (m) => { session?.setMuted(m.muted); return { ok: true }; },
    'rec:webcam': async (m) => (session ? session.setWebcam(m) : { ok: false }),
    'rec:screenshot': async () => {
      if (!session) return { ok: false, error: 'Not recording' };
      const r = await session.screenshot();
      send({ type: 'rec:notify', text: 'Screenshot saved to Capture History' });
      return r;
    },
    'rec:ping': async () => ({ ok: true, state: session?.state || 'idle' }),
  };
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== 'recorder' || msg.hostId !== hostId) return false;
    const h = handlers[msg.type];
    if (!h) return false;
    h(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  });
  return {
    get session() { return session; },
    handle: (type, m = {}) => handlers[type]?.(m),
  };
}
