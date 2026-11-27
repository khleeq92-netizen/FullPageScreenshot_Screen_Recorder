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
async function listItems() {
  const all = await tx(["items"], "readonly", (t) => promisify(t.objectStore("items").getAll()));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
async function getBlob(key) {
  const r = await tx(["blobs"], "readonly", (t) => promisify(t.objectStore("blobs").get(key)));
  return r ? r.blob : null;
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

// src/popup/popup.js
var main = $("#main");
var tab = null;
var settings = null;
var view = "home";
function openApp(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#${hash}`) });
  window.close();
}
async function permissionState(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return "prompt";
  }
}
function tabInfo() {
  if (!tab) return h("div", { class: "notice" }, "No active tab.");
  const fav = tab.favIconUrl && /^https?:/.test(tab.favIconUrl) ? h("img", { src: tab.favIconUrl, alt: "" }) : h("span", { html: icon("page") });
  return h(
    "div",
    { class: "tab-info" },
    fav,
    h("div", { class: "grow" }, h("div", { class: "t", title: tab.title }, tab.title || "Untitled"), h("div", { class: "u", title: tab.url }, tab.url || ""))
  );
}
async function renderHome() {
  const reason = tab ? restrictionReason(tab.url) : "No tab";
  const capState = await send("capture:get-state").catch(() => null);
  main.replaceChildren(tabInfo());
  if (capState?.busy && capState.state?.active) return renderCaptureProgress(capState.state);
  if (capState?.state?.phase === "error" && Date.now() - (capState.state.finishedAt || 0) < 15e3) {
    main.append(h("div", { class: "notice error" }, capState.state.error));
  }
  if (reason) main.append(h("div", { class: "notice warn" }, reason, " ", h("span", { class: "muted" }, "Screen recording is still available.")));
  const capBtn = h("button", { class: "hero-btn capture", id: "capture-full", disabled: !!reason, html: `${icon("page")}<span>CAPTURE FULL PAGE</span><small>Entire page \xB7 HD \xB7 JPG / PDF</small>` });
  capBtn.addEventListener("click", () => startCapture("full"));
  const recBtn = h("button", { class: "hero-btn record", id: "record", html: `${icon("record")}<span>RECORD SCREEN</span><small>Tab or screen \xB7 mic \xB7 webcam</small>` });
  recBtn.addEventListener("click", () => {
    view = "record-setup";
    render();
  });
  main.append(h("div", { class: "heroes" }, capBtn, recBtn));
  const act = (id, ic, label, fn, disabled = false) => {
    const b = h("button", { class: "btn", id, disabled, html: `${icon(ic)}<span>${label}</span>` });
    b.addEventListener("click", fn);
    return b;
  };
  main.append(h(
    "div",
    { class: "actions" },
    act("capture-visible", "visible", "Capture Visible Screen", () => startCapture("visible"), !tab || /^(chrome|edge|about|devtools):/i.test(tab.url || "") && !/^chrome:\/\/newtab/.test(tab.url)),
    act("open-editor", "editor", "Open Video Editor", () => openApp("editor")),
    act("open-history", "history", "Capture History", () => openApp("history")),
    act("open-settings2", "settings", "Settings", () => openApp("settings"))
  ));
  const items = (await listItems().catch(() => [])).slice(0, 3);
  if (items.length) {
    const grid = h("div", { class: "recent" });
    for (const it of items) {
      const a = h("a", { href: "#", title: it.title });
      a.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL(it.kind === "video" ? `video-editor.html?id=${it.id}` : `screenshot.html?id=${it.id}`) });
        window.close();
      });
      if (it.thumbKey) getBlob(it.thumbKey).then((b) => {
        if (b) a.prepend(h("img", { src: URL.createObjectURL(b), alt: "" }));
      });
      a.append(h("span", {}, it.kind === "video" ? `\u25B6 ${formatDuration(it.duration)}` : `${it.width}\xD7${it.height}`));
      grid.append(a);
    }
    main.append(h("div", { class: "col" }, h("div", { class: "row" }, h("b", { class: "grow small" }, "Recent captures"), h("a", { href: "#", class: "small", onclick: (e) => {
      e.preventDefault();
      openApp("history");
    } }, "View all")), grid));
  }
}
function renderCaptureProgress(st) {
  main.replaceChildren(tabInfo());
  const labels = { starting: "Starting\u2026", preparing: "Preparing page\u2026", loading: "Loading lazy content\u2026", capturing: "Capturing", finalizing: "Finalizing image\u2026" };
  const pct = Math.round((st.progress || 0) * 100);
  const cancel = h("button", { class: "btn danger", id: "cancel-capture" }, "Cancel");
  cancel.addEventListener("click", () => send("capture:cancel"));
  main.append(h(
    "div",
    { class: "card col" },
    h("div", { class: "row" }, h("b", { class: "grow" }, `${labels[st.phase] || "Working\u2026"} ${st.phase === "capturing" ? `${pct}%` : ""}`), st.frames ? h("span", { class: "muted small" }, `${st.frames} frames`) : null),
    h("div", { class: "progress" }, h("i", { style: { width: `${pct}%` } })),
    h("div", { class: "muted small" }, "Keep this tab visible. You can close this popup; press Esc on the page to cancel."),
    h("div", { class: "row", style: { justifyContent: "flex-end" } }, cancel)
  ));
}
async function startCapture(mode) {
  try {
    await send("capture:start", { mode, tabId: tab?.id });
    if (mode === "visible") {
      toast("Capturing\u2026");
    }
  } catch (e) {
    toast(e.message, "error");
  }
}
async function renderRecordSetup() {
  settings = await getSettings();
  const reason = tab ? restrictionReason(tab.url) : "No tab";
  let source = reason ? "screen" : settings.recSource;
  const seg = (name, options, value, onChange) => {
    const el = h("div", { class: "seg", id: name });
    for (const [v, label] of options) {
      const b = h("button", { class: v === value ? "sel" : "" }, label);
      b.addEventListener("click", () => {
        [...el.children].forEach((c) => c.classList.remove("sel"));
        b.classList.add("sel");
        onChange(v);
      });
      el.append(b);
    }
    return el;
  };
  const sel = (id, options, value) => {
    const s = h("select", { id });
    for (const [v, label] of options) s.append(h("option", { value: v, selected: String(v) === String(value) }, label));
    return s;
  };
  const audio = sel("rec-audio", [["none", "No audio"], ["mic", "Microphone only"], ["tab", "Tab / system audio"], ["both", "Microphone + tab/system"]], settings.recAudio);
  const res = sel("rec-res", [["720", "720p"], ["1080", "1080p"], ["1440", "1440p"], ["2160", "4K (if supported)"], ["source", "Source (max)"]], settings.recResolution);
  const fps = sel("rec-fps", [[24, "24 FPS"], [30, "30 FPS"], [60, "60 FPS"]], settings.recFps);
  const cd = sel("rec-cd", [[0, "No countdown"], [3, "3 s countdown"], [5, "5 s countdown"], [10, "10 s countdown"]], settings.countdown);
  const cam = h("input", { type: "checkbox", id: "rec-cam", checked: settings.webcamEnabled });
  const fxc = h("input", { type: "checkbox", id: "rec-clicks", checked: settings.clickEffects });
  const hl = h("input", { type: "checkbox", id: "rec-cursor", checked: settings.cursorHighlight });
  const note = h("div", { class: "muted small" });
  const updNote = () => {
    note.textContent = source === "tab" ? "Records only this tab\u2019s content (no browser UI). Tab audio is captured directly." : "Chrome will ask you to choose a screen, window or tab. The extension cannot record without your selection.";
  };
  updNote();
  const start = h("button", { class: "btn primary", id: "rec-start", style: { flex: 1, padding: "10px" }, html: `${icon("record")}<span>Start recording</span>` });
  const back = h("button", { class: "btn" }, "Back");
  back.addEventListener("click", () => {
    view = "home";
    render();
  });
  start.addEventListener("click", async () => {
    const config = {
      recSource: source,
      recAudio: audio.value,
      recResolution: res.value,
      recFps: Number(fps.value),
      countdown: Number(cd.value),
      webcamEnabled: cam.checked,
      clickEffects: fxc.checked,
      cursorHighlight: hl.checked
    };
    await saveSettings(config);
    const needMic = config.recAudio === "mic" || config.recAudio === "both";
    const needCam = config.webcamEnabled;
    if (needMic && await permissionState("microphone") !== "granted" || needCam && await permissionState("camera") !== "granted") {
      chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#recorder?grant=${[needMic && "mic", needCam && "cam"].filter(Boolean).join(",")}&tab=${tab?.id || ""}`) });
      window.close();
      return;
    }
    start.disabled = true;
    try {
      const r = await send("rec:start", { source, tabId: tab?.id, config });
      if (r?.cancelled) {
        start.disabled = false;
        toast("Recording cancelled.");
        return;
      }
    } catch (e) {
      start.disabled = false;
      toast(e.message, "error", 6e3);
    }
  });
  main.replaceChildren(
    tabInfo(),
    h(
      "div",
      { class: "col" },
      h("b", {}, "What to record"),
      seg("rec-source", [["tab", "Current tab"], ["screen", "Entire screen / window"]], source, (v) => {
        source = v;
        updNote();
      }),
      note
    ),
    h(
      "div",
      { class: "opt-grid" },
      h("label", { class: "field" }, h("span", {}, "Audio"), audio),
      h("label", { class: "field" }, h("span", {}, "Countdown"), cd),
      h("label", { class: "field" }, h("span", {}, "Resolution"), res),
      h("label", { class: "field" }, h("span", {}, "Frame rate"), fps)
    ),
    h(
      "div",
      { class: "col" },
      h("label", { class: "check" }, cam, "Webcam overlay"),
      h("label", { class: "check" }, fxc, "Click effects"),
      h("label", { class: "check" }, hl, "Cursor highlight")
    ),
    h("div", { class: "row" }, back, start),
    h("a", { href: "#", class: "small", onclick: (e) => {
      e.preventDefault();
      openApp("recorder");
    } }, "Advanced recorder settings (quality, webcam layout, devices)\u2026")
  );
  if (reason) {
    $("#rec-source").firstChild.disabled = true;
  }
}
function renderRecording(st) {
  const isPaused = st.state === "paused";
  const ctl = (id, ic, label, fn, cls = "") => {
    const b = h("button", { class: `btn ${cls}`, id, html: `${icon(ic)}<span>${label}</span>` });
    b.addEventListener("click", fn);
    return b;
  };
  const header = st.state === "countdown" ? h("div", { class: "rec-time" }, `Starting in ${st.countdown}\u2026`) : st.state === "preparing" || st.state === "starting" ? h("div", { class: "rec-time" }, "Starting\u2026") : st.state === "stopping" ? h("div", { class: "rec-time" }, "Saving\u2026") : h("div", { class: "row" }, h("span", { class: `badge ${isPaused ? "" : "rec"}` }, isPaused ? "PAUSED" : "\u25CF REC"), h("div", { class: "rec-time grow" }, formatDuration(st.elapsed)));
  const info = h(
    "div",
    { class: "muted small" },
    `${st.source === "tab" ? "Tab" : "Screen"} \xB7 ${st.width || "?"}\xD7${st.height || "?"}${st.fps ? ` \xB7 ${st.fps} fps` : ""} \xB7 ${formatBytes(st.bytes)}`
  );
  const meter = st.hasMic ? h("div", { class: "col" }, h("span", { class: "small muted" }, st.muted ? "Microphone muted" : "Microphone level"), h("div", { class: "meter" }, h("i", { style: { width: `${Math.round((st.muted ? 0 : st.micLevel || 0) * 100)}%` } }))) : null;
  const controls = h(
    "div",
    { class: "rec-controls" },
    ctl("rec-pause", isPaused ? "play" : "pause", isPaused ? "Resume" : "Pause", () => send(isPaused ? "rec:resume" : "rec:pause")),
    ctl("rec-stop", "stop", "Stop & save", () => send("rec:stop"), "primary"),
    ctl("rec-mute", st.muted ? "micOff" : "mic", st.muted ? "Unmute" : "Mute mic", () => send("rec:mute", { muted: !st.muted })),
    ctl("rec-annotate", "pen", "Annotate", () => send("rec:annotate-toggle").then(() => window.close())),
    ctl("rec-shot", "camera", "Screenshot", () => send("rec:screenshot").then(() => toast("Screenshot saved", "ok"))),
    ctl("rec-cancel", "x", "Discard", () => {
      if (confirm("Discard this recording?")) send("rec:cancel");
    }, "danger")
  );
  if (!st.hasMic) controls.querySelector("#rec-mute").disabled = true;
  if (st.state !== "recording" && st.state !== "paused") controls.querySelectorAll("button:not(#rec-cancel):not(#rec-stop)").forEach((b) => {
    b.disabled = true;
  });
  const warn = (st.warnings || []).length ? h("div", { class: "notice warn small" }, st.warnings.join(" ")) : null;
  main.replaceChildren(
    h("div", { class: "card rec-card" }, header, info, meter, controls, warn),
    h("div", { class: "muted small" }, "Shortcuts: ", h("kbd", {}, "Alt+Shift+K"), " pause \xB7 ", h("kbd", {}, "Alt+Shift+S"), " stop")
  );
}
async function render() {
  const { recState } = await chrome.storage.session.get("recState");
  if (recState?.active) return renderRecording(recState);
  if (view === "record-setup") return renderRecordSetup();
  return renderHome();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (changes.recState) {
    const st = changes.recState.newValue;
    if (st?.active) renderRecording(st);
    else if (changes.recState.oldValue?.active) {
      view = "home";
      render();
      if (st?.error) toast(st.error, "error", 6e3);
    }
  }
  if (changes.captureState) {
    const st = changes.captureState.newValue;
    if (st?.active) renderCaptureProgress(st);
    else if (st?.phase === "done") window.close();
    else if (st?.phase === "error") {
      render();
    } else render();
  }
});
(async () => {
  await applyTheme();
  $("#open-settings").innerHTML = icon("settings");
  $("#open-settings").addEventListener("click", () => openApp("settings"));
  $("#open-app").addEventListener("click", (e) => {
    e.preventDefault();
    openApp("dashboard");
  });
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await render();
})();
//# sourceMappingURL=popup.js.map
