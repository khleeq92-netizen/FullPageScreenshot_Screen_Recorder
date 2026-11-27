// src/shared/settings.js
var DEFAULT_SETTINGS = {
  // Screenshot
  jpgQuality: 95,
  // 90 | 95 | 100
  chromaSubsampling: "444",
  // '444' (sharpest text) | '420' (smaller)
  scrollDelay: 350,
  // ms to wait after each scroll before capturing
  lazyLoadPrep: true,
  // pre-scroll the page to trigger lazy-loaded content
  lazyLoadDelay: 200,
  // ms per step during pre-scroll
  stickyMode: "minimize",
  // 'normal' | 'minimize'
  hideScrollbars: true,
  maxCaptureHeight: 6e4,
  // CSS px – protects against infinite scroll
  captureHorizontal: true,
  // capture horizontally scrolling pages too
  pdfLayout: "single",
  // 'single' (one long page) | 'paged'
  pdfPaper: "a4",
  // 'a4' | 'letter'
  pdfOrientation: "portrait",
  // 'portrait' | 'landscape'
  pdfMarginMm: 10,
  pdfSmartBreaks: true,
  // avoid cutting through text lines on page breaks
  openEditorAfterCapture: true,
  // Recording
  recSource: "tab",
  // 'tab' | 'screen'
  recResolution: "1080",
  // '720' | '1080' | '1440' | '2160' | 'source'
  recFps: 30,
  // 24 | 30 | 60
  recQuality: "high",
  // 'standard' | 'high' | 'max' | 'custom'
  recBitrateMbps: 12,
  // used when recQuality === 'custom'
  recCodec: "vp9",
  // 'vp9' | 'vp8' | 'av1' | 'h264'
  recAudio: "tab",
  // 'none' | 'mic' | 'tab' | 'both'
  micDeviceId: "",
  micEchoCancellation: true,
  webcamEnabled: false,
  webcamDeviceId: "",
  webcamMode: "burn",
  // 'burn' (composited into video) | 'separate' (editable track in the editor)
  webcamShape: "circle",
  // 'circle' | 'rect'
  webcamSize: 22,
  // % of output width
  webcamOpacity: 100,
  // %
  webcamPosition: "bottom-right",
  // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'custom'
  webcamX: 0.78,
  webcamY: 0.7,
  // normalised custom position (top-left corner)
  countdown: 3,
  // 0 | 3 | 5 | 10
  showToolbar: true,
  // in-page recording toolbar (it is part of the captured tab)
  cursorHighlight: false,
  clickEffects: true,
  syntheticCursor: true,
  // draw a cursor in tab recordings (tab capture never includes the OS cursor)
  cursorColor: "#facc15",
  cursorSize: 36,
  clickColorLeft: "#3b82f6",
  clickColorRight: "#ef4444",
  openEditorAfterRecording: true,
  // Video editor / export
  exportFormat: "webm",
  // 'webm' | 'mp4'
  exportResolution: "source",
  // 'source' | '2160' | '1440' | '1080' | '720' | '480'
  exportFps: "source",
  // 'source' | 24 | 30 | 60
  exportQuality: "high",
  // 'standard' | 'high' | 'max'
  previewQuality: "full",
  // 'full' | 'half'
  // Files
  screenshotPattern: "FullPage_Capture_{site}_{date}",
  videoPattern: "Screen_Recording_{date}_{time}",
  downloadSubfolder: "FullPage HD Capture",
  askWhereToSave: false,
  // UI
  theme: "system"
  // 'system' | 'light' | 'dark'
};
async function getSettings() {
  const { settings: settings2 } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings2 || {} };
}
async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

