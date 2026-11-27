// Offscreen document: hosts tab recordings (tab capture stream IDs are usable here), so the
// recording continues when the popup closes.
import { hostRecorder } from './recorder-host.js';

const host = hostRecorder('offscreen');
// If the document is torn down (e.g. extension reload), stop gracefully so the chunks are complete.
addEventListener('pagehide', () => { if (host.session?.state === 'recording') host.session.stop(); });
