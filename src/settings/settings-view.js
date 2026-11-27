// Settings page.
import { h, icon, toast, confirmDialog } from '../shared/ui.js';
import { getSettings, saveSettings, resetSettings, DEFAULT_SETTINGS } from '../shared/settings.js';
import { clearAll, cleanupTemporary } from '../storage/db.js';
import { formatBytes } from '../shared/format.js';
import { expandPattern } from '../shared/filenames.js';

export async function renderSettings({ view, head }) {
  let s = await getSettings();
  const save = async (k, v) => { s = await saveSettings({ [k]: v }); };
  const row = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint ? h('span', { class: 'small', style: { fontWeight: 400 } }, hint) : null);
  const sel = (k, opts) => { const e = h('select', { id: `set-${k}` }); for (const [v, l] of opts) e.append(h('option', { value: v, selected: String(s[k]) === String(v) }, l)); e.addEventListener('change', () => save(k, typeof DEFAULT_SETTINGS[k] === 'number' ? Number(e.value) : e.value)); return e; };
  const num = (k, min, max, step = 1) => { const e = h('input', { type: 'number', id: `set-${k}`, min, max, step, value: s[k] }); e.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Number(e.value))); e.value = v; save(k, v); }); return e; };
  const txt = (k, onInput) => { const e = h('input', { type: 'text', id: `set-${k}`, value: s[k] }); e.addEventListener('change', () => save(k, e.value)); e.addEventListener('input', () => onInput?.(e.value)); return e; };
  const chk = (k, label) => { const c = h('input', { type: 'checkbox', id: `set-${k}`, checked: !!s[k] }); c.addEventListener('change', () => save(k, c.checked)); return h('label', { class: 'check' }, c, label); };
  const group = (title, ...children) => h('div', { class: 'card set-group' }, h('h2', {}, title), ...children);

  const shotPreview = h('span', { class: 'small mono' }); const vidPreview = h('span', { class: 'small mono' });
  const updPreview = () => {
    shotPreview.textContent = `${expandPattern(s.screenshotPattern, { url: 'https://www.google.com', title: 'Google' })}.jpg`;
    vidPreview.textContent = `${expandPattern(s.videoPattern, { url: 'https://www.google.com', title: 'Google' })}.webm`;
  };
  updPreview();
  const usage = h('span', { class: 'muted' });
  const refreshUsage = async () => { try { const e = await navigator.storage.estimate(); usage.textContent = `${formatBytes(e.usage)} used${e.quota ? ` of ${formatBytes(e.quota)} available` : ''}`; } catch { usage.textContent = 'unknown'; } };
  refreshUsage();

  const perms = h('div', { class: 'col small' });
  for (const name of ['microphone', 'camera']) {
    let state = 'unknown';
    try { state = (await navigator.permissions.query({ name })).state; } catch { /* ignore */ }
    perms.append(h('div', {}, h('b', {}, name === 'microphone' ? 'Microphone: ' : 'Camera: '), state === 'granted' ? 'allowed' : state === 'denied' ? 'blocked (change it in Chrome → Settings → Privacy → Site settings → extension)' : 'not requested yet — asked only when you enable it'));
  }

  view.replaceChildren(head('Settings', 'Changes are saved automatically.',
    h('button', { class: 'btn', id: 'settings-reset', html: `${icon('undo')}<span>Reset to defaults</span>`, onclick: async () => { if (await confirmDialog('Reset settings?', 'All settings return to their defaults. Captures are not affected.', 'Reset')) { await resetSettings(); renderSettings({ view, head }); toast('Settings reset'); } } })),
  group('Screenshots', h('div', { class: 'form-grid' },
    row('Default JPG quality', sel('jpgQuality', [[90, '90%'], [95, '95% (default)'], [100, '100% (maximum)']]), 'JPG is lossy even at 100%.'),
    row('Colour sampling', sel('chromaSubsampling', [['444', '4:4:4 – sharpest text'], ['420', '4:2:0 – smaller files']])),
    row('Scroll delay (ms)', num('scrollDelay', 0, 5000, 50), 'Wait after each scroll before capturing.'),
    row('Lazy-load step delay (ms)', num('lazyLoadDelay', 50, 3000, 50)),
    row('Sticky elements', sel('stickyMode', [['minimize', 'Minimise repeated sticky/fixed elements'], ['normal', 'Leave as displayed']])),
    row('Maximum capture height (CSS px)', num('maxCaptureHeight', 1000, 500000, 1000), 'Stops infinite-scroll pages.')),
  h('div', { class: 'row wrap', style: { gap: '18px', marginTop: '10px' } }, chk('lazyLoadPrep', 'Lazy-load preparation (pre-scroll)'), chk('hideScrollbars', 'Hide scrollbars'), chk('captureHorizontal', 'Capture horizontal overflow'), chk('openEditorAfterCapture', 'Open preview after capture')),
  h('div', { class: 'notice small', style: { marginTop: '10px' } }, 'Resolution is always preserved: captures are stored losslessly at the device pixel ratio. Pages taller than browser canvas limits are stored and exported in full-resolution segments — never silently downscaled.'),
  h('h3', { style: { marginTop: '14px' } }, 'PDF'), h('div', { class: 'form-grid' },
    row('Default PDF layout', sel('pdfLayout', [['single', 'Single long page'], ['paged', 'Standard pages']])),
    row('Paper', sel('pdfPaper', [['a4', 'A4'], ['letter', 'Letter']])),
    row('Orientation', sel('pdfOrientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']])),
    row('Margins (mm)', num('pdfMarginMm', 0, 50, 1))),
  h('div', { style: { marginTop: '10px' } }, chk('pdfSmartBreaks', 'Avoid cutting text lines at page breaks'))),
  group('Recording', h('div', { class: 'form-grid' },
    row('Default capture source', sel('recSource', [['tab', 'Current Chrome tab'], ['screen', 'Entire screen / window']])),
    row('Resolution', sel('recResolution', [['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['2160', '4K'], ['source', 'Source / maximum']])),
    row('Frame rate', sel('recFps', [[24, '24 FPS'], [30, '30 FPS'], [60, '60 FPS']])),
    row('Quality preset', sel('recQuality', [['standard', 'Standard'], ['high', 'High'], ['max', 'Maximum practical'], ['custom', 'Custom bitrate']])),
    row('Custom bitrate (Mbps)', num('recBitrateMbps', 0.5, 120, 0.5)),
    row('Codec', sel('recCodec', [['vp9', 'VP9'], ['vp8', 'VP8'], ['av1', 'AV1'], ['h264', 'H.264']])),
    row('Default audio', sel('recAudio', [['none', 'No audio'], ['mic', 'Microphone only'], ['tab', 'Tab/system audio'], ['both', 'Microphone + tab/system']])),
    row('Countdown', sel('countdown', [[0, 'None'], [3, '3 s'], [5, '5 s'], [10, '10 s']])),
    row('Webcam shape', sel('webcamShape', [['circle', 'Circle'], ['rect', 'Rectangle']])),
    row('Webcam position', sel('webcamPosition', [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'], ['custom', 'Custom']]))),
  h('div', { class: 'row wrap', style: { gap: '18px', marginTop: '10px' } }, chk('webcamEnabled', 'Webcam on by default'), chk('cursorHighlight', 'Cursor highlight'), chk('clickEffects', 'Click effects'), chk('syntheticCursor', 'Cursor in tab recordings'), chk('showToolbar', 'In-page toolbar'), chk('openEditorAfterRecording', 'Open editor after recording')),
  h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Microphone and camera devices are chosen on the Screen Recorder page.')),
  group('Video editor & export', h('div', { class: 'form-grid' },
    row('Default export format', sel('exportFormat', [['webm', 'WebM (VP9/Opus)'], ['mp4', 'MP4 (H.264/AAC)']])),
    row('Default resolution', sel('exportResolution', [['source', 'Same as source'], ['2160', '2160p'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']]), 'Never larger than the source.'),
    row('Default frame rate', sel('exportFps', [['source', 'Same as source'], [24, '24'], [30, '30'], [60, '60']])),
    row('Default quality', sel('exportQuality', [['standard', 'Standard'], ['high', 'High'], ['max', 'Maximum']])),
    row('Preview playback quality', sel('previewQuality', [['full', 'Full'], ['half', 'Half (faster)']])))),
  group('Files & downloads', h('div', { class: 'form-grid' },
    row('Screenshot filename', txt('screenshotPattern', (v) => { s.screenshotPattern = v; updPreview(); }), shotPreview),
    row('Video filename', txt('videoPattern', (v) => { s.videoPattern = v; updPreview(); }), vidPreview),
    row('Subfolder in Downloads', txt('downloadSubfolder'), 'Leave empty to save directly to Downloads.')),
  h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Tokens: {site} {title} {domain} {date} {time} {datetime} {yyyy} {mm} {dd} {hh} {min} {ss}. Invalid characters are removed and existing files are never overwritten.'),
  h('div', { style: { marginTop: '10px' } }, chk('askWhereToSave', 'Ask where to save each file (choose any folder)'))),
  group('Appearance', h('div', { class: 'form-grid' }, row('Theme', sel('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])))),
  group('Privacy & storage',
    h('div', { class: 'col' },
      h('div', { class: 'row' }, h('b', {}, 'Local storage usage:'), usage),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', id: 'cleanup-temp', html: `${icon('trash')}<span>Delete temporary files</span>`, onclick: async () => { const r = await cleanupTemporary(); toast(`Removed ${r.orphanBlobs} orphaned file(s), ${r.chunkSets} unfinished recording(s), ${r.opfsFiles} export temp file(s).`, 'ok'); refreshUsage(); } }),
        h('button', { class: 'btn danger', id: 'clear-all', html: `${icon('trash')}<span>Clear capture history</span>`, onclick: async () => { if (await confirmDialog('Delete all captures?', 'Every screenshot, recording and edit stored by FullPage HD Capture will be deleted.', 'Delete everything', true)) { await clearAll(); await cleanupTemporary(); toast('All local data deleted', 'ok'); refreshUsage(); } } })),
      h('h3', {}, 'Permissions'), perms,
      h('div', { class: 'notice small' }, h('b', {}, 'Privacy: '), 'Screenshots, recordings, microphone and webcam data are processed and stored only on this computer. The extension has no server, no analytics, no account and no AI processing. It never captures anything without your explicit action, and Chrome always shows its own indicator while a tab or screen is shared.'))),
  );
}