// src/shared/ui.js
var $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...children) {
  const el2 = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el2.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el2.style, v);
    else if (k.startsWith("on") && typeof v === "function") el2.addEventListener(k.slice(2), v);
    else if (k === "html") el2.innerHTML = v;
    else el2.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el2.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el2;
}
var ICONS = {
  capture: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M8 8h8v8H8z"/>',
  page: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
  visible: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  editor: '<path d="M4 20h16M4 16l10-10 4 4-10 10H4z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<path d="M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.7M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  rotateL: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  arrow: '<path d="M5 19L19 5M19 5h-8M19 5v8"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6.5"/>',
  highlight: '<path d="M4 20h7M14 4l6 6-8 8H6v-6l8-8z"/>',
  blur: '<circle cx="7" cy="7" r="1.5"/><circle cx="12" cy="7" r="1.5"/><circle cx="17" cy="7" r="1.5"/><circle cx="7" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="17" cy="12" r="1.5"/><circle cx="7" cy="17" r="1.5"/><circle cx="12" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/>',
  pen: '<path d="M3 21l3.8-1 11-11-2.8-2.8-11 11L3 21z"/>',
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6"/>',
  split: '<path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  file: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
  webcam: '<circle cx="12" cy="10" r="6"/><circle cx="12" cy="10" r="2"/><path d="M8 21h8M12 16v5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'
};
var icon = (name, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[name] || ""}</svg>`;
async function applyTheme() {
  try {
    const s = await getSettings();
    if (s.theme === "light" || s.theme === "dark") document.documentElement.dataset.theme = s.theme;
    else delete document.documentElement.dataset.theme;
  } catch {
  }
}
var toastHost = null;
function toast(text, kind = "", ms = 3500) {
  if (!toastHost) {
    toastHost = h("div", { class: "toast-host", role: "status", "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const t = h("div", { class: `toast ${kind}` }, text);
  toastHost.append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}
function modal(content, { onClose, wide = false } = {}) {
  const box = h("div", { class: "modal", style: wide ? { width: "min(92vw, 1100px)" } : {} }, content);
  const back = h("div", { class: "modal-back" }, box);
  const close = () => {
    back.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  back.addEventListener("mousedown", (e) => {
    if (e.target === back) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(back);
  return { close, box };
}

// src/storage/db.js
var DB_NAME = "fullpage-hd-capture";
var DB_VERSION = 1;
var dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) {
        const s = db.createObjectStore("items", { keyPath: "id" });
        s.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "key" });
      if (!db.objectStoreNames.contains("chunks")) {
        const c = db.createObjectStore("chunks", { keyPath: ["recId", "seq"] });
        c.createIndex("recId", "recId");
      }
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "itemId" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => {
      result = r;
    }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Transaction aborted"));
  });
}
var getItem = (id) => tx(["items"], "readonly", (t) => promisify(t.objectStore("items").get(id)));
async function updateItem(id, patch) {
  return tx(["items"], "readwrite", async (t) => {
    const s = t.objectStore("items");
    const cur = await promisify(s.get(id));
    if (!cur) throw new Error("Item not found");
    const next = { ...cur, ...patch };
    await promisify(s.put(next));
    return next;
  });
}
async function getBlob(key) {
  const r = await tx(["blobs"], "readonly", (t) => promisify(t.objectStore("blobs").get(key)));
  return r ? r.blob : null;
}
var putProject = (itemId2, data) => tx(["projects"], "readwrite", (t) => promisify(t.objectStore("projects").put({ itemId: itemId2, data, savedAt: Date.now() })));
async function getProject(itemId2) {
  const r = await tx(["projects"], "readonly", (t) => promisify(t.objectStore("projects").get(itemId2)));
  return r ? r.data : null;
}

// src/shared/format.js
function formatBytes(n) {
  if (n == null || !isFinite(n)) return "\u2014";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function formatDate(ts) {
  return new Date(ts).toLocaleString(void 0, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// src/shared/filenames.js
var pad = (n) => String(n).padStart(2, "0");
function siteName(url, title) {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return decodeURIComponent(u.pathname.split("/").pop() || "File").replace(/\.[a-z0-9]+$/i, "");
    let h2 = u.hostname.replace(/^www\d?\./, "");
    if (/^(\d+\.){3}\d+$|^\[|:|^localhost$/i.test(h2)) {
      const t = (title || "").split(/[\s|–—-]+/).filter(Boolean).slice(0, 3).join("_");
      return t || "Localhost";
    }
    const parts = h2.split(".");
    let main = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (!main) main = title || "Page";
    return main.charAt(0).toUpperCase() + main.slice(1);
  } catch {
    return (title || "Page").slice(0, 40);
  }
}
function sanitizeFilename(name, fallback = "capture") {
  let s = String(name ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*~]+/g, "_").replace(/\s+/g, " ").replace(/_+/g, "_").trim().replace(/^[.\s_]+|[.\s_]+$/g, "");
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  if (!s) s = fallback;
  return s.slice(0, 150);
}
function sanitizeFolder(path) {
  return String(path || "").split(/[\\/]+/).map((p) => sanitizeFilename(p, "")).filter((p) => p && p !== ".." && p !== ".").join("/");
}
function expandPattern(pattern, ctx = {}) {
  const d = ctx.date ? new Date(ctx.date) : /* @__PURE__ */ new Date();
  let domain = "";
  try {
    domain = new URL(ctx.url).hostname;
  } catch {
  }
  const map = {
    site: siteName(ctx.url || "", ctx.title),
    title: (ctx.title || "").slice(0, 60),
    domain,
    date: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`,
    time: `${pad(d.getHours())}-${pad(d.getMinutes())}`,
    datetime: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
    yyyy: d.getFullYear(),
    mm: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    hh: pad(d.getHours()),
    min: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
    w: ctx.width ?? "",
    h: ctx.height ?? "",
    type: ctx.type ?? ""
  };
  const out = String(pattern || "{site}_{date}").replace(/\{(\w+)\}/g, (m, k) => k in map ? String(map[k]) : m);
  return sanitizeFilename(out);
}
function buildDownloadPath(baseName, ext, settings2) {
  const folder = sanitizeFolder(settings2?.downloadSubfolder);
  const file = `${sanitizeFilename(baseName)}.${ext.replace(/^\./, "")}`;
  return folder ? `${folder}/${file}` : file;
}

// src/shared/downloads.js
function downloadBlob(blob, baseName, ext, settings2, { saveAs } = {}) {
  const url = URL.createObjectURL(blob);
  const filename = buildDownloadPath(baseName, ext, settings2);
  return new Promise((resolve, reject) => {
    let id = null;
    let settled = false;
    const finish = (state, error) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      setTimeout(() => URL.revokeObjectURL(url), 1e4);
      if (state === "complete") resolve({ id, filename });
      else reject(new Error(error === "USER_CANCELED" ? "Download cancelled." : `Download interrupted (${error || "unknown reason"}). Try again or choose another folder.`));
    };
    const check = (d) => {
      if (!d) return;
      const state = typeof d.state === "string" ? d.state : d.state?.current;
      if (state === "complete") finish("complete");
      else if (state === "interrupted") {
        if (d.error && typeof d.error === "string") finish("interrupted", d.error);
        else chrome.downloads.search({ id }, ([item2]) => finish("interrupted", item2?.error));
      }
    };
    const onChanged = (d) => {
      if (id != null && d.id === id) check(d);
    };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: saveAs ?? !!settings2?.askWhereToSave }, (newId) => {
      if (chrome.runtime.lastError || newId == null) {
        settled = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(url);
        reject(new Error(chrome.runtime.lastError?.message || "Download was not started"));
        return;
      }
      id = newId;
      chrome.downloads.search({ id }, ([item2]) => check(item2));
    });
  });
}

