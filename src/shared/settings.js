// Settings with defaults, persisted in chrome.storage.local (small JSON only – never media).
export const DEFAULT_SETTINGS = {
  // Screenshot
  jpgQuality: 95,                 // 90 | 95 | 100
  chromaSubsampling: '444',       // '444' (sharpest text) | '420' (smaller)
  scrollDelay: 350,               // ms to wait after each scroll before capturing
  lazyLoadPrep: true,             // pre-scroll the page to trigger lazy-loaded content
  lazyLoadDelay: 200,             // ms per step during pre-scroll
  stickyMode: 'minimize',         // 'normal' | 'minimize'
  hideScrollbars: true,
  maxCaptureHeight: 60000,        // CSS px – protects against infinite scroll
  captureHorizontal: true,        // capture horizontally scrolling pages too
  pdfLayout: 'single',            // 'single' (one long page) | 'paged'
  pdfPaper: 'a4',                 // 'a4' | 'letter'
  pdfOrientation: 'portrait',     // 'portrait' | 'landscape'
  pdfMarginMm: 10,
  pdfSmartBreaks: true,           // avoid cutting through text lines on page breaks
  openEditorAfterCapture: true,

  // Recording
  recSource: 'tab',               // 'tab' | 'screen'
  recResolution: '1080',          // '720' | '1080' | '1440' | '2160' | 'source'
  recFps: 30,                     // 24 | 30 | 60
  recQuality: 'high',             // 'standard' | 'high' | 'max' | 'custom'
  recBitrateMbps: 12,             // used when recQuality === 'custom'
  recCodec: 'vp9',                // 'vp9' | 'vp8' | 'av1' | 'h264'
  recAudio: 'tab',                // 'none' | 'mic' | 'tab' | 'both'
  micDeviceId: '',
  micEchoCancellation: true,
  webcamEnabled: false,
  webcamDeviceId: '',
  webcamMode: 'burn',             // 'burn' (composited into video) | 'separate' (editable track in the editor)
  webcamShape: 'circle',          // 'circle' | 'rect'
  webcamSize: 22,                 // % of output width
  webcamOpacity: 100,             // %
  webcamPosition: 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'custom'
  webcamX: 0.78, webcamY: 0.7,    // normalised custom position (top-left corner)
  countdown: 3,                   // 0 | 3 | 5 | 10
  showToolbar: true,              // in-page recording toolbar (it is part of the captured tab)
  cursorHighlight: false,
  clickEffects: true,
  syntheticCursor: true,          // draw a cursor in tab recordings (tab capture never includes the OS cursor)
  cursorColor: '#facc15',
  cursorSize: 36,
  clickColorLeft: '#3b82f6',
  clickColorRight: '#ef4444',
  openEditorAfterRecording: true,

  // Video editor / export
  exportFormat: 'webm',           // 'webm' | 'mp4'
  exportResolution: 'source',     // 'source' | '2160' | '1440' | '1080' | '720' | '480'
  exportFps: 'source',            // 'source' | 24 | 30 | 60
  exportQuality: 'high',          // 'standard' | 'high' | 'max'
  previewQuality: 'full',         // 'full' | 'half'

  // Files
  screenshotPattern: 'FullPage_Capture_{site}_{date}',
  videoPattern: 'Screen_Recording_{date}_{time}',
  downloadSubfolder: 'FullPage HD Capture',
  askWhereToSave: false,

  // UI
  theme: 'system',                // 'system' | 'light' | 'dark'
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function resetSettings() {
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
  return { ...DEFAULT_SETTINGS };
}

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) cb({ ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) });
  });
}
