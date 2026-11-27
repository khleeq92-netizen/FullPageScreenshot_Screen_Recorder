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
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings || {} };
}
async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
async function resetSettings() {
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
  return { ...DEFAULT_SETTINGS };
}

// src/shared/ui.js
var $ = (s, r = document) => r.querySelector(s);
var $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
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
function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra }).then((r) => {
    if (r && r.ok === false) throw new Error(r.error || "Request failed");
    return r;
  });
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
function promptText(title, value = "") {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", value, style: { width: "100%" } });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal(h(
      "div",
      { class: "col", style: { width: "420px", maxWidth: "80vw" } },
      h("h2", {}, title),
      input,
      h(
        "div",
        { class: "row", style: { justifyContent: "flex-end" } },
        h("button", { class: "btn", onclick: () => finish(null) }, "Cancel"),
        h("button", { class: "btn primary", onclick: () => finish(input.value) }, "OK")
      )
    ), { onClose: () => finish(null) });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(input.value);
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}
function confirmDialog(title, text, okLabel = "OK", danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal(h(
      "div",
      { class: "col", style: { width: "420px", maxWidth: "80vw" } },
      h("h2", {}, title),
      h("p", { class: "muted" }, text),
      h(
        "div",
        { class: "row", style: { justifyContent: "flex-end" } },
        h("button", { class: "btn", onclick: () => finish(false) }, "Cancel"),
        h("button", { class: `btn ${danger ? "danger solid" : "primary"}`, onclick: () => finish(true) }, okLabel)
      )
    ), { onClose: () => finish(false) });
  });
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
function newId(prefix = "c") {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${rnd[0].toString(36)}${rnd[1].toString(36)}`;
}
var putItem = (item) => tx(["items"], "readwrite", (t) => promisify(t.objectStore("items").put(item)));
var getItem = (id) => tx(["items"], "readonly", (t) => promisify(t.objectStore("items").get(id)));
async function listItems() {
  const all = await tx(["items"], "readonly", (t) => promisify(t.objectStore("items").getAll()));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
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
async function deleteItem(id) {
  const item = await getItem(id);
  if (!item) return;
  const keys = blobKeysOf(item);
  await tx(["items", "blobs", "projects"], "readwrite", (t) => {
    t.objectStore("items").delete(id);
    t.objectStore("projects").delete(id);
    for (const k of keys) t.objectStore("blobs").delete(k);
  });
}
function blobKeysOf(item) {
  const keys = [];
  if (item.blobKey) keys.push(item.blobKey);
  if (item.thumbKey) keys.push(item.thumbKey);
  if (item.webcamBlobKey) keys.push(item.webcamBlobKey);
  for (const s of item.segments || []) if (s.key) keys.push(s.key);
  return keys;
}
var putBlob = (key, blob) => tx(["blobs"], "readwrite", (t) => promisify(t.objectStore("blobs").put({ key, blob })));
async function getBlob(key) {
  const r = await tx(["blobs"], "readonly", (t) => promisify(t.objectStore("blobs").get(key)));
  return r ? r.blob : null;
}
async function getChunks(recId) {
  const rows = await tx(["chunks"], "readonly", (t) => promisify(t.objectStore("chunks").index("recId").getAll(recId)));
  return rows.sort((a, b) => a.seq - b.seq).map((r) => r.blob);
}
async function deleteChunks(recId) {
  return tx(["chunks"], "readwrite", (t) => {
    const idx = t.objectStore("chunks").index("recId");
    const req = idx.openKeyCursor(IDBKeyRange.only(recId));
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        t.objectStore("chunks").delete(c.primaryKey);
        c.continue();
      }
    };
  });
}
async function listChunkSets() {
  const rows = await tx(["chunks"], "readonly", (t) => promisify(t.objectStore("chunks").getAll()));
  const sets = {};
  for (const r of rows) {
    const s = sets[r.recId] ||= { count: 0, bytes: 0, lastAt: 0 };
    s.count++;
    s.bytes += r.blob.size;
    s.lastAt = Math.max(s.lastAt, r.at || 0);
  }
  return sets;
}
async function clearAll() {
  await tx(["items", "blobs", "chunks", "projects"], "readwrite", (t) => {
    for (const s of ["items", "blobs", "chunks", "projects"]) t.objectStore(s).clear();
  });
}
async function cleanupTemporary({ keepRecId = null } = {}) {
  const items = await listItems();
  const referenced = new Set(items.flatMap(blobKeysOf));
  const keys = await tx(["blobs"], "readonly", (t) => promisify(t.objectStore("blobs").getAllKeys()));
  const orphans = keys.filter((k) => !referenced.has(k) && !String(k).startsWith("pending:"));
  const sets = await listChunkSets();
  await tx(["blobs"], "readwrite", (t) => {
    for (const k of orphans) t.objectStore("blobs").delete(k);
  });
  let chunkSets = 0;
  for (const recId of Object.keys(sets)) {
    if (recId === keepRecId) continue;
    await deleteChunks(recId);
    chunkSets++;
  }
  let opfsFiles = 0;
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) {
      if (name.startsWith("tmp-")) {
        await root.removeEntry(name).catch(() => {
        });
        opfsFiles++;
      }
    }
  } catch {
  }
  return { orphanBlobs: orphans.length, chunkSets, opfsFiles };
}

// src/screenshot/capture-controller.js
function restrictionReason(url) {
  if (!url) return "This page cannot be captured: Chrome does not let extensions access its internal pages (chrome://, the Web Store, other extensions), or access to this tab was not granted.";
  if (/^(chrome|edge|brave|opera|vivaldi|about|devtools|chrome-search|chrome-untrusted|view-source):/i.test(url)) {
    return "Chrome does not allow extensions to capture its internal pages (chrome://, about:, etc.).";
  }
  if (/^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url)) {
    return "Chrome blocks extensions on Chrome Web Store pages.";
  }
  if (/^chrome-extension:/i.test(url)) return "Pages of other extensions cannot be captured.";
  if (/^(data|blob|javascript):/i.test(url)) return "This kind of page (data:/blob: URL) cannot be scripted for full-page capture.";
  if (/^https?:\/\/[^/]*\.pdf(\b|$)/i.test(url) || /\.pdf(\?|#|$)/i.test(url)) return null;
  return null;
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
function formatDuration(sec, withMs = false) {
  if (sec == null || !isFinite(sec)) return "\u2014";
  sec = Math.max(0, sec);
  const h2 = Math.floor(sec / 3600);
  const m = Math.floor(sec % 3600 / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor(sec % 1 * 100);
  const base = h2 > 0 ? `${h2}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return withMs ? `${base}.${String(ms).padStart(2, "0")}` : base;
}
function formatDate(ts) {
  return new Date(ts).toLocaleString(void 0, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// src/app/common.js
async function capturableTabs() {
  const tabs = await chrome.tabs.query({});
  const self = chrome.runtime.getURL("");
  return tabs.filter((t) => t.url && !t.url.startsWith(self));
}
function tabSelect(tabs, selectedId) {
  const s = h("select", { class: "grow", style: { maxWidth: "520px" } });
  if (!tabs.length) s.append(h("option", { value: "" }, "No open tabs"));
  for (const t of tabs) {
    const bad = restrictionReason(t.url);
    s.append(h("option", { value: t.id, selected: t.id === selectedId, disabled: !!bad }, `${bad ? "\u26D4 " : ""}${t.title || t.url}`.slice(0, 110)));
  }
  return s;
}
async function ensureHostAccess(tab) {
  let origin;
  try {
    const u = new URL(tab.url);
    origin = u.protocol === "file:" ? "file:///*" : `${u.origin}/*`;
  } catch {
    return false;
  }
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch (e) {
    toast(e.message, "error");
    return false;
  }
}
async function startTabCapture(tabId, mode) {
  const tab = await chrome.tabs.get(Number(tabId));
  const reason = restrictionReason(tab.url);
  if (reason && mode !== "visible") throw new Error(reason);
  if (!await ensureHostAccess(tab)) throw new Error("Site access is required to capture a tab from the dashboard. (Tip: clicking the toolbar icon on the page works without granting access.)");
  await send("capture:start", { mode, tabId: tab.id });
}
function itemUrl(it) {
  return chrome.runtime.getURL(it.kind === "video" ? `video-editor.html?id=${encodeURIComponent(it.id)}` : `screenshot.html?id=${encodeURIComponent(it.id)}`);
}
function captureCard(it, actions = []) {
  const thumb = h(
    "div",
    { class: "thumb", title: "Open" },
    h("span", { class: "badge kind" }, it.kind === "video" ? "VIDEO" : it.mode === "visible" ? "VISIBLE" : it.mode === "recording-frame" ? "FRAME" : "FULL PAGE"),
    it.kind === "video" ? h("span", { class: "dur" }, formatDuration(it.duration)) : null
  );
  thumb.addEventListener("click", () => chrome.tabs.create({ url: itemUrl(it) }));
  if (it.thumbKey) getBlob(it.thumbKey).then((b) => {
    if (b) thumb.style.backgroundImage = `url(${URL.createObjectURL(b)})`;
  });
  const res = it.width ? `${it.width}\xD7${it.height}` : "";
  const meta = [formatDate(it.createdAt), (it.format || "").toUpperCase(), formatBytes(it.size), res, it.kind === "video" && it.fps ? `${it.fps} fps` : ""].filter(Boolean).join(" \xB7 ");
  const acts = h("div", { class: "acts" });
  for (const a of actions) {
    const b = h("button", { class: `btn ghost ${a.cls || ""}`, title: a.title || a.label, html: `${icon(a.icon)}<span>${a.label}</span>` });
    b.addEventListener("click", () => a.run(it));
    acts.append(b);
  }
  return h(
    "div",
    { class: "cap-card", "data-id": it.id },
    thumb,
    h(
      "div",
      { class: "body" },
      h("div", { class: "title", title: it.title }, it.title || "Untitled"),
      it.url ? h("div", { class: "url", title: it.url }, it.url) : null,
      h("div", { class: "meta" }, meta),
      it.status && it.status !== "complete" ? h("div", { class: "meta", style: { color: "var(--warn)" } }, it.status) : null
    ),
    actions.length ? acts : null
  );
}

// src/webcam/webcam-layout.js
function webcamRect(outW, outH, o) {
  const sizePct = Math.max(5, Math.min(60, Number(o.size ?? o.webcamSize ?? 22)));
  const shape = o.shape ?? o.webcamShape ?? "circle";
  const camAspect = o.camAspect || 16 / 9;
  const w = Math.round(outW * sizePct / 100);
  const h2 = shape === "circle" ? w : Math.round(w / camAspect);
  const m = Math.round(Math.min(outW, outH) * 0.03);
  const pos = o.position ?? o.webcamPosition ?? "bottom-right";
  let x;
  let y;
  if (pos === "top-left") {
    x = m;
    y = m;
  } else if (pos === "top-right") {
    x = outW - w - m;
    y = m;
  } else if (pos === "bottom-left") {
    x = m;
    y = outH - h2 - m;
  } else if (pos === "custom") {
    x = Math.round((o.x ?? o.webcamX ?? 0.75) * outW);
    y = Math.round((o.y ?? o.webcamY ?? 0.7) * outH);
  } else {
    x = outW - w - m;
    y = outH - h2 - m;
  }
  x = Math.max(0, Math.min(outW - w, x));
  y = Math.max(0, Math.min(outH - h2, y));
  return { x, y, w, h: h2, shape };
}

// src/screen-recorder/codecs.js
var RESOLUTIONS = {
  "720": [1280, 720],
  "1080": [1920, 1080],
  "1440": [2560, 1440],
  "2160": [3840, 2160],
  source: [7680, 4320]
};

// src/screen-recorder/recorder-view.js
async function permState(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return "prompt";
  }
}
function stopStream(s) {
  s?.getTracks().forEach((t) => t.stop());
}
async function renderRecorder({ view: view2, params, head: head2 }) {
  let s = await getSettings();
  const resources = { mic: null, cam: null, ctx: null, raf: 0 };
  const save = async (patch) => {
    s = await saveSettings(patch);
  };
  const field = (label, el, hint) => h("label", { class: "field" }, h("span", {}, label), el, hint ? h("span", { class: "small", style: { fontWeight: 400 } }, hint) : null);
  const select = (key, opts, onChange) => {
    const el = h("select", { id: `opt-${key}` });
    for (const [v, l] of opts) el.append(h("option", { value: v, selected: String(s[key]) === String(v) }, l));
    el.addEventListener("change", async () => {
      await save({ [key]: typeof s[key] === "number" ? Number(el.value) : el.value });
      onChange?.();
    });
    return el;
  };
  const check = (key, label, onChange) => {
    const c = h("input", { type: "checkbox", id: `opt-${key}`, checked: !!s[key] });
    c.addEventListener("change", async () => {
      await save({ [key]: c.checked });
      onChange?.();
    });
    return h("label", { class: "check" }, c, label);
  };
  const active = h("div", { class: "card col", id: "rec-active", style: { display: "none", marginBottom: "16px" } });
  const renderActive = (st) => {
    if (!st?.active) {
      active.style.display = "none";
      return;
    }
    active.style.display = "";
    const paused = st.state === "paused";
    const btn = (id, ic, label, fn, cls = "") => {
      const b = h("button", { class: `btn ${cls}`, id, html: `${icon(ic)}<span>${label}</span>` });
      b.addEventListener("click", fn);
      return b;
    };
    active.replaceChildren(
      h(
        "div",
        { class: "row" },
        h("span", { class: `badge ${paused ? "" : "rec"}` }, st.state === "countdown" ? `Starting in ${st.countdown}` : paused ? "PAUSED" : st.state === "recording" ? "\u25CF REC" : st.state),
        h("b", { style: { fontSize: "26px", fontVariantNumeric: "tabular-nums" } }, formatDuration(st.elapsed || 0)),
        h("span", { class: "muted grow" }, `${st.width || "?"}\xD7${st.height || "?"} \xB7 ${st.fps || st.targetFps || "?"} fps \xB7 ${formatBytes(st.bytes)} \xB7 ${st.mimeType || ""}`)
      ),
      h(
        "div",
        { class: "row wrap" },
        btn("ctl-pause", paused ? "play" : "pause", paused ? "Resume" : "Pause", () => send(paused ? "rec:resume" : "rec:pause")),
        btn("ctl-stop", "stop", "Stop & save", () => send("rec:stop"), "primary"),
        btn("ctl-mute", st.muted ? "micOff" : "mic", st.muted ? "Unmute mic" : "Mute mic", () => send("rec:mute", { muted: !st.muted })),
        st.webcam ? btn("ctl-cam", "webcam", st.webcamVisible ? "Hide webcam" : "Show webcam", () => send("rec:webcam", { enabled: !st.webcamVisible }).catch((e) => toast(e.message, "error"))) : null,
        btn("ctl-annot", "pen", "Annotate on page", () => send("rec:annotate-toggle")),
        btn("ctl-shot", "camera", "Screenshot", () => send("rec:screenshot").then(() => toast("Frame saved to Capture History", "ok"))),
        btn("ctl-cancel", "x", "Discard", () => {
          if (confirm("Discard this recording?")) send("rec:cancel");
        }, "danger")
      ),
      st.hasMic ? h("div", { class: "meter", style: { maxWidth: "320px" } }, h("i", { style: { width: `${Math.round((st.muted ? 0 : st.micLevel) * 100)}%` } })) : null,
      (st.warnings || []).length ? h("div", { class: "notice warn" }, ...st.warnings.map((w) => h("div", {}, w))) : null
    );
  };
  const grant = params.get("grant");
  const grantBox = h("div", { class: "notice warn col", style: { display: grant ? "" : "none", marginBottom: "16px" } });
  if (grant) {
    const wants = grant.split(",");
    const b = h("button", { class: "btn primary", id: "grant-btn" }, `Allow ${wants.map((w) => w === "mic" ? "microphone" : "camera").join(" & ")}`);
    b.addEventListener("click", async () => {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: wants.includes("mic"), video: wants.includes("cam") });
        stopStream(st);
        grantBox.replaceChildren(h("b", {}, "\u2713 Access granted."), h("span", {}, "Go back to the tab you want to record and press Record in the extension popup again \u2014 or start a recording from this page below."));
        refreshDevices();
      } catch (e) {
        grantBox.replaceChildren(h("b", {}, "Access was blocked."), h("span", {}, `Chrome reported: ${e.name}. Click the camera/microphone icon in the address bar of this page to allow it, then reload.`));
      }
    });
    grantBox.append(h("b", {}, "Permission needed"), h("span", {}, "The recorder runs in a hidden background document that cannot show permission prompts. Grant access once here; Chrome remembers it for this extension."), h("div", {}, b));
  }
  const tabs = await capturableTabs();
  const tabSel = tabSelect(tabs.filter((t) => !restrictionReason(t.url)), Number(params.get("tab")) || void 0);
  let source = s.recSource === "tab" ? "tab" : "screen";
  const srcSeg = h("div", { class: "seg", id: "src-seg" });
  const srcNote = h("div", { class: "muted small" });
  const tabRow = h("div", { class: "row" }, h("span", { class: "small muted" }, "Tab:"), tabSel);
  for (const [v, l] of [["tab", "Chrome tab"], ["screen", "Entire screen / window"]]) {
    const b = h("button", { class: v === source ? "sel" : "" }, l);
    b.addEventListener("click", async () => {
      source = v;
      [...srcSeg.children].forEach((c) => c.classList.toggle("sel", c === b));
      await save({ recSource: v });
      updSrc();
    });
    srcSeg.append(b);
  }
  const updSrc = () => {
    tabRow.style.display = source === "tab" ? "" : "none";
    srcNote.textContent = source === "tab" ? "Records the selected tab\u2019s web content only (no address bar or browser UI). Supports tab audio, click effects and on-page annotation. Site access to the tab is requested once." : "Chrome\u2019s screen picker lets you choose an entire screen, an application window or a tab. System audio is offered by Chrome where the platform supports it (Windows/ChromeOS: entire screen; all platforms: tabs).";
  };
  updSrc();
  const micSel = h("select", { id: "mic-select" });
  const camSel = h("select", { id: "cam-select" });
  const meter = h("div", { class: "meter", style: { flex: 1 } }, h("i"));
  const micStatus = h("span", { class: "small muted" });
  async function refreshDevices() {
    let devs = [];
    try {
      devs = await navigator.mediaDevices.enumerateDevices();
    } catch {
    }
    const mics = devs.filter((d) => d.kind === "audioinput");
    const cams = devs.filter((d) => d.kind === "videoinput");
    const fill = (sel, list, cur, noun) => {
      sel.replaceChildren(h("option", { value: "" }, `Default ${noun}`));
      list.forEach((d, i) => {
        if (d.deviceId && d.deviceId !== "default") sel.append(h("option", { value: d.deviceId, selected: d.deviceId === cur }, d.label || `${noun} ${i + 1}`));
      });
    };
    fill(micSel, mics, s.micDeviceId, "microphone");
    fill(camSel, cams, s.webcamDeviceId, "camera");
    micStatus.textContent = !mics.length ? "No microphone found." : await permState("microphone") !== "granted" ? "Microphone access not granted yet." : `${mics.length} microphone(s) available.`;
  }
  micSel.addEventListener("change", async () => {
    await save({ micDeviceId: micSel.value });
    if (resources.mic) startMicMonitor();
  });
  camSel.addEventListener("change", async () => {
    await save({ webcamDeviceId: camSel.value });
    if (resources.cam) startCamPreview();
  });
  async function startMicMonitor() {
    stopStream(resources.mic);
    resources.ctx?.close();
    cancelAnimationFrame(resources.raf);
    try {
      resources.mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: s.micDeviceId ? { exact: s.micDeviceId } : void 0, echoCancellation: s.micEchoCancellation } });
      resources.ctx = new AudioContext();
      const an = resources.ctx.createAnalyser();
      an.fftSize = 2048;
      resources.ctx.createMediaStreamSource(resources.mic).connect(an);
      const buf = new Float32Array(2048);
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        meter.firstChild.style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 400)}%`;
        resources.raf = requestAnimationFrame(loop);
      };
      loop();
      micStatus.textContent = `Listening: ${resources.mic.getAudioTracks()[0]?.label || "microphone"}`;
      refreshDevices();
    } catch (e) {
      micStatus.textContent = `Microphone unavailable: ${e.name === "NotAllowedError" ? "permission denied" : e.name === "NotFoundError" ? "no device" : e.message}`;
    }
  }
  const testBtn = h("button", { class: "btn", id: "mic-test", html: `${icon("mic")}<span>Test (record 3 s)</span>` });
  testBtn.addEventListener("click", async () => {
    try {
      if (!resources.mic) await startMicMonitor();
      if (!resources.mic) return;
      testBtn.disabled = true;
      testBtn.lastChild.textContent = "Recording\u2026";
      const mr = new MediaRecorder(resources.mic);
      const parts = [];
      mr.ondataavailable = (e) => parts.push(e.data);
      mr.start();
      await new Promise((r) => setTimeout(r, 3e3));
      mr.stop();
      await new Promise((r) => {
        mr.onstop = r;
      });
      testBtn.lastChild.textContent = "Playing back\u2026";
      const a = new Audio(URL.createObjectURL(new Blob(parts, { type: mr.mimeType })));
      await a.play().catch(() => {
      });
      a.onended = () => {
        testBtn.disabled = false;
        testBtn.lastChild.textContent = "Test (record 3 s)";
      };
    } catch (e) {
      toast(e.message, "error");
      testBtn.disabled = false;
    }
  });
  const stage = h("div", { class: "preview-stage", id: "cam-stage" }, h("div", { class: "fake" }));
  const camBox = h("div", { class: "cam", style: { display: "none" } }, h("video", { autoplay: true, muted: true, playsinline: true }));
  stage.append(camBox);
  const layoutCam = () => {
    const W = stage.clientWidth || 640;
    const H = stage.clientHeight || 360;
    const vid = camBox.firstChild;
    const r = webcamRect(W, H, { ...s, camAspect: vid.videoWidth ? vid.videoWidth / vid.videoHeight : 16 / 9 });
    Object.assign(camBox.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: r.shape === "circle" ? "50%" : "8%", opacity: s.webcamOpacity / 100 });
  };
  async function startCamPreview() {
    stopStream(resources.cam);
    try {
      resources.cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: s.webcamDeviceId ? { exact: s.webcamDeviceId } : void 0, width: { ideal: 1280 }, height: { ideal: 720 } } });
      camBox.firstChild.srcObject = resources.cam;
      camBox.style.display = "";
      camBox.firstChild.onloadedmetadata = layoutCam;
      layoutCam();
      refreshDevices();
    } catch (e) {
      toast(`Camera unavailable: ${e.name === "NotAllowedError" ? "permission denied" : e.name === "NotFoundError" ? "no camera found" : e.message}`, "error");
    }
  }
  camBox.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const sr = stage.getBoundingClientRect();
    const br = camBox.getBoundingClientRect();
    const ox = e.clientX - br.left;
    const oy = e.clientY - br.top;
    camBox.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const x = Math.max(0, Math.min(1 - br.width / sr.width, (ev.clientX - sr.left - ox) / sr.width));
      const y = Math.max(0, Math.min(1 - br.height / sr.height, (ev.clientY - sr.top - oy) / sr.height));
      s.webcamPosition = "custom";
      s.webcamX = x;
      s.webcamY = y;
      posSel.value = "custom";
      layoutCam();
    };
    const up = () => {
      camBox.removeEventListener("pointermove", mv);
      camBox.removeEventListener("pointerup", up);
      save({ webcamPosition: "custom", webcamX: s.webcamX, webcamY: s.webcamY });
    };
    camBox.addEventListener("pointermove", mv);
    camBox.addEventListener("pointerup", up);
  });
  const posSel = select("webcamPosition", [["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"], ["custom", "Custom (drag preview)"]], layoutCam);
  const size = h("input", { type: "range", min: 8, max: 45, value: s.webcamSize, id: "opt-webcamSize" });
  size.addEventListener("input", () => {
    s.webcamSize = Number(size.value);
    layoutCam();
  });
  size.addEventListener("change", () => save({ webcamSize: Number(size.value) }));
  const opa = h("input", { type: "range", min: 20, max: 100, value: s.webcamOpacity, id: "opt-webcamOpacity" });
  opa.addEventListener("input", () => {
    s.webcamOpacity = Number(opa.value);
    layoutCam();
  });
  opa.addEventListener("change", () => save({ webcamOpacity: Number(opa.value) }));
  const startBtn = h("button", { class: "hero-btn record", id: "rec-start", style: { minHeight: "64px", width: "100%" }, html: `${icon("record")}<span>START RECORDING</span><small id="start-sub"></small>` });
  const capInfo = h("div", { class: "small muted", id: "cap-info" });
  const updInfo = () => {
    const [w, hh] = RESOLUTIONS[s.recResolution] || [1920, 1080];
    capInfo.textContent = `Requested: up to ${s.recResolution === "source" ? "source resolution" : `${w}\xD7${hh}`} at ${s.recFps} fps. The actual size and frame rate depend on the selected source and are shown once recording starts; video is never upscaled.`;
  };
  updInfo();
  startBtn.addEventListener("click", async () => {
    const needMic = s.recAudio === "mic" || s.recAudio === "both";
    try {
      if (needMic && await permState("microphone") !== "granted") {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(stopStream);
      }
      if (s.webcamEnabled && await permState("camera") !== "granted") {
        await navigator.mediaDevices.getUserMedia({ video: true }).then(stopStream);
      }
    } catch (e) {
      toast(`Permission denied: ${e.message}. You can still record without it.`, "error", 6e3);
      return;
    }
    stopStream(resources.mic);
    resources.mic = null;
    stopStream(resources.cam);
    resources.cam = null;
    camBox.style.display = "none";
    startBtn.disabled = true;
    try {
      let req = { source, config: s };
      if (source === "tab") {
        const tab = await chrome.tabs.get(Number(tabSel.value)).catch(() => null);
        if (!tab) throw new Error("Choose a tab to record.");
        if (!await ensureHostAccess(tab)) throw new Error("Site access is needed to record a tab from the dashboard. Alternatively use the popup on that tab.");
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        req = { ...req, tabId: tab.id, allowPicker: true };
      }
      const r = await send("rec:start", req);
      if (r?.cancelled) toast("Recording cancelled.");
    } catch (e) {
      toast(e.message, "error", 7e3);
    }
    startBtn.disabled = false;
  });
  const codecOpts = [["vp9", "VP9 (WebM) \u2013 best quality/size"], ["vp8", "VP8 (WebM) \u2013 fastest"], ["av1", "AV1 (WebM) \u2013 smallest, slow"], ["h264", "H.264 \u2013 most compatible"]].filter(([c]) => ({ vp9: "video/webm;codecs=vp9", vp8: "video/webm;codecs=vp8", av1: "video/webm;codecs=av01", h264: "video/webm;codecs=h264" })[c] && (MediaRecorder.isTypeSupported({ vp9: "video/webm;codecs=vp9", vp8: "video/webm;codecs=vp8", av1: "video/webm;codecs=av01", h264: "video/webm;codecs=h264" }[c]) || c === "h264" && MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")));
  view2.replaceChildren(
    head2("Screen Recorder", "Record a Chrome tab, an application window or your entire screen \u2014 with microphone, webcam and annotations."),
    grantBox,
    active,
    h(
      "div",
      { class: "grid-2" },
      h(
        "div",
        { class: "col", style: { gap: "16px" } },
        h("div", { class: "card col" }, h("h2", {}, "Source"), srcSeg, tabRow, srcNote),
        h(
          "div",
          { class: "card col" },
          h("h2", {}, "Video quality"),
          h(
            "div",
            { class: "form-grid" },
            field("Resolution", select("recResolution", [["720", "720p (1280\xD7720)"], ["1080", "1080p (1920\xD71080)"], ["1440", "1440p (2560\xD71440)"], ["2160", "4K (3840\xD72160) where supported"], ["source", "Source / maximum"]], updInfo)),
            field("Frame rate", select("recFps", [[24, "24 FPS"], [30, "30 FPS"], [60, "60 FPS"]], updInfo)),
            field("Quality preset", select("recQuality", [["standard", "Standard"], ["high", "High"], ["max", "Maximum practical quality"], ["custom", "Custom bitrate"]], () => {
              bitrate.disabled = s.recQuality !== "custom";
            })),
            field("Bitrate (Mbps)", (() => {
              const el = h("input", { type: "number", id: "opt-bitrate", min: 0.5, max: 120, step: 0.5, value: s.recBitrateMbps, disabled: s.recQuality !== "custom" });
              el.addEventListener("change", () => save({ recBitrateMbps: Number(el.value) }));
              return el;
            })()),
            field("Codec", select("recCodec", codecOpts))
          ),
          capInfo
        ),
        h(
          "div",
          { class: "card col" },
          h("h2", {}, "Audio"),
          field("Audio source", select("recAudio", [["none", "No audio"], ["mic", "Microphone only"], ["tab", "Tab / system audio"], ["both", "Microphone + tab/system audio"]])),
          h("div", { class: "small muted" }, "Tab audio comes directly from the recorded tab (you keep hearing it). System audio is only available when Chrome offers \u201CShare system audio\u201D for the chosen screen (Windows, ChromeOS)."),
          field("Microphone", micSel),
          h("div", { class: "row" }, h("button", { class: "btn", id: "mic-monitor", html: `${icon("volume")}<span>Check level</span>`, onclick: startMicMonitor }), testBtn, meter),
          micStatus,
          check("micEchoCancellation", "Echo cancellation (recommended with speakers)")
        )
      ),
      h(
        "div",
        { class: "col", style: { gap: "16px" } },
        h(
          "div",
          { class: "card col" },
          h("div", { class: "row" }, h("h2", { class: "grow" }, "Webcam overlay"), check("webcamEnabled", "Enabled")),
          field("Camera", camSel),
          stage,
          h("div", { class: "row wrap" }, h("button", { class: "btn", id: "cam-preview", html: `${icon("webcam")}<span>Preview camera</span>`, onclick: startCamPreview }), h("span", { class: "small muted" }, "Drag the preview bubble to place it.")),
          h(
            "div",
            { class: "form-grid" },
            field("Shape", select("webcamShape", [["circle", "Circle"], ["rect", "Rectangle"]], layoutCam)),
            field("Position", posSel),
            field("Size", size),
            field("Opacity", opa),
            field("Mode", select("webcamMode", [["burn", "Composite into the video"], ["separate", "Separate track (reposition later in the editor)"]]))
          )
        ),
        h(
          "div",
          { class: "card col" },
          h("h2", {}, "Cursor, clicks & annotation"),
          check("clickEffects", "Mouse-click effects (left / right click colours)"),
          check("cursorHighlight", "Cursor highlight"),
          check("syntheticCursor", "Show cursor in tab recordings (Chrome\u2019s tab capture does not include the mouse pointer)"),
          check("showToolbar", "Show recording toolbar on the page (it is visible in tab recordings; drawing tools appear when you annotate)"),
          h(
            "div",
            { class: "form-grid" },
            field("Highlight colour", (() => {
              const el = h("input", { type: "color", value: s.cursorColor });
              el.addEventListener("change", () => save({ cursorColor: el.value }));
              return el;
            })()),
            field("Left-click colour", (() => {
              const el = h("input", { type: "color", value: s.clickColorLeft });
              el.addEventListener("change", () => save({ clickColorLeft: el.value }));
              return el;
            })()),
            field("Right-click colour", (() => {
              const el = h("input", { type: "color", value: s.clickColorRight });
              el.addEventListener("change", () => save({ clickColorRight: el.value }));
              return el;
            })()),
            field("Highlight size (px)", (() => {
              const el = h("input", { type: "number", min: 16, max: 120, value: s.cursorSize });
              el.addEventListener("change", () => save({ cursorSize: Number(el.value) }));
              return el;
            })())
          ),
          h("div", { class: "small muted" }, "Effects are drawn inside web pages the extension can access. Clicks in other applications or Chrome\u2019s own UI cannot be detected.")
        ),
        h(
          "div",
          { class: "card col" },
          h("div", { class: "form-grid" }, field("Countdown", select("countdown", [[0, "No countdown"], [3, "3 seconds"], [5, "5 seconds"], [10, "10 seconds"]]))),
          startBtn,
          h("div", { class: "small muted" }, "Recording never starts without your click and Chrome\u2019s own sharing indicator stays visible while recording.")
        )
      )
    )
  );
  const bitrate = view2.querySelector("#opt-bitrate");
  startBtn.querySelector("#start-sub").textContent = "Recording runs in the background \u2014 you can close this page.";
  refreshDevices();
  const onCh = (ch, area) => {
    if (area === "session" && ch.recState) renderActive(ch.recState.newValue);
  };
  chrome.storage.onChanged.addListener(onCh);
  const { recState } = await chrome.storage.session.get("recState");
  renderActive(recState);
  if (grant) grantBox.querySelector("#grant-btn")?.focus();
  const ro = new ResizeObserver(layoutCam);
  ro.observe(stage);
  return () => {
    chrome.storage.onChanged.removeListener(onCh);
    stopStream(resources.mic);
    stopStream(resources.cam);
    resources.ctx?.close();
    cancelAnimationFrame(resources.raf);
    ro.disconnect();
  };
}

// src/screen-recorder/webm-duration.js
function readVint(buf, pos) {
  const first = buf[pos];
  if (first === void 0) return null;
  let len = 1;
  let mask = 128;
  while (len <= 8 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 8) return null;
  let value = first & mask - 1;
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    const b = buf[pos + i];
    if (b === void 0) return null;
    value = value * 256 + b;
    if (b !== 255) allOnes = false;
  }
  return { len, value, unknown: allOnes };
}
function readId(buf, pos) {
  const first = buf[pos];
  let len = 1;
  let mask = 128;
  while (len <= 4 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 4) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}
function sizeVint8(n) {
  const out = new Uint8Array(8);
  out[0] = 1;
  for (let i = 7; i >= 1; i--) {
    out[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return out;
}
var ID_SEGMENT = 408125543;
var ID_INFO = 357149030;
var ID_DURATION = 17545;
var ID_TIMECODESCALE = 2807729;
async function fixWebmDuration(blob, durationMs) {
  const headLen = Math.min(blob.size, 256 * 1024);
  const buf = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
  let pos = 0;
  const h2 = readId(buf, pos);
  if (!h2 || h2.id !== 440786851) return blob;
  pos += h2.len;
  const hs = readVint(buf, pos);
  pos += hs.len + hs.value;
  const seg = readId(buf, pos);
  if (!seg || seg.id !== ID_SEGMENT) return blob;
  pos += seg.len;
  const ss = readVint(buf, pos);
  pos += ss.len;
  while (pos < buf.length - 8) {
    const el = readId(buf, pos);
    if (!el) return blob;
    const sz = readVint(buf, pos + el.len);
    if (!sz) return blob;
    const dataStart = pos + el.len + sz.len;
    if (el.id === ID_INFO) {
      const infoEnd = dataStart + sz.value;
      if (infoEnd > buf.length) return blob;
      let timecodeScale = 1e6;
      const children = [];
      let p = dataStart;
      while (p < infoEnd) {
        const c = readId(buf, p);
        const cs = readVint(buf, p + c.len);
        const cStart = p + c.len + cs.len;
        const cEnd = cStart + cs.value;
        if (c.id === ID_TIMECODESCALE) {
          let v = 0;
          for (let i = cStart; i < cEnd; i++) v = v * 256 + buf[i];
          timecodeScale = v || timecodeScale;
        }
        if (c.id !== ID_DURATION) children.push(buf.subarray(p, cEnd));
        p = cEnd;
      }
      const dur = new Uint8Array(11);
      dur[0] = 68;
      dur[1] = 137;
      dur[2] = 136;
      new DataView(dur.buffer).setFloat64(3, durationMs * (1e6 / timecodeScale));
      const bodyLen = children.reduce((a, c) => a + c.length, 0) + dur.length;
      const idBytes = buf.subarray(pos, pos + el.len);
      const newInfo = new Uint8Array(el.len + 8 + bodyLen);
      newInfo.set(idBytes, 0);
      newInfo.set(sizeVint8(bodyLen), el.len);
      let o = el.len + 8;
      for (const c of children) {
        newInfo.set(c, o);
        o += c.length;
      }
      newInfo.set(dur, o);
      return new Blob([buf.subarray(0, pos), newInfo, blob.slice(infoEnd)], { type: blob.type });
    }
    if (sz.unknown) return blob;
    pos = dataStart + sz.value;
  }
  return blob;
}

// src/history/history-view.js
function playableDuration(blob) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(blob);
    let t = setTimeout(() => finish(null), 8e3);
    const finish = (r) => {
      clearTimeout(t);
      t = null;
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      resolve(r);
    };
    v.muted = true;
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (v.duration !== Infinity) {
        finish({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
        return;
      }
      v.currentTime = 1e9;
      v.ontimeupdate = () => {
        v.ontimeupdate = null;
        finish({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      };
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}
async function renderHistory({ view: view2, head: head2 }) {
  let filter = "all";
  let query = "";
  let sort = "new";
  const list = h("div", {});
  const usage = h("span", { class: "muted small", id: "storage-usage" });
  const recovery = h("div", { id: "recovery" });
  const actions = [
    { icon: "open", label: "Open", title: "Preview / open", run: (i) => chrome.tabs.create({ url: itemUrl(i) }) },
    { icon: "editor", label: "Edit", run: (i) => chrome.tabs.create({ url: `${itemUrl(i)}&edit=1` }) },
    { icon: "download", label: "Export", title: "Export again", run: (i) => chrome.tabs.create({ url: `${itemUrl(i)}&export=1` }) },
    {
      icon: "rename",
      label: "Rename",
      run: async (i) => {
        const t = await promptText("Rename capture", i.title);
        if (t != null && t.trim()) {
          await updateItem(i.id, { title: t.trim() });
          refresh();
        }
      }
    },
    {
      icon: "trash",
      label: "Delete",
      cls: "danger",
      run: async (i) => {
        if (await confirmDialog("Delete capture?", `\u201C${i.title}\u201D and its media will be removed from this computer.`, "Delete", true)) {
          await deleteItem(i.id);
          toast("Deleted");
          refresh();
        }
      }
    }
  ];
  async function refresh() {
    let items = await listItems();
    const total = items.length;
    if (filter !== "all") items = items.filter((i) => i.kind === filter);
    if (query) {
      const q = query.toLowerCase();
      items = items.filter((i) => `${i.title} ${i.url}`.toLowerCase().includes(q));
    }
    if (sort === "old") items.reverse();
    if (sort === "size") items.sort((a, b) => (b.size || 0) - (a.size || 0));
    list.replaceChildren(items.length ? h("div", { class: "cards" }, items.map((it) => captureCard(it, actions))) : h("div", { class: "empty" }, total ? "No captures match." : "Your captures will appear here."));
    try {
      const est = await navigator.storage.estimate();
      usage.textContent = `${total} capture(s) \xB7 ${formatBytes(est.usage)} used locally`;
    } catch {
      usage.textContent = `${total} capture(s)`;
    }
    renderRecovery();
  }
  async function renderRecovery() {
    const { recState } = await chrome.storage.session.get("recState");
    const sets = await listChunkSets();
    const ids = Object.keys(sets).filter((id) => !id.endsWith("_cam") && !(recState?.active && recState.recId === id));
    if (!ids.length) {
      recovery.replaceChildren();
      return;
    }
    recovery.replaceChildren(h(
      "div",
      { class: "notice warn col", style: { marginBottom: "16px" } },
      h("b", {}, "Unfinished recordings found"),
      h("span", {}, "A recording was interrupted (for example the browser closed). The data recorded so far can be recovered if it is playable."),
      ...ids.map((id) => {
        const info = sets[id];
        const rec = h("button", { class: "btn primary" }, "Recover");
        const del = h("button", { class: "btn danger" }, "Discard");
        rec.addEventListener("click", async () => {
          rec.disabled = true;
          rec.textContent = "Checking\u2026";
          const chunks = await getChunks(id);
          let blob = new Blob(chunks, { type: chunks[0]?.type || "video/webm" });
          const meta = await playableDuration(blob);
          if (!meta || !(meta.duration > 0) || !meta.width) {
            toast("This data is not playable and cannot be recovered.", "error");
            rec.textContent = "Not recoverable";
            return;
          }
          if (blob.type.includes("webm")) blob = await fixWebmDuration(blob, meta.duration * 1e3);
          await putBlob(`${id}:video`, blob);
          const cam = await getChunks(`${id}_cam`);
          let webcamBlobKey = null;
          if (cam.length) {
            webcamBlobKey = `${id}:webcam`;
            await putBlob(webcamBlobKey, new Blob(cam, { type: "video/webm" }));
          }
          await putItem({ id, kind: "video", title: `Recovered recording (${formatDate(info.lastAt || Date.now())})`, url: "", createdAt: info.lastAt || Date.now(), duration: meta.duration, width: meta.width, height: meta.height, format: blob.type.includes("mp4") ? "mp4" : "webm", mimeType: blob.type, size: blob.size, blobKey: `${id}:video`, webcamBlobKey, thumbKey: null, status: "recovered", warnings: ["Recovered after an interruption; the end of the recording may be missing."] });
          await deleteChunks(id);
          await deleteChunks(`${id}_cam`);
          toast("Recording recovered", "ok");
          refresh();
        });
        del.addEventListener("click", async () => {
          await deleteChunks(id);
          await deleteChunks(`${id}_cam`);
          refresh();
        });
        return h("div", { class: "row" }, h("span", { class: "grow" }, `${formatDate(info.lastAt)} \xB7 ${info.count} chunk(s) \xB7 ${formatBytes(info.bytes)}`), rec, del);
      })
    ));
  }
  const seg = h("div", { class: "seg", id: "hist-filter" });
  for (const [v, l] of [["all", "All"], ["screenshot", "Screenshots"], ["video", "Videos"]]) {
    const b = h("button", { class: v === filter ? "sel" : "" }, l);
    b.addEventListener("click", () => {
      filter = v;
      [...seg.children].forEach((c) => c.classList.toggle("sel", c === b));
      refresh();
    });
    seg.append(b);
  }
  const search = h("input", { type: "text", placeholder: "Search title or URL\u2026", id: "hist-search" });
  search.addEventListener("input", () => {
    query = search.value;
    refresh();
  });
  const sortSel = h("select", {}, h("option", { value: "new" }, "Newest first"), h("option", { value: "old" }, "Oldest first"), h("option", { value: "size" }, "Largest first"));
  sortSel.addEventListener("change", () => {
    sort = sortSel.value;
    refresh();
  });
  const clear = h("button", { class: "btn danger", id: "hist-clear", html: `${icon("trash")}<span>Clear history</span>` });
  clear.addEventListener("click", async () => {
    if (await confirmDialog("Clear capture history?", "All screenshots, recordings and edits stored by the extension will be permanently deleted from this computer.", "Delete everything", true)) {
      await clearAll();
      toast("History cleared");
      refresh();
    }
  });
  view2.replaceChildren(
    head2("Capture History", "Everything is stored locally in this browser profile (IndexedDB). Nothing is uploaded.", clear),
    recovery,
    h("div", { class: "row wrap", style: { marginBottom: "14px" } }, seg, search, sortSel, h("span", { class: "grow" }), usage),
    list
  );
  await refresh();
}

// src/shared/filenames.js
var pad = (n) => String(n).padStart(2, "0");
function siteName(url, title) {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return decodeURIComponent(u.pathname.split("/").pop() || "File").replace(/\.[a-z0-9]+$/i, "");
    let h2 = u.hostname.replace(/^www\d?\./, "");
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

// src/settings/settings-view.js
async function renderSettings({ view: view2, head: head2 }) {
  let s = await getSettings();
  const save = async (k, v) => {
    s = await saveSettings({ [k]: v });
  };
  const row = (label, el, hint) => h("label", { class: "field" }, h("span", {}, label), el, hint ? h("span", { class: "small", style: { fontWeight: 400 } }, hint) : null);
  const sel = (k, opts) => {
    const e = h("select", { id: `set-${k}` });
    for (const [v, l] of opts) e.append(h("option", { value: v, selected: String(s[k]) === String(v) }, l));
    e.addEventListener("change", () => save(k, typeof DEFAULT_SETTINGS[k] === "number" ? Number(e.value) : e.value));
    return e;
  };
  const num = (k, min, max, step = 1) => {
    const e = h("input", { type: "number", id: `set-${k}`, min, max, step, value: s[k] });
    e.addEventListener("change", () => {
      const v = Math.max(min, Math.min(max, Number(e.value)));
      e.value = v;
      save(k, v);
    });
    return e;
  };
  const txt = (k, onInput) => {
    const e = h("input", { type: "text", id: `set-${k}`, value: s[k] });
    e.addEventListener("change", () => save(k, e.value));
    e.addEventListener("input", () => onInput?.(e.value));
    return e;
  };
  const chk = (k, label) => {
    const c = h("input", { type: "checkbox", id: `set-${k}`, checked: !!s[k] });
    c.addEventListener("change", () => save(k, c.checked));
    return h("label", { class: "check" }, c, label);
  };
  const group = (title, ...children) => h("div", { class: "card set-group" }, h("h2", {}, title), ...children);
  const shotPreview = h("span", { class: "small mono" });
  const vidPreview = h("span", { class: "small mono" });
  const updPreview = () => {
    shotPreview.textContent = `${expandPattern(s.screenshotPattern, { url: "https://www.google.com", title: "Google" })}.jpg`;
    vidPreview.textContent = `${expandPattern(s.videoPattern, { url: "https://www.google.com", title: "Google" })}.webm`;
  };
  updPreview();
  const usage = h("span", { class: "muted" });
  const refreshUsage = async () => {
    try {
      const e = await navigator.storage.estimate();
      usage.textContent = `${formatBytes(e.usage)} used${e.quota ? ` of ${formatBytes(e.quota)} available` : ""}`;
    } catch {
      usage.textContent = "unknown";
    }
  };
  refreshUsage();
  const perms = h("div", { class: "col small" });
  for (const name of ["microphone", "camera"]) {
    let state = "unknown";
    try {
      state = (await navigator.permissions.query({ name })).state;
    } catch {
    }
    perms.append(h("div", {}, h("b", {}, name === "microphone" ? "Microphone: " : "Camera: "), state === "granted" ? "allowed" : state === "denied" ? "blocked (change it in Chrome \u2192 Settings \u2192 Privacy \u2192 Site settings \u2192 extension)" : "not requested yet \u2014 asked only when you enable it"));
  }
  view2.replaceChildren(
    head2(
      "Settings",
      "Changes are saved automatically.",
      h("button", { class: "btn", id: "settings-reset", html: `${icon("undo")}<span>Reset to defaults</span>`, onclick: async () => {
        if (await confirmDialog("Reset settings?", "All settings return to their defaults. Captures are not affected.", "Reset")) {
          await resetSettings();
          renderSettings({ view: view2, head: head2 });
          toast("Settings reset");
        }
      } })
    ),
    group(
      "Screenshots",
      h(
        "div",
        { class: "form-grid" },
        row("Default JPG quality", sel("jpgQuality", [[90, "90%"], [95, "95% (default)"], [100, "100% (maximum)"]]), "JPG is lossy even at 100%."),
        row("Colour sampling", sel("chromaSubsampling", [["444", "4:4:4 \u2013 sharpest text"], ["420", "4:2:0 \u2013 smaller files"]])),
        row("Scroll delay (ms)", num("scrollDelay", 0, 5e3, 50), "Wait after each scroll before capturing."),
        row("Lazy-load step delay (ms)", num("lazyLoadDelay", 50, 3e3, 50)),
        row("Sticky elements", sel("stickyMode", [["minimize", "Minimise repeated sticky/fixed elements"], ["normal", "Leave as displayed"]])),
        row("Maximum capture height (CSS px)", num("maxCaptureHeight", 1e3, 5e5, 1e3), "Stops infinite-scroll pages.")
      ),
      h("div", { class: "row wrap", style: { gap: "18px", marginTop: "10px" } }, chk("lazyLoadPrep", "Lazy-load preparation (pre-scroll)"), chk("hideScrollbars", "Hide scrollbars"), chk("captureHorizontal", "Capture horizontal overflow"), chk("openEditorAfterCapture", "Open preview after capture")),
      h("div", { class: "notice small", style: { marginTop: "10px" } }, "Resolution is always preserved: captures are stored losslessly at the device pixel ratio. Pages taller than browser canvas limits are stored and exported in full-resolution segments \u2014 never silently downscaled."),
      h("h3", { style: { marginTop: "14px" } }, "PDF"),
      h(
        "div",
        { class: "form-grid" },
        row("Default PDF layout", sel("pdfLayout", [["single", "Single long page"], ["paged", "Standard pages"]])),
        row("Paper", sel("pdfPaper", [["a4", "A4"], ["letter", "Letter"]])),
        row("Orientation", sel("pdfOrientation", [["portrait", "Portrait"], ["landscape", "Landscape"]])),
        row("Margins (mm)", num("pdfMarginMm", 0, 50, 1))
      ),
      h("div", { style: { marginTop: "10px" } }, chk("pdfSmartBreaks", "Avoid cutting text lines at page breaks"))
    ),
    group(
      "Recording",
      h(
        "div",
        { class: "form-grid" },
        row("Default capture source", sel("recSource", [["tab", "Current Chrome tab"], ["screen", "Entire screen / window"]])),
        row("Resolution", sel("recResolution", [["720", "720p"], ["1080", "1080p"], ["1440", "1440p"], ["2160", "4K"], ["source", "Source / maximum"]])),
        row("Frame rate", sel("recFps", [[24, "24 FPS"], [30, "30 FPS"], [60, "60 FPS"]])),
        row("Quality preset", sel("recQuality", [["standard", "Standard"], ["high", "High"], ["max", "Maximum practical"], ["custom", "Custom bitrate"]])),
        row("Custom bitrate (Mbps)", num("recBitrateMbps", 0.5, 120, 0.5)),
        row("Codec", sel("recCodec", [["vp9", "VP9"], ["vp8", "VP8"], ["av1", "AV1"], ["h264", "H.264"]])),
        row("Default audio", sel("recAudio", [["none", "No audio"], ["mic", "Microphone only"], ["tab", "Tab/system audio"], ["both", "Microphone + tab/system"]])),
        row("Countdown", sel("countdown", [[0, "None"], [3, "3 s"], [5, "5 s"], [10, "10 s"]])),
        row("Webcam shape", sel("webcamShape", [["circle", "Circle"], ["rect", "Rectangle"]])),
        row("Webcam position", sel("webcamPosition", [["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"], ["custom", "Custom"]]))
      ),
      h("div", { class: "row wrap", style: { gap: "18px", marginTop: "10px" } }, chk("webcamEnabled", "Webcam on by default"), chk("cursorHighlight", "Cursor highlight"), chk("clickEffects", "Click effects"), chk("syntheticCursor", "Cursor in tab recordings"), chk("showToolbar", "In-page toolbar"), chk("openEditorAfterRecording", "Open editor after recording")),
      h("div", { class: "small muted", style: { marginTop: "8px" } }, "Microphone and camera devices are chosen on the Screen Recorder page.")
    ),
    group("Video editor & export", h(
      "div",
      { class: "form-grid" },
      row("Default export format", sel("exportFormat", [["webm", "WebM (VP9/Opus)"], ["mp4", "MP4 (H.264/AAC)"]])),
      row("Default resolution", sel("exportResolution", [["source", "Same as source"], ["2160", "2160p"], ["1440", "1440p"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"]]), "Never larger than the source."),
      row("Default frame rate", sel("exportFps", [["source", "Same as source"], [24, "24"], [30, "30"], [60, "60"]])),
      row("Default quality", sel("exportQuality", [["standard", "Standard"], ["high", "High"], ["max", "Maximum"]])),
      row("Preview playback quality", sel("previewQuality", [["full", "Full"], ["half", "Half (faster)"]]))
    )),
    group(
      "Files & downloads",
      h(
        "div",
        { class: "form-grid" },
        row("Screenshot filename", txt("screenshotPattern", (v) => {
          s.screenshotPattern = v;
          updPreview();
        }), shotPreview),
        row("Video filename", txt("videoPattern", (v) => {
          s.videoPattern = v;
          updPreview();
        }), vidPreview),
        row("Subfolder in Downloads", txt("downloadSubfolder"), "Leave empty to save directly to Downloads.")
      ),
      h("div", { class: "small muted", style: { marginTop: "8px" } }, "Tokens: {site} {title} {domain} {date} {time} {datetime} {yyyy} {mm} {dd} {hh} {min} {ss}. Invalid characters are removed and existing files are never overwritten."),
      h("div", { style: { marginTop: "10px" } }, chk("askWhereToSave", "Ask where to save each file (choose any folder)"))
    ),
    group("Appearance", h("div", { class: "form-grid" }, row("Theme", sel("theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]])))),
    group(
      "Privacy & storage",
      h(
        "div",
        { class: "col" },
        h("div", { class: "row" }, h("b", {}, "Local storage usage:"), usage),
        h(
          "div",
          { class: "row wrap" },
          h("button", { class: "btn", id: "cleanup-temp", html: `${icon("trash")}<span>Delete temporary files</span>`, onclick: async () => {
            const r = await cleanupTemporary();
            toast(`Removed ${r.orphanBlobs} orphaned file(s), ${r.chunkSets} unfinished recording(s), ${r.opfsFiles} export temp file(s).`, "ok");
            refreshUsage();
          } }),
          h("button", { class: "btn danger", id: "clear-all", html: `${icon("trash")}<span>Clear capture history</span>`, onclick: async () => {
            if (await confirmDialog("Delete all captures?", "Every screenshot, recording and edit stored by FullPage HD Capture will be deleted.", "Delete everything", true)) {
              await clearAll();
              await cleanupTemporary();
              toast("All local data deleted", "ok");
              refreshUsage();
            }
          } })
        ),
        h("h3", {}, "Permissions"),
        perms,
        h("div", { class: "notice small" }, h("b", {}, "Privacy: "), "Screenshots, recordings, microphone and webcam data are processed and stored only on this computer. The extension has no server, no analytics, no account and no AI processing. It never captures anything without your explicit action, and Chrome always shows its own indicator while a tab or screen is shared.")
      )
    )
  );
}

// src/app/app.js
var view = $("#view");
var NAV = {
  dashboard: ["dashboard", "Dashboard"],
  studio: ["page", "Screenshot Studio"],
  recorder: ["record", "Screen Recorder"],
  editor: ["editor", "Video Editor"],
  history: ["history", "Capture History"],
  settings: ["settings", "Settings"]
};
var cleanup = null;
function head(title, sub, ...right) {
  return h("div", { class: "page-head" }, h("div", { class: "grow" }, h("h1", {}, title), sub ? h("p", {}, sub) : null), ...right);
}
async function lastWebTab() {
  const tabs = await capturableTabs();
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
  return tabs.filter((t) => !win || t.windowId === win.id).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || tabs[0];
}
async function renderDashboard() {
  const tabs = await capturableTabs();
  const def = await lastWebTab();
  const sel = tabSelect(tabs, def?.id);
  const capture = h("button", { class: "hero-btn capture", id: "dash-capture", html: `${icon("page")}<span>CAPTURE FULL PAGE</span><small>Scrolls and stitches the selected tab at full device resolution</small>` });
  capture.addEventListener("click", async () => {
    try {
      await startTabCapture(sel.value, "full");
      toast("Capturing\u2026 keep the page visible.");
    } catch (e) {
      toast(e.message, "error", 6e3);
    }
  });
  const record = h("button", { class: "hero-btn record", id: "dash-record", html: `${icon("record")}<span>RECORD SCREEN</span><small>Tab, window or entire screen \xB7 microphone \xB7 webcam</small>` });
  record.addEventListener("click", () => {
    location.hash = "recorder";
  });
  const sec = (id, ic, label, fn) => {
    const b = h("button", { class: "btn", id, html: `${icon(ic)}<span>${label}</span>` });
    b.addEventListener("click", fn);
    return b;
  };
  const items = (await listItems()).slice(0, 8);
  view.replaceChildren(
    head("FullPage HD Capture", "Full-page HD screenshots, screen recording and video editing \u2014 processed entirely on this computer."),
    h(
      "div",
      { class: "card col", style: { marginBottom: "16px" } },
      h("div", { class: "row" }, h("b", {}, "Tab to capture"), sel),
      h("div", { class: "big-actions" }, capture, record),
      h(
        "div",
        { class: "row wrap" },
        sec("dash-visible", "visible", "Capture Visible Screen", async () => {
          try {
            await startTabCapture(sel.value, "visible");
          } catch (e) {
            toast(e.message, "error");
          }
        }),
        sec("dash-editor", "editor", "Open Video Editor", () => {
          location.hash = "editor";
        }),
        sec("dash-history", "history", "Recent Captures", () => {
          location.hash = "history";
        }),
        sec("dash-settings", "settings", "Settings", () => {
          location.hash = "settings";
        })
      ),
      h("div", { class: "muted small" }, "Tip: the quickest way is the toolbar icon on the page itself \u2014 ", h("kbd", {}, "Alt+Shift+P"), " captures the current page.")
    ),
    h("div", { class: "section-title" }, h("h2", { class: "grow" }, "Recent captures"), h("a", { href: "#history" }, "View all")),
    items.length ? h("div", { class: "cards" }, items.map((it) => captureCard(it))) : h("div", { class: "empty" }, "Nothing captured yet.")
  );
}
async function renderStudio() {
  const s = await getSettings();
  const tabs = await capturableTabs();
  const def = await lastWebTab();
  const sel = tabSelect(tabs, def?.id);
  const field = (label, el) => h("label", { class: "field" }, h("span", {}, label), el);
  const select = (key, opts) => {
    const el = h("select", {});
    for (const [v, l2] of opts) el.append(h("option", { value: v, selected: String(s[key]) === String(v) }, l2));
    el.addEventListener("change", () => saveSettings({ [key]: typeof s[key] === "number" ? Number(el.value) : el.value }));
    return el;
  };
  const check = (key, label) => {
    const c = h("input", { type: "checkbox", checked: !!s[key] });
    c.addEventListener("change", () => saveSettings({ [key]: c.checked }));
    return h("label", { class: "check" }, c, label);
  };
  const num = (key, min, max, step = 1) => {
    const el = h("input", { type: "number", min, max, step, value: s[key] });
    el.addEventListener("change", () => saveSettings({ [key]: Math.max(min, Math.min(max, Number(el.value) || s[key])) }));
    return el;
  };
  const progress = h("div", { class: "card col", id: "studio-progress", style: { display: "none" } });
  const go = (mode) => async () => {
    try {
      await startTabCapture(sel.value, mode);
    } catch (e) {
      toast(e.message, "error", 6e3);
    }
  };
  const items = (await listItems()).filter((i) => i.kind === "screenshot").slice(0, 12);
  view.replaceChildren(
    head("Screenshot Studio", "Capture options, progress and your screenshots. Exports happen in the preview window."),
    h(
      "div",
      { class: "card col" },
      h("div", { class: "row" }, h("b", {}, "Tab"), sel),
      h(
        "div",
        { class: "row wrap" },
        h("button", { class: "btn primary", id: "studio-full", html: `${icon("page")}<span>Capture Entire Page</span>`, onclick: go("full") }),
        h("button", { class: "btn", id: "studio-visible", html: `${icon("visible")}<span>Capture Visible Screen</span>`, onclick: go("visible") }),
        h("button", { class: "btn danger", id: "studio-cancel", html: `${icon("x")}<span>Cancel Capture</span>`, onclick: () => send("capture:cancel") })
      ),
      h("hr"),
      h(
        "div",
        { class: "form-grid" },
        field("Sticky / fixed elements", select("stickyMode", [["minimize", "Minimise repeated sticky elements"], ["normal", "Handle normally (as displayed)"]])),
        field("Scroll delay (ms)", num("scrollDelay", 0, 5e3, 50)),
        field("Maximum capture height (CSS px)", num("maxCaptureHeight", 1e3, 5e5, 1e3)),
        field("Lazy-load step delay (ms)", num("lazyLoadDelay", 50, 3e3, 50))
      ),
      h(
        "div",
        { class: "row wrap", style: { gap: "18px" } },
        check("lazyLoadPrep", "Pre-scroll to load lazy content"),
        check("hideScrollbars", "Hide scrollbars"),
        check("captureHorizontal", "Include horizontal overflow")
      )
    ),
    progress,
    h("div", { class: "section-title" }, h("h2", { class: "grow" }, "Screenshots")),
    items.length ? h("div", { class: "cards" }, items.map((it) => captureCard(it, [
      { icon: "open", label: "Open", run: (i) => chrome.tabs.create({ url: itemUrl(i) }) }
    ]))) : h("div", { class: "empty" }, "No screenshots yet.")
  );
  const show = (st) => {
    if (!st) return;
    progress.style.display = "";
    if (st.active) {
      const pct = Math.round((st.progress || 0) * 100);
      progress.replaceChildren(h("b", {}, `Capturing \u201C${st.title || ""}\u201D \u2013 ${st.phase} ${pct}%`), h("div", { class: "progress" }, h("i", { style: { width: `${pct}%` } })));
    } else if (st.phase === "error") progress.replaceChildren(h("div", { class: "notice error" }, st.error));
    else if (st.phase === "cancelled") progress.replaceChildren(h("div", { class: "notice" }, "Capture cancelled."));
    else progress.style.display = "none";
  };
  const l = (ch, area) => {
    if (area === "session" && ch.captureState) show(ch.captureState.newValue);
  };
  chrome.storage.onChanged.addListener(l);
  cleanup = () => chrome.storage.onChanged.removeListener(l);
}
async function renderEditorList() {
  const vids = (await listItems()).filter((i) => i.kind === "video");
  const file = h("input", { type: "file", accept: "video/webm,video/mp4,video/quicktime,video/x-matroska,.mkv,.webm,.mp4,.mov", style: { display: "none" } });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    const id = newId("imp");
    const t = toast("Importing video\u2026");
    try {
      const meta = await probeVideo(f);
      await putBlob(`${id}:video`, f);
      await putItem({ id, kind: "video", title: f.name.replace(/\.[^.]+$/, ""), url: "", createdAt: Date.now(), duration: meta.duration, width: meta.width, height: meta.height, fps: null, format: (f.name.split(".").pop() || "webm").toLowerCase(), mimeType: f.type, size: f.size, blobKey: `${id}:video`, thumbKey: null, source: "import", status: "complete", warnings: [] });
      t.remove();
      chrome.tabs.create({ url: chrome.runtime.getURL(`video-editor.html?id=${id}`) });
      renderEditorList();
    } catch (e) {
      t.remove();
      toast(`Could not import: ${e.message}`, "error");
    }
  });
  view.replaceChildren(
    head(
      "Video Editor",
      "Trim, split, crop, annotate and export your recordings. Originals are never modified.",
      h("button", { class: "btn primary", id: "import-video", html: `${icon("file")}<span>Open local video file\u2026</span>`, onclick: () => file.click() }),
      file
    ),
    vids.length ? h("div", { class: "cards" }, vids.map((it) => captureCard(it, [
      { icon: "editor", label: "Edit", run: (i) => chrome.tabs.create({ url: itemUrl(i) }) }
    ]))) : h("div", { class: "empty" }, "No recordings yet. Record your screen or open a local video file.")
  );
}
function probeVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    v.onloadedmetadata = () => {
      const done = () => {
        URL.revokeObjectURL(url);
        resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      };
      if (v.duration === Infinity) {
        v.currentTime = 1e9;
        v.ontimeupdate = () => {
          v.ontimeupdate = null;
          done();
        };
      } else done();
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unsupported or damaged video file"));
    };
  });
}
var ROUTES = { dashboard: renderDashboard, studio: renderStudio, recorder: renderRecorder, editor: renderEditorList, history: renderHistory, settings: renderSettings };
async function route() {
  const [name, query] = (location.hash.replace(/^#/, "") || "dashboard").split("?");
  const key = ROUTES[name] ? name : "dashboard";
  if (cleanup) {
    try {
      cleanup();
    } catch {
    }
    cleanup = null;
  }
  $$(".sidebar a").forEach((a) => a.classList.toggle("active", a.dataset.route === key));
  document.title = `${NAV[key][1]} \u2013 FullPage HD Capture`;
  try {
    const r = await ROUTES[key]({ view, params: new URLSearchParams(query || ""), head, setCleanup: (fn) => {
      cleanup = fn;
    } });
    if (typeof r === "function") cleanup = r;
  } catch (e) {
    view.replaceChildren(h("div", { class: "notice error" }, `Something went wrong: ${e.message}`));
    console.error(e);
  }
}
function updateRecPill(st) {
  const pill = $("#rec-pill");
  if (st?.active) {
    pill.innerHTML = "";
    pill.append(h("a", { href: "#recorder", class: "badge rec", style: { textDecoration: "none", padding: "4px 10px" } }, st.state === "paused" ? "\u275A\u275A Paused" : `\u25CF REC ${formatDuration(st.elapsed || 0)}`));
  } else pill.innerHTML = "";
}
(async () => {
  await applyTheme();
  for (const a of $$(".sidebar a")) {
    const [ic, label] = NAV[a.dataset.route];
    a.innerHTML = `${icon(ic)}<span>${label}</span>`;
  }
  window.addEventListener("hashchange", route);
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "session" && ch.recState) updateRecPill(ch.recState.newValue);
    if (area === "local" && ch.settings) applyTheme();
  });
  const { recState } = await chrome.storage.session.get("recState");
  updateRecPill(recState);
  route();
})();
//# sourceMappingURL=app.js.map