// src/image-processing/renderer.js
function cropRect(doc2, srcW, srcH) {
  const c = doc2?.crop;
  if (!c) return { x: 0, y: 0, w: srcW, h: srcH };
  const x = Math.max(0, Math.min(srcW - 1, Math.round(c.x)));
  const y = Math.max(0, Math.min(srcH - 1, Math.round(c.y)));
  const w = Math.max(1, Math.min(srcW - x, Math.round(c.w)));
  const h2 = Math.max(1, Math.min(srcH - y, Math.round(c.h)));
  return { x, y, w, h: h2 };
}
function outputSize(doc2, srcW, srcH) {
  const c = cropRect(doc2, srcW, srcH);
  const r = ((doc2?.rotation || 0) % 360 + 360) % 360;
  return r === 90 || r === 270 ? { width: c.h, height: c.w } : { width: c.w, height: c.h };
}
var SegmentSource = class {
  constructor(segments2, width, { cacheSize = 3 } = {}) {
    this.segments = segments2.slice().sort((a, b) => a.y - b.y);
    this.width = width;
    this.height = this.segments.reduce((m, s) => Math.max(m, s.y + s.height), 0);
    this.cache = /* @__PURE__ */ new Map();
    this.cacheSize = cacheSize;
  }
  async bitmap(seg) {
    let p = this.cache.get(seg);
    if (p) {
      this.cache.delete(seg);
      this.cache.set(seg, p);
      return p;
    }
    p = createImageBitmap(seg.blob);
    this.cache.set(seg, p);
    while (this.cache.size > this.cacheSize) {
      const [k, v] = this.cache.entries().next().value;
      this.cache.delete(k);
      v.then((b) => b.close()).catch(() => {
      });
    }
    return p;
  }
  overlapping(y0, y1) {
    return this.segments.filter((s) => s.y < y1 && s.y + s.height > y0);
  }
  async drawRange(ctx, y0, y1) {
    for (const seg of this.overlapping(y0, y1)) {
      const bmp = await this.bitmap(seg);
      ctx.drawImage(bmp, 0, seg.y);
    }
  }
  close() {
    for (const p of this.cache.values()) p.then((b) => b.close()).catch(() => {
    });
    this.cache.clear();
  }
};
function makeCanvas(w, h2) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h2);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h2;
  return c;
}
async function buildBlurPatches(src, doc2, { scale = 1 } = {}) {
  const patches = /* @__PURE__ */ new Map();
  for (const a of doc2?.annotations || []) {
    if (a.type !== "blur") continue;
    const x = Math.round(Math.min(a.x1, a.x2));
    const y = Math.round(Math.min(a.y1, a.y2));
    const w = Math.round(Math.abs(a.x2 - a.x1));
    const h2 = Math.round(Math.abs(a.y2 - a.y1));
    if (w < 2 || h2 < 2) continue;
    const strength = Math.max(2, a.strength || 14);
    const m = Math.ceil(strength * 3);
    const px = Math.max(0, x - m);
    const py = Math.max(0, y - m);
    const pw = Math.min(src.width, x + w + m) - px;
    const ph = Math.min(src.height, y + h2 + m) - py;
    const ws = Math.max(1, Math.round(pw * scale));
    const hs = Math.max(1, Math.round(ph * scale));
    const base = makeCanvas(ws, hs);
    const bctx = base.getContext("2d");
    bctx.setTransform(scale, 0, 0, scale, -px * scale, -py * scale);
    await src.drawRange(bctx, py, py + ph);
    const out = makeCanvas(ws, hs);
    const octx = out.getContext("2d");
    if (a.mode === "pixelate") {
      const cell = Math.max(2, strength * scale);
      const tw = Math.max(1, Math.round(ws / cell));
      const th = Math.max(1, Math.round(hs / cell));
      const tiny = makeCanvas(tw, th);
      const tctx = tiny.getContext("2d");
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(base, 0, 0, tw, th);
      octx.imageSmoothingEnabled = false;
      octx.drawImage(tiny, 0, 0, ws, hs);
    } else if (a.mode === "solid") {
      octx.fillStyle = a.color || "#000";
      octx.fillRect(0, 0, ws, hs);
    } else {
      octx.filter = `blur(${strength * scale}px)`;
      octx.drawImage(base, 0, 0);
      octx.filter = "none";
    }
    patches.set(a.id, { canvas: out, x: px, y: py, w: pw, h: ph, rect: { x, y, w, h: h2 } });
  }
  return patches;
}

// src/screenshot-editor/screenshot-page.js
var params = new URLSearchParams(location.search);
var itemId = params.get("id");
var SVGNS = "http://www.w3.org/2000/svg";
var item;
var settings;
var segments = [];
var doc = { annotations: [], crop: null, rotation: 0 };
var undoStack = [];
var redoStack = [];
var tool = "select";
var selectedId = null;
var style = { color: "#ef4444", width: 6, fontSize: 36, fill: false, blurMode: "blur", strength: 14 };
var zoom = 1;
var fitMode = true;
var blurUrls = /* @__PURE__ */ new Map();
var svg;
var stage;
var TOOLS = [
  ["select", "select", "Select / move (V)"],
  ["arrow", "arrow", "Arrow (A)"],
  ["rect", "rect", "Rectangle (R)"],
  ["ellipse", "ellipse", "Ellipse (E)"],
  ["highlight", "highlight", "Highlight area (H)"],
  ["text", "text", "Text (T)"],
  ["pen", "pen", "Freehand (P)"],
  ["blur", "blur", "Blur sensitive area (B)"],
  ["crop", "crop", "Crop (C)"]
];
var uid = () => Math.random().toString(36).slice(2, 10);
function snapshot() {
  return JSON.stringify(doc);
}
function commit(mutator) {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  mutator(doc);
  changed();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  doc = JSON.parse(undoStack.pop());
  selectedId = null;
  changed();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  doc = JSON.parse(redoStack.pop());
  selectedId = null;
  changed();
}
var saveTimer = 0;
function changed() {
  renderOverlay();
  updateInfo();
  updateToolbarState();
  refreshBlurPatches();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => putProject(itemId, doc).catch(() => {
  }), 400);
}
var blurGen = 0;
async function refreshBlurPatches() {
  const gen = ++blurGen;
  const blurs = doc.annotations.filter((a) => a.type === "blur");
  const keyOf = (a) => JSON.stringify([a.x1, a.y1, a.x2, a.y2, a.mode, a.strength, a.color]);
  for (const [id, v] of blurUrls) if (!blurs.some((b) => b.id === id && keyOf(b) === v.key)) {
    URL.revokeObjectURL(v.url);
    blurUrls.delete(id);
  }
  const todo = blurs.filter((b) => !blurUrls.has(b.id));
  if (!todo.length) return;
  const src = new SegmentSource(segments, item.width, { cacheSize: 2 });
  for (const a of todo) {
    const area = Math.abs((a.x2 - a.x1) * (a.y2 - a.y1));
    const scale = Math.min(1, Math.sqrt(4e6 / Math.max(1, area)));
    const patches = await buildBlurPatches(src, { annotations: [{ ...a, strength: a.strength }] }, { scale });
    const p = patches.get(a.id);
    if (gen !== blurGen) {
      src.close();
      return;
    }
    if (!p) continue;
    const blob = p.canvas.convertToBlob ? await p.canvas.convertToBlob({ type: "image/png" }) : await new Promise((r) => p.canvas.toBlob(r));
    blurUrls.set(a.id, { url: URL.createObjectURL(blob), key: keyOf(a), p: { x: p.x, y: p.y, w: p.w, h: p.h } });
  }
  src.close();
  renderOverlay();
}
function el(tag, attrs = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
}
function annToSvg(a) {
  const g = el("g", { "data-id": a.id });
  const x = Math.min(a.x1, a.x2);
  const y = Math.min(a.y1, a.y2);
  const w = Math.abs(a.x2 - a.x1);
  const hh = Math.abs(a.y2 - a.y1);
  const common = { stroke: a.color, "stroke-width": a.width, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (a.type === "arrow") {
    const head = Math.max(10, a.width * 4);
    const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
    g.append(el("line", { ...common, x1: a.x1, y1: a.y1, x2: a.x2 - Math.cos(ang) * head * 0.6, y2: a.y2 - Math.sin(ang) * head * 0.6 }));
    const p1 = [a.x2 - head * Math.cos(ang - Math.PI / 7), a.y2 - head * Math.sin(ang - Math.PI / 7)];
    const p2 = [a.x2 - head * Math.cos(ang + Math.PI / 7), a.y2 - head * Math.sin(ang + Math.PI / 7)];
    g.append(el("polygon", { points: `${a.x2},${a.y2} ${p1} ${p2}`, fill: a.color }));
  } else if (a.type === "rect") {
    if (a.fill) g.append(el("rect", { x, y, width: w, height: hh, fill: a.color, "fill-opacity": 0.25 }));
    g.append(el("rect", { ...common, x, y, width: w, height: hh }));
  } else if (a.type === "ellipse") {
    if (a.fill) g.append(el("ellipse", { cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2, fill: a.color, "fill-opacity": 0.25 }));
    g.append(el("ellipse", { ...common, cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2 }));
  } else if (a.type === "highlight") {
    g.append(el("rect", { x, y, width: w, height: hh, fill: a.color, "fill-opacity": 0.35, style: "mix-blend-mode:multiply" }));
  } else if (a.type === "pen") {
    const pts = [];
    for (let i = 0; i < a.points.length; i += 2) pts.push(`${a.points[i]},${a.points[i + 1]}`);
    g.append(el("polyline", { ...common, points: pts.join(" ") }));
  } else if (a.type === "text") {
    const t = el("text", { x: a.x1, y: a.y1, fill: a.color, "font-size": a.fontSize, "font-weight": 700, "font-family": 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', "dominant-baseline": "hanging" });
    String(a.text).split("\n").forEach((line, i) => {
      const ts = el("tspan", { x: a.x1, dy: i ? a.fontSize * 1.25 : 0 });
      ts.textContent = line || " ";
      t.append(ts);
    });
    g.append(t);
  } else if (a.type === "blur") {
    const b = blurUrls.get(a.id);
    const clipId = `clip-${a.id}`;
    const cp = el("clipPath", { id: clipId });
    cp.append(el("rect", { x, y, width: w, height: hh }));
    g.append(cp);
    if (b) g.append(el("image", { href: b.url, x: b.p.x, y: b.p.y, width: b.p.w, height: b.p.h, preserveAspectRatio: "none", "clip-path": `url(#${clipId})` }));
    else g.append(el("rect", { x, y, width: w, height: hh, fill: "#888", "fill-opacity": 0.6 }));
  }
  return g;
}
function bbox(a) {
  if (a.type === "pen") {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < a.points.length; i += 2) {
      x0 = Math.min(x0, a.points[i]);
      x1 = Math.max(x1, a.points[i]);
      y0 = Math.min(y0, a.points[i + 1]);
      y1 = Math.max(y1, a.points[i + 1]);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (a.type === "text") {
    const lines = String(a.text).split("\n");
    const w = Math.max(...lines.map((l) => l.length)) * a.fontSize * 0.58;
    return { x: a.x1, y: a.y1, w, h: lines.length * a.fontSize * 1.25 };
  }
  return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
}
function renderOverlay(preview = null) {
  if (!svg) return;
  svg.replaceChildren();
  for (const a of doc.annotations) svg.append(annToSvg(a));
  if (preview) svg.append(annToSvg(preview));
  const c = preview?.type === "crop-preview" ? preview.rect : doc.crop;
  if (c) {
    const mask = el("path", { d: `M0 0H${item.width}V${item.height}H0Z M${c.x} ${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z`, fill: "rgba(0,0,0,.5)", "fill-rule": "evenodd" });
    svg.append(mask, el("rect", { x: c.x, y: c.y, width: c.w, height: c.h, class: "sel" }));
  }
  const sel = doc.annotations.find((a) => a.id === selectedId);
  if (sel) {
    const b = bbox(sel);
    const pad2 = 6 / zoom;
    svg.append(el("rect", { x: b.x - pad2, y: b.y - pad2, width: b.w + 2 * pad2, height: b.h + 2 * pad2, class: "sel" }));
    if (["arrow", "rect", "ellipse", "highlight", "blur"].includes(sel.type)) {
      const r = 6 / zoom;
      svg.append(el("circle", { cx: sel.x1, cy: sel.y1, r, class: "handle", "data-handle": "1" }), el("circle", { cx: sel.x2, cy: sel.y2, r, class: "handle", "data-handle": "2" }));
    }
  }
}
function toSource(e) {
  const r = stage.getBoundingClientRect();
  return { x: Math.max(0, Math.min(item.width, (e.clientX - r.left) / zoom)), y: Math.max(0, Math.min(item.height, (e.clientY - r.top) / zoom)) };
}
function hitTest(p) {
  const tol = 8 / zoom;
  for (let i = doc.annotations.length - 1; i >= 0; i--) {
    const a = doc.annotations[i];
    const b = bbox(a);
    if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return a;
  }
  return null;
}
function startTextEdit(p, existing = null) {
  const ta = h("textarea", { class: "text-edit" });
  const fs = (existing?.fontSize || style.fontSize) * zoom;
  Object.assign(ta.style, { left: `${p.x * zoom}px`, top: `${p.y * zoom}px`, fontSize: `${fs}px`, color: existing?.color || style.color, width: `${Math.max(200, fs * 10)}px`, height: `${fs * 1.5}px` });
  ta.value = existing?.text || "";
  stage.append(ta);
  setTimeout(() => ta.focus(), 0);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const text = ta.value.replace(/\s+$/, "");
    ta.remove();
    if (!save) return;
    if (existing) {
      if (!text) commit((d) => {
        d.annotations = d.annotations.filter((a) => a.id !== existing.id);
      });
      else commit((d) => {
        const a = d.annotations.find((x) => x.id === existing.id);
        if (a) a.text = text;
      });
    } else if (text) {
      const a = { id: uid(), type: "text", x1: p.x, y1: p.y, x2: p.x, y2: p.y, text, color: style.color, fontSize: style.fontSize };
      commit((d) => d.annotations.push(a));
      selectedId = a.id;
      renderOverlay();
    }
  };
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") finish(false);
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    }
  });
  ta.addEventListener("blur", () => finish(true));
}
function attachInteraction() {
  let drag = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = toSource(e);
    svg.setPointerCapture(e.pointerId);
    if (tool === "select") {
      const handle = e.target.dataset?.handle;
      const sel = doc.annotations.find((a2) => a2.id === selectedId);
      if (handle && sel) {
        drag = { mode: "handle", handle, id: sel.id, before: snapshot() };
        return;
      }
      const hit = hitTest(p);
      selectedId = hit?.id || null;
      renderOverlay();
      updateToolbarState();
      if (hit) drag = { mode: "move", id: hit.id, start: p, orig: JSON.parse(JSON.stringify(hit)), before: snapshot() };
      return;
    }
    if (tool === "text") {
      const hit = hitTest(p);
      if (hit?.type === "text") startTextEdit({ x: hit.x1, y: hit.y1 }, hit);
      else startTextEdit(p);
      return;
    }
    if (tool === "crop") {
      drag = { mode: "crop", start: p };
      return;
    }
    const a = { id: uid(), type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: tool === "highlight" && style.color === "#ef4444" ? "#facc15" : style.color, width: style.width, fill: style.fill };
    if (tool === "pen") a.points = [p.x, p.y];
    if (tool === "blur") {
      a.mode = style.blurMode;
      a.strength = Math.round(style.strength * (item.scale || 1));
      a.color = "#000";
    }
    drag = { mode: "create", a };
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = toSource(e);
    if (drag.mode === "create") {
      const a = drag.a;
      if (a.type === "pen") a.points.push(p.x, p.y);
      else {
        a.x2 = p.x;
        a.y2 = p.y;
      }
      if (e.shiftKey && (a.type === "rect" || a.type === "ellipse")) {
        const d = Math.max(Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1));
        a.x2 = a.x1 + Math.sign(a.x2 - a.x1 || 1) * d;
        a.y2 = a.y1 + Math.sign(a.y2 - a.y1 || 1) * d;
      }
      renderOverlay(a);
    } else if (drag.mode === "crop") {
      const rect = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
      drag.rect = rect;
      renderOverlay({ type: "crop-preview", rect });
    } else if (drag.mode === "move") {
      const a = doc.annotations.find((x) => x.id === drag.id);
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const o = drag.orig;
      a.x1 = o.x1 + dx;
      a.y1 = o.y1 + dy;
      a.x2 = o.x2 + dx;
      a.y2 = o.y2 + dy;
      if (o.points) a.points = o.points.map((v, i) => v + (i % 2 ? dy : dx));
      renderOverlay();
    } else if (drag.mode === "handle") {
      const a = doc.annotations.find((x) => x.id === drag.id);
      if (drag.handle === "1") {
        a.x1 = p.x;
        a.y1 = p.y;
      } else {
        a.x2 = p.x;
        a.y2 = p.y;
      }
      renderOverlay();
    }
  });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === "create") {
      const a = d.a;
      const b = bbox(a);
      if (a.type === "pen" && a.points.length >= 4 || b.w > 3 || b.h > 3 || a.type === "arrow" && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 4) {
        commit((dd) => dd.annotations.push(a));
        selectedId = a.id;
        renderOverlay();
      } else renderOverlay();
    } else if (d.mode === "crop") {
      if (d.rect && d.rect.w > 8 && d.rect.h > 8) commit((dd) => {
        dd.crop = { x: Math.round(d.rect.x), y: Math.round(d.rect.y), w: Math.round(d.rect.w), h: Math.round(d.rect.h) };
      });
      else renderOverlay();
    } else if (d.mode === "move" || d.mode === "handle") {
      const after = snapshot();
      if (after !== d.before) {
        undoStack.push(d.before);
        redoStack.length = 0;
        changed();
      }
    }
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("dblclick", (e) => {
    const hit = hitTest(toSource(e));
    if (hit?.type === "text") startTextEdit({ x: hit.x1, y: hit.y1 }, hit);
  });
}
function applyZoom() {
  const wrap = $("#wrap");
  if (fitMode) zoom = Math.min(1, (wrap.clientWidth - 40) / item.width);
  stage.style.width = `${Math.round(item.width * zoom)}px`;
  stage.classList.toggle("pixelated", zoom >= 2);
  $("#zoom-ind").textContent = `${Math.round(zoom * 100)}%`;
  renderOverlay();
}
function setZoom(z, anchor) {
  const wrap = $("#wrap");
  const old = zoom;
  fitMode = false;
  zoom = Math.max(0.05, Math.min(8, z));
  const ax = anchor ? anchor.x : wrap.clientWidth / 2;
  const ay = anchor ? anchor.y : wrap.clientHeight / 2;
  const sx = (wrap.scrollLeft + ax) / old;
  const sy = (wrap.scrollTop + ay - 20) / old;
  applyZoom();
  wrap.scrollLeft = sx * zoom - ax;
  wrap.scrollTop = sy * zoom - ay + 20;
}
function updateToolbarState() {
  for (const b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool === tool);
  $("#undo").disabled = !undoStack.length;
  $("#redo").disabled = !redoStack.length;
  $("#del").disabled = !selectedId;
  $("#clear-crop").style.display = doc.crop ? "" : "none";
  $("#rot-ind").textContent = doc.rotation ? `Output rotated ${doc.rotation}\xB0` : "";
  svg.style.cursor = tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";
}
function buildToolbar() {
  const bar = $("#tools");
  for (const [id, ic, title] of TOOLS) {
    const b = h("button", { class: "btn icon", "data-tool": id, title, html: icon(ic) });
    b.addEventListener("click", () => {
      tool = id;
      updateToolbarState();
    });
    bar.append(b);
  }
  bar.append(h("span", { class: "sep" }));
  const color = h("input", { type: "color", value: style.color, title: "Colour", id: "color" });
  color.addEventListener("input", () => {
    style.color = color.value;
    if (selectedId) commit((d) => {
      const a = d.annotations.find((x) => x.id === selectedId);
      if (a && a.type !== "blur") a.color = color.value;
    });
  });
  const width = h("input", { type: "range", min: 1, max: 40, value: style.width, title: "Line width", style: { width: "80px" } });
  width.addEventListener("change", () => {
    style.width = Number(width.value);
    if (selectedId) commit((d) => {
      const a = d.annotations.find((x) => x.id === selectedId);
      if (a) a.width = style.width;
    });
  });
  const font = h("select", { title: "Text size" });
  for (const s of [16, 20, 24, 32, 36, 48, 64, 96, 128]) font.append(h("option", { value: s, selected: s === style.fontSize }, `${s}px`));
  font.addEventListener("change", () => {
    style.fontSize = Number(font.value);
    if (selectedId) commit((d) => {
      const a = d.annotations.find((x) => x.id === selectedId);
      if (a?.type === "text") a.fontSize = style.fontSize;
    });
  });
  const fill = h("input", { type: "checkbox" });
  fill.addEventListener("change", () => {
    style.fill = fill.checked;
  });
  const blurMode = h("select", { title: "Blur style" }, h("option", { value: "blur" }, "Blur"), h("option", { value: "pixelate" }, "Pixelate"), h("option", { value: "solid" }, "Solid box"));
  blurMode.addEventListener("change", () => {
    style.blurMode = blurMode.value;
  });
  bar.append(color, h("label", {}, "Width", width), h("label", {}, "Text", font), h("label", {}, fill, "Fill"), h("label", {}, "Redact", blurMode), h("span", { class: "sep" }));
  const btn = (id, ic, title, fn) => {
    const b = h("button", { class: "btn icon", id, title, html: icon(ic) });
    b.addEventListener("click", fn);
    return b;
  };
  bar.append(
    btn("undo", "undo", "Undo (Ctrl+Z)", undo),
    btn("redo", "redo", "Redo (Ctrl+Y)", redo),
    btn("del", "trash", "Delete selected (Del)", () => {
      if (selectedId) {
        commit((d) => {
          d.annotations = d.annotations.filter((a) => a.id !== selectedId);
        });
        selectedId = null;
        renderOverlay();
        updateToolbarState();
      }
    }),
    h("span", { class: "sep" }),
    btn("rot-l", "rotateL", "Rotate left", () => commit((d) => {
      d.rotation = ((d.rotation || 0) + 270) % 360;
    })),
    btn("rot-r", "rotate", "Rotate right", () => commit((d) => {
      d.rotation = ((d.rotation || 0) + 90) % 360;
    })),
    h("button", { class: "btn", id: "clear-crop", style: { display: "none" }, onclick: () => commit((d) => {
      d.crop = null;
    }) }, "Remove crop"),
    h("span", { class: "small muted", id: "rot-ind" }),
    h("span", { class: "grow" }),
    btn("zoom-out", "zoomOut", "Zoom out", () => setZoom(zoom / 1.25)),
    h("span", { class: "zoom-ind", id: "zoom-ind" }),
    btn("zoom-in", "zoomIn", "Zoom in", () => setZoom(zoom * 1.25)),
    h("button", { class: "btn", onclick: () => {
      fitMode = true;
      applyZoom();
    } }, "Fit"),
    h("button", { class: "btn", onclick: () => setZoom(1) }, "100%"),
    h("button", { class: "btn", id: "preview-result", html: `${icon("image")}<span>Preview result</span>`, onclick: previewResult })
  );
}
function runWorker(job, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker("export-worker.js", { type: "module" });
    const id = uid();
    w.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "progress") onProgress?.(m.progress);
      else if (m.type === "done") {
        w.terminate();
        resolve(m);
      } else if (m.type === "error") {
        w.terminate();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || "Export worker failed"));
    };
    job.cancel = () => {
      w.terminate();
      reject(new Error("Export cancelled"));
    };
    w.postMessage({ ...job, id, cancel: void 0 });
  });
}
function baseJob() {
  return {
    segments: segments.map((s) => ({ blob: s.blob, y: s.y, height: s.height })),
    width: item.width,
    height: item.height,
    doc: JSON.parse(JSON.stringify(doc)),
    scale: item.scale || 1,
    title: item.title,
    quality: Number(settings.jpgQuality) || 95,
    subsampling: settings.chromaSubsampling || "444",
    dpi: Math.round(96 * (item.scale || 1))
  };
}
var exporting = null;
async function doExport(kind) {
  if (exporting) return;
  const prog = $("#exp-progress");
  const bar = prog.querySelector("i");
  const label = $("#exp-label");
  const baseName = $("#exp-name").value.trim() || expandPattern(settings.screenshotPattern, { url: item.url, title: item.title, date: item.createdAt });
  const job = { ...baseJob(), cmd: kind, pdfLayout: $("#pdf-layout").value, pdfPaper: $("#pdf-paper").value, pdfOrientation: $("#pdf-orient").value, pdfMarginMm: Number($("#pdf-margin").value), pdfSmartBreaks: $("#pdf-smart").checked };
  if (kind === "jpeg") job.quality = Number($("#jpg-q").value);
  prog.style.display = "";
  label.textContent = `Exporting ${kind === "jpeg" ? "JPG" : kind.toUpperCase()}\u2026`;
  bar.style.width = "0%";
  const cancelBtn = $("#exp-cancel");
  cancelBtn.style.display = "";
  exporting = job;
  const t0 = performance.now();
  try {
    const res = await runWorker(job, (p) => {
      bar.style.width = `${Math.round(p * 100)}%`;
    });
    const ext = kind === "jpeg" ? "jpg" : kind;
    const files = res.files;
    for (let i = 0; i < files.length; i++) {
      const name = files.length > 1 ? `${baseName}_part${i + 1}of${files.length}` : baseName;
      await downloadBlob(files[i], name, ext, settings);
    }
    const total = files.reduce((a, f) => a + f.size, 0);
    label.textContent = `Saved ${files.length > 1 ? `${files.length} files` : `${ext.toUpperCase()}`} \xB7 ${res.width}\xD7${res.height}px${res.pages ? ` \xB7 ${res.pages} page(s)` : ""} \xB7 ${formatBytes(total)} \xB7 ${((performance.now() - t0) / 1e3).toFixed(1)} s`;
    bar.style.width = "100%";
    if (files.length > 1) toast(`The image exceeds the ${kind === "jpeg" ? "JPEG format" : "browser"} size limit, so it was saved as ${files.length} full-resolution parts.`, "", 7e3);
    else toast("Export complete", "ok");
    window.__lastExport = { kind, width: res.width, height: res.height, sizes: files.map((f) => f.size), pages: res.pages };
  } catch (e) {
    label.textContent = e.message;
    toast(e.message, "error", 6e3);
    window.__lastExport = { error: e.message };
  } finally {
    exporting = null;
    cancelBtn.style.display = "none";
  }
}
async function previewResult() {
  const t = toast("Rendering preview\u2026");
  try {
    const res = await runWorker({ ...baseJob(), cmd: "preview", maxWidth: 1400 });
    t.remove();
    const url = URL.createObjectURL(res.files[0]);
    modal(h(
      "div",
      { class: "col" },
      h("div", { class: "row" }, h("h2", { class: "grow" }, "Result preview"), h("span", { class: "muted" }, `${res.width} \xD7 ${res.height} px (full-resolution export)`)),
      h("img", { src: url, style: { maxWidth: "100%", border: "1px solid var(--border)" } })
    ), { wide: true, onClose: () => URL.revokeObjectURL(url) });
  } catch (e) {
    t.remove();
    toast(e.message, "error");
  }
}
function updateInfo() {
  const out = outputSize(doc, item.width, item.height);
  const info = $("#out-size");
  if (info) info.textContent = `${out.width.toLocaleString()} \xD7 ${out.height.toLocaleString()} px`;
  const warn = $("#jpg-warn");
  if (warn) warn.textContent = out.height > 65535 ? `Taller than the JPEG limit (65,535 px): JPG export creates ${Math.ceil(out.height / 65535)} full-resolution parts. PDF keeps it in one file.` : "";
}
function buildSide() {
  const side = $("#side");
  const out = outputSize(doc, item.width, item.height);
  const sel = (id, opts, v) => {
    const s = h("select", { id });
    for (const [val, l] of opts) s.append(h("option", { value: val, selected: String(val) === String(v) }, l));
    return s;
  };
  const name = h("input", { type: "text", id: "exp-name", value: expandPattern(settings.screenshotPattern, { url: item.url, title: item.title, date: item.createdAt }) });
  const smart = h("input", { type: "checkbox", id: "pdf-smart", checked: settings.pdfSmartBreaks });
  const jpgQ = sel("jpg-q", [[90, "90%"], [95, "95%"], [100, "100% (maximum)"]], settings.jpgQuality);
  jpgQ.addEventListener("change", () => saveSettings({ jpgQuality: Number(jpgQ.value) }).then((s) => {
    settings = s;
  }));
  const pdfLayout = sel("pdf-layout", [["single", "Single long page"], ["paged", "Standard pages (A4 / Letter)"]], settings.pdfLayout);
  const pagedOpts = h(
    "div",
    { class: "col", id: "paged-opts" },
    h(
      "div",
      { class: "row" },
      h("label", { class: "field grow" }, h("span", {}, "Paper"), sel("pdf-paper", [["a4", "A4"], ["letter", "Letter"]], settings.pdfPaper)),
      h("label", { class: "field grow" }, h("span", {}, "Orientation"), sel("pdf-orient", [["portrait", "Portrait"], ["landscape", "Landscape"]], settings.pdfOrientation))
    ),
    h(
      "div",
      { class: "row" },
      h("label", { class: "field grow" }, h("span", {}, "Margins (mm)"), h("input", { type: "number", id: "pdf-margin", min: 0, max: 50, value: settings.pdfMarginMm })),
      h("label", { class: "check", style: { marginTop: "16px" } }, smart, "Smart page breaks")
    )
  );
  const updPaged = () => {
    pagedOpts.style.display = pdfLayout.value === "paged" ? "" : "none";
  };
  pdfLayout.addEventListener("change", updPaged);
  const status = item.status === "truncated" ? h("div", { class: "notice warn small" }, "This capture was limited by the maximum capture height.") : null;
  side.replaceChildren(
    h(
      "div",
      { class: "col" },
      h("h3", {}, "Capture"),
      h(
        "dl",
        { class: "kv" },
        h("dt", {}, "Captured"),
        h("dd", {}, formatDate(item.createdAt)),
        h("dt", {}, "Dimensions"),
        h("dd", { id: "src-size" }, `${item.width.toLocaleString()} \xD7 ${item.height.toLocaleString()} px`),
        h("dt", {}, "Page size"),
        h("dd", {}, `${item.cssWidth?.toLocaleString()} \xD7 ${item.cssHeight?.toLocaleString()} CSS px @ ${(+item.scale || 1).toFixed(2)}\xD7`),
        h("dt", {}, "Stored"),
        h("dd", {}, `${formatBytes(item.size)} lossless PNG`),
        h("dt", {}, "Sections"),
        h("dd", {}, `${item.frames} screenshot(s) \xB7 ${item.segments.length} segment(s)`),
        h("dt", {}, "Status"),
        h("dd", {}, item.status === "complete" ? "\u2713 Complete" : item.status)
      ),
      status,
      ...(item.warnings || []).map((w) => h("div", { class: "notice warn small" }, w))
    ),
    h("hr"),
    h(
      "div",
      { class: "col", id: "export-panel" },
      h("h3", {}, "Export"),
      h("div", { class: "small muted" }, "Output: ", h("b", { id: "out-size" }, `${out.width} \xD7 ${out.height} px`), " \u2013 full captured resolution"),
      h("label", { class: "field" }, h("span", {}, "File name"), name),
      h("label", { class: "field" }, h("span", {}, "JPG quality"), jpgQ),
      h("button", { class: "btn primary", id: "export-jpg", html: `${icon("download")}<span>Download JPG</span>`, onclick: () => doExport("jpeg") }),
      h("div", { class: "small muted" }, "JPG is a lossy format: even at 100% some detail is approximated. Use PNG for pixel-exact copies."),
      h("div", { class: "small", id: "jpg-warn", style: { color: "var(--warn)" } }),
      h("label", { class: "field" }, h("span", {}, "PDF layout"), pdfLayout),
      pagedOpts,
      h("button", { class: "btn primary", id: "export-pdf", html: `${icon("download")}<span>Download PDF</span>`, onclick: () => doExport("pdf") }),
      h("button", { class: "btn", id: "export-png", html: `${icon("download")}<span>Download PNG (lossless)</span>`, onclick: () => doExport("png") }),
      h("div", { id: "exp-progress", class: "col", style: { display: "none" } }, h("div", { class: "progress" }, h("i")), h("div", { class: "row" }, h("span", { class: "small grow", id: "exp-label" }), h("button", { class: "btn danger", id: "exp-cancel", style: { display: "none" }, onclick: () => exporting?.cancel?.() }, "Cancel")))
    ),
    h("hr"),
    h("div", { class: "small muted" }, "Edits are applied to a working copy; the original capture is kept unchanged. ", h("a", { href: "#", onclick: async (e) => {
      e.preventDefault();
      commit((d) => {
        d.annotations = [];
        d.crop = null;
        d.rotation = 0;
      });
    } }, "Reset all edits"))
  );
  updPaged();
  updateInfo();
}
async function init() {
  await applyTheme();
  settings = await getSettings();
  item = await getItem(itemId);
  stage = $("#stage");
  if (!item || item.kind !== "screenshot") {
    stage.replaceChildren(h("div", { class: "loading" }, "This capture was not found. It may have been deleted."));
    $("#title").textContent = "Not found";
    return;
  }
  document.title = `${item.title} \u2013 FullPage HD Capture`;
  $("#title").textContent = item.title;
  const u = $("#url");
  u.textContent = item.url;
  u.href = item.url || "#";
  $("#status").textContent = `${item.width}\xD7${item.height}`;
  segments = [];
  for (const s of item.segments) {
    const blob = await getBlob(s.key);
    if (!blob) {
      stage.replaceChildren(h("div", { class: "loading" }, "Part of this capture is missing from storage."));
      return;
    }
    segments.push({ ...s, blob });
  }
  doc = await getProject(itemId) || doc;
  doc.annotations ||= [];
  stage.replaceChildren();
  for (const s of segments) {
    const img = h("img", { src: URL.createObjectURL(s.blob), loading: "lazy", decoding: "async", alt: "", draggable: "false", width: item.width, height: s.height });
    stage.append(img);
  }
  svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "overlay");
  svg.setAttribute("viewBox", `0 0 ${item.width} ${item.height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  stage.append(svg);
  buildToolbar();
  buildSide();
  attachInteraction();
  applyZoom();
  updateToolbarState();
  refreshBlurPatches();
  addEventListener("resize", () => {
    if (fitMode) applyZoom();
  });
  $("#wrap").addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = $("#wrap").getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (k === "delete" || k === "backspace") {
      if (selectedId) {
        commit((d) => {
          d.annotations = d.annotations.filter((a) => a.id !== selectedId);
        });
        selectedId = null;
        renderOverlay();
        updateToolbarState();
      }
      return;
    }
    if (k === "escape") {
      selectedId = null;
      tool = "select";
      renderOverlay();
      updateToolbarState();
      return;
    }
    const map = { v: "select", a: "arrow", r: "rect", e: "ellipse", h: "highlight", t: "text", p: "pen", b: "blur", c: "crop" };
    if (map[k] && !e.ctrlKey && !e.metaKey) {
      tool = map[k];
      updateToolbarState();
    }
  });
  if (params.get("edit")) {
    tool = "arrow";
    updateToolbarState();
  }
  if (params.get("export")) $("#export-panel").scrollIntoView();
  $("#title").title = "Double-click to rename";
  $("#title").addEventListener("dblclick", async () => {
    const t = prompt("Rename capture", item.title);
    if (t && t.trim()) {
      item = await updateItem(item.id, { title: t.trim() });
      $("#title").textContent = item.title;
    }
  });
  window.__ready = true;
}
init().catch((e) => {
  console.error(e);
  toast(e.message, "error");
});
//# sourceMappingURL=screenshot.js.map
