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

// src/stitching/stitcher.js
var MAX_CANVAS_DIM = 32767;
var SEGMENT_PIXEL_BUDGET = 48e6;
function segmentRowsFor(width) {
  return Math.max(256, Math.min(4096, Math.floor(SEGMENT_PIXEL_BUDGET / Math.max(1, width))));
}
var Stitcher = class {
  /**
   * @param {object} o
   * @param {number} o.width  final image width in device pixels
   * @param {(seg:{index:number,y:number,height:number,blob:Blob})=>Promise<void>} o.onSegment
   */
  constructor({ width, onSegment, segmentRows }) {
    if (width > MAX_CANVAS_DIM) throw new Error(`Capture width ${width}px exceeds the browser canvas limit`);
    this.width = width;
    this.rows = segmentRows || segmentRowsFor(width);
    this.onSegment = onSegment;
    this.open = /* @__PURE__ */ new Map();
    this.flushed = /* @__PURE__ */ new Set();
    this.maxY = 0;
    this.segments = [];
  }
  _seg(index) {
    let s = this.open.get(index);
    if (!s) {
      if (this.flushed.has(index)) throw new Error(`Stitch order error: segment ${index} already written`);
      const canvas = new OffscreenCanvas(this.width, this.rows);
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, this.width, this.rows);
      s = { canvas, ctx, index };
      this.open.set(index, s);
    }
    return s;
  }
  /** Draw a source rectangle of `bitmap` at destination (dx, dy) of the final image (1:1, no scaling). */
  draw(bitmap, sx, sy, sw, sh, dx, dy) {
    if (sw <= 0 || sh <= 0) return;
    const first = Math.floor(dy / this.rows);
    const last = Math.floor((dy + sh - 1) / this.rows);
    for (let i = first; i <= last; i++) {
      const s = this._seg(i);
      const segY = i * this.rows;
      const y0 = Math.max(dy, segY);
      const y1 = Math.min(dy + sh, segY + this.rows);
      s.ctx.drawImage(bitmap, sx, sy + (y0 - dy), sw, y1 - y0, dx, y0 - segY, sw, y1 - y0);
    }
    this.maxY = Math.max(this.maxY, dy + sh);
  }
  /** Encode and release every segment that lies completely above `y` (rows above y are final). */
  async flushUpTo(y) {
    for (const [index, s] of [...this.open.entries()].sort((a, b) => a[0] - b[0])) {
      if ((index + 1) * this.rows <= y) await this._flush(index, s, this.rows);
    }
  }
  async _flush(index, s, height) {
    this.open.delete(index);
    this.flushed.add(index);
    let canvas = s.canvas;
    if (height < this.rows) {
      const c = new OffscreenCanvas(this.width, height);
      c.getContext("2d", { alpha: false }).drawImage(s.canvas, 0, 0);
      canvas = c;
      s.canvas.width = s.canvas.height = 1;
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    canvas.width = canvas.height = 1;
    const seg = { index, y: index * this.rows, height, blob };
    this.segments.push({ index, y: seg.y, height, size: blob.size });
    await this.onSegment(seg);
  }
  /** Finish the image at `totalHeight` rows. Returns segment descriptors. */
  async finish(totalHeight) {
    const lastIndex = Math.ceil(totalHeight / this.rows) - 1;
    for (const [index, s] of [...this.open.entries()].sort((a, b) => a[0] - b[0])) {
      if (index > lastIndex) {
        this.open.delete(index);
        continue;
      }
      const h = Math.min(this.rows, totalHeight - index * this.rows);
      await this._flush(index, s, h);
    }
    for (let i = 0; i <= lastIndex; i++) {
      if (!this.flushed.has(i)) throw new Error(`Segment ${i} has no captured content`);
    }
    return this.segments.sort((a, b) => a.index - b.index);
  }
  abort() {
    for (const s of this.open.values()) {
      s.canvas.width = s.canvas.height = 1;
    }
    this.open.clear();
  }
};

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
var putBlob = (key, blob) => tx(["blobs"], "readwrite", (t) => promisify(t.objectStore("blobs").put({ key, blob })));
var deleteBlob = (key) => tx(["blobs"], "readwrite", (t) => promisify(t.objectStore("blobs").delete(key)));
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

// src/screenshot/capture-controller.js
var CAPTURE_MIN_INTERVAL = 550;
var lastCaptureAt = 0;
var CaptureError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
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
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function captureViewport(windowId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCaptureAt + CAPTURE_MIN_INTERVAL - Date.now();
    if (wait > 0) await sleep(wait);
    lastCaptureAt = Date.now();
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      const blob = await (await fetch(dataUrl)).blob();
      return await createImageBitmap(blob);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(msg)) {
        await sleep(700);
        continue;
      }
      if (/permission|activeTab|<all_urls>/i.test(msg)) {
        throw new CaptureError("Chrome did not grant permission to capture this tab. Click the extension icon on the page you want to capture (or allow site access) and try again.", "permission");
      }
      if (/dragging|image readback failed/i.test(msg) && attempt < 5) {
        await sleep(500);
        continue;
      }
      throw new CaptureError(`Screen capture failed: ${msg}`, "capture");
    }
  }
  throw new CaptureError("Screen capture was rate-limited by Chrome repeatedly.", "rate");
}
async function injectAgent(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["page-agent.js"] });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Cannot access|cannot be scripted|extensions gallery|chrome:\/\//i.test(msg)) {
      throw new CaptureError("Chrome does not allow extensions to access this page, so a full-page capture is not possible here. You can still use \u201CCapture Visible Screen\u201D.", "restricted");
    }
    if (/permission/i.test(msg)) {
      throw new CaptureError("Permission to access this page is missing. Open the extension from the page you want to capture and try again.", "permission");
    }
    throw new CaptureError(`Could not prepare the page: ${msg}`, "inject");
  }
}
async function agentCall(tabId, method, args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (m, a) => window.__fphdAgent ? window.__fphdAgent[m](a) : { __missing: true },
    args: [method, args ?? {}]
  });
  if (!res) throw new CaptureError("The page did not respond (it may have navigated away).", "page");
  if (res.result && res.result.__missing) throw new CaptureError("The page reloaded during capture.", "page");
  return res.result;
}
async function ensureTabVisible(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new CaptureError("The tab was closed during capture.", "closed");
  if (!tab.active) throw new CaptureError("Capture stopped because the tab was switched. Keep the page visible while capturing.", "switched");
  return tab;
}
async function makeThumb(bitmap, sx, sy, sw, sh) {
  const tw = 320;
  const th = Math.max(1, Math.round(Math.min(sh, sw * 0.75) * (tw / sw)));
  const c = new OffscreenCanvas(tw, th);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, Math.min(sh, sw * 0.75), 0, 0, tw, th);
  return c.convertToBlob({ type: "image/jpeg", quality: 0.8 });
}
async function captureVisible(tab, settings, { onProgress = () => {
} } = {}) {
  const reason = restrictionReason(tab.url);
  let info = { viewportWidth: tab.width, viewportHeight: tab.height, dpr: 1, url: tab.url, title: tab.title };
  if (!reason) {
    try {
      await injectAgent(tab.id);
      info = await agentCall(tab.id, "visibleInfo");
    } catch {
    }
  }
  onProgress({ phase: "capturing", progress: 0.5 });
  const bmp = await captureViewport(tab.windowId);
  const id = newId("shot");
  const blob = await new Promise((resolve) => {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    c.convertToBlob({ type: "image/png" }).then(resolve);
  });
  const segKey = `${id}:seg0`;
  await putBlob(segKey, blob);
  const thumb = await makeThumb(bmp, 0, 0, bmp.width, bmp.height);
  await putBlob(`${id}:thumb`, thumb);
  const scale = info.viewportWidth ? bmp.width / info.viewportWidth : 1;
  const item = {
    id,
    kind: "screenshot",
    mode: "visible",
    title: tab.title || info.title || "Screenshot",
    url: tab.url || info.url || "",
    createdAt: Date.now(),
    width: bmp.width,
    height: bmp.height,
    cssWidth: Math.round(bmp.width / scale),
    cssHeight: Math.round(bmp.height / scale),
    scale,
    dpr: info.dpr,
    frames: 1,
    status: "complete",
    warnings: [],
    segments: [{ key: segKey, y: 0, height: bmp.height, size: blob.size }],
    size: blob.size,
    thumbKey: `${id}:thumb`,
    format: "png"
  };
  bmp.close();
  await putItem(item);
  return item;
}
async function captureFullPage(tab, settings, { onProgress = () => {
}, isCancelled = () => false } = {}) {
  const reason = restrictionReason(tab.url);
  if (reason) throw new CaptureError(reason, "restricted");
  const tabId = tab.id;
  const windowId = tab.windowId;
  await ensureTabVisible(tabId);
  await injectAgent(tabId);
  const id = newId("shot");
  const warnings = [];
  let stitcher = null;
  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    await agentCall(tabId, "restore").catch(() => {
    });
  };
  try {
    onProgress({ phase: "preparing", progress: 0 });
    let m = await agentCall(tabId, "prepare", { stickyMode: settings.stickyMode, hideScrollbars: settings.hideScrollbars });
    if (m.innerScroller) warnings.push(`This page scrolls inside an element (<${m.innerScroller.tag}>). The scrolling region was captured.`);
    if (m.hasCrossOriginFrames) warnings.push("The page contains embedded frames from other sites. They are captured as displayed, but their inner scroll content is not expanded.");
    const maxCssHeight = Math.max(1e3, Number(settings.maxCaptureHeight) || 6e4);
    if (settings.lazyLoadPrep) {
      onProgress({ phase: "loading", progress: 0 });
      const r = await agentCall(tabId, "preScroll", { delay: Number(settings.lazyLoadDelay) || 200, maxHeight: maxCssHeight });
      if (r.cancelled || isCancelled()) throw new CaptureError("Capture cancelled.", "cancelled");
      m = r;
    }
    const clientH = m.rect.height;
    const clientW = m.rect.width;
    const horizontal = settings.captureHorizontal && m.totalWidth > clientW + 1;
    let scale = null;
    let outW = 0;
    let maxPxH = 0;
    let coveredY = 0;
    let row = 0;
    let frames = 0;
    let totalCssH = m.totalHeight;
    let truncated = false;
    let thumbBlob = null;
    let requestY = 0;
    let last = m;
    while (true) {
      if (isCancelled()) throw new CaptureError("Capture cancelled.", "cancelled");
      const limitCss = Math.min(totalCssH, maxCssHeight);
      const isLastRow = requestY + clientH >= limitCss - 1;
      const role = row === 0 && isLastRow ? "only" : row === 0 ? "first" : isLastRow ? "last" : "middle";
      let coveredX = 0;
      let requestX = 0;
      let rowEnd = coveredY;
      let col = 0;
      while (true) {
        const r = await agentCall(tabId, "scrollTo", { x: requestX, y: requestY, role, delay: Number(settings.scrollDelay) || 300 });
        if (r.cancelled || isCancelled()) throw new CaptureError("Capture cancelled.", "cancelled");
        await ensureTabVisible(tabId);
        const bmp = await captureViewport(windowId);
        frames++;
        const s = bmp.width / r.viewportWidth;
        if (scale == null) {
          scale = s;
          const cssW = horizontal ? Math.min(m.totalWidth, Math.floor(16384 / scale)) : clientW;
          if (horizontal && m.totalWidth > cssW) warnings.push(`Page is wider than ${Math.round(cssW)} CSS px; width was limited to the maximum supported image width.`);
          outW = Math.min(Math.round(cssW * scale), MAX_CANVAS_DIM);
          maxPxH = Math.round(maxCssHeight * scale);
          stitcher = new Stitcher({
            width: outW,
            onSegment: async (seg) => {
              await putBlob(`${id}:seg${seg.index}`, seg.blob);
            }
          });
        } else if (Math.abs(s - scale) / scale > 0.01) {
          bmp.close();
          throw new CaptureError("The page zoom or window size changed during capture. Please try again without resizing.", "zoom");
        }
        const rx = Math.round(r.rect.x * scale);
        const ry = Math.round(r.rect.y * scale);
        const rw = Math.min(Math.round(r.rect.width * scale), bmp.width - rx);
        const rh = Math.min(Math.round(r.rect.height * scale), bmp.height - ry);
        const dx0 = Math.round(r.scrollX * scale);
        const dy0 = Math.round(r.scrollY * scale);
        if (dy0 > coveredY + 1) warnings.push(`A ${dy0 - coveredY}px gap was detected near y=${coveredY}px (the page prevented exact scrolling).`);
        if (horizontal && dx0 > coveredX + 1) warnings.push(`A horizontal gap was detected near x=${coveredX}px.`);
        const y0 = Math.max(coveredY, dy0);
        const y1 = Math.min(dy0 + rh, maxPxH);
        const x0 = horizontal ? Math.max(coveredX, dx0) : 0;
        const x1 = Math.min(horizontal ? dx0 + rw : rw, outW);
        if (y1 > y0 && x1 > x0) {
          stitcher.draw(bmp, rx + (x0 - (horizontal ? dx0 : 0)), ry + (y0 - dy0), x1 - x0, y1 - y0, x0, y0);
          rowEnd = Math.max(rowEnd, y1);
        }
        if (!thumbBlob) thumbBlob = await makeThumb(bmp, rx, ry, rw, rh);
        bmp.close();
        last = r;
        const prevX = coveredX;
        coveredX = Math.max(coveredX, x1);
        col++;
        if (!horizontal || coveredX >= outW || coveredX <= prevX || col > 50) break;
        requestX = coveredX / scale;
      }
      await stitcher.flushUpTo(rowEnd);
      const progressed = rowEnd > coveredY;
      coveredY = rowEnd;
      totalCssH = Math.max(last.totalHeight, 1);
      const limitPx = Math.round(Math.min(totalCssH, maxCssHeight) * scale);
      onProgress({ phase: "capturing", progress: Math.min(0.99, coveredY / Math.max(1, limitPx)), frames });
      if (!progressed) break;
      if (coveredY >= limitPx - 1) {
        if (totalCssH > maxCssHeight) truncated = true;
        break;
      }
      if (frames > 3e3) {
        truncated = true;
        warnings.push("Stopped after 3000 frames.");
        break;
      }
      requestY = coveredY / scale;
      row++;
    }
    await restore();
    onProgress({ phase: "finalizing", progress: 0.995, frames });
    const height = coveredY;
    const segs = await stitcher.finish(height);
    if (truncated) warnings.push(`The page is longer than the maximum capture height (${maxCssHeight.toLocaleString()} CSS px). Increase it in Settings to capture more.`);
    if (thumbBlob) await putBlob(`${id}:thumb`, thumbBlob);
    const item = {
      id,
      kind: "screenshot",
      mode: "full",
      title: tab.title || m.title || "Full page capture",
      url: tab.url || m.url,
      createdAt: Date.now(),
      width: outW,
      height,
      cssWidth: Math.round(outW / scale),
      cssHeight: Math.round(height / scale),
      scale,
      dpr: m.dpr,
      frames,
      status: truncated ? "truncated" : "complete",
      warnings: [...new Set(warnings)],
      segments: segs.map((s) => ({ key: `${id}:seg${s.index}`, y: s.y, height: s.height, size: s.size })),
      size: segs.reduce((a, s) => a + s.size, 0),
      thumbKey: thumbBlob ? `${id}:thumb` : null,
      format: "png"
    };
    await putItem(item);
    return item;
  } catch (e) {
    stitcher?.abort();
    await restore();
    for (const i of stitcher?.flushed || []) await deleteBlob(`${id}:seg${i}`).catch(() => {
    });
    throw e;
  }
}

// src/background/service-worker.js
var setSession = (o) => chrome.storage.session.set(o);
var getSession = async (k) => (await chrome.storage.session.get(k))[k];
function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
  });
}
async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
  try {
    await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  } catch {
  }
}
async function openPage(path) {
  const url = chrome.runtime.getURL(path);
  return chrome.tabs.create({ url });
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}
var capture = null;
async function startCapture({ mode = "full", tabId = null, openEditor = true } = {}) {
  if (capture) throw new Error("A capture is already in progress.");
  let tab = tabId ? await chrome.tabs.get(tabId) : await activeTab();
  if (!tab) throw new Error("No tab to capture.");
  if (tabId && !tab.active) {
    await chrome.windows.update(tab.windowId, { focused: true });
    tab = await chrome.tabs.update(tab.id, { active: true });
    await new Promise((r) => setTimeout(r, 400));
  }
  const settings = await getSettings();
  capture = { tabId: tab.id, cancelled: false, mode };
  const state = { active: true, mode, tabId: tab.id, title: tab.title, phase: "starting", progress: 0, startedAt: Date.now() };
  await setSession({ captureState: state });
  broadcast({ type: "capture:progress", ...state });
  const onProgress = async (p) => {
    Object.assign(state, p);
    await setSession({ captureState: state });
    broadcast({ type: "capture:progress", ...state });
    const pct = Math.round((p.progress || 0) * 100);
    await setBadge(p.phase === "loading" ? "\u2026" : `${pct}%`, "#2563eb");
  };
  try {
    const item = mode === "visible" ? await captureVisible(tab, settings, { onProgress }) : await captureFullPage(tab, settings, { onProgress, isCancelled: () => capture?.cancelled });
    const done = { active: false, mode, phase: "done", progress: 1, itemId: item.id, finishedAt: Date.now() };
    await setSession({ captureState: done });
    broadcast({ type: "capture:done", itemId: item.id, item });
    if (openEditor && settings.openEditorAfterCapture !== false) await openPage(`screenshot.html?id=${encodeURIComponent(item.id)}`);
    return item;
  } catch (e) {
    const cancelled = e instanceof CaptureError && e.code === "cancelled";
    const err = { active: false, mode, phase: cancelled ? "cancelled" : "error", error: e.message, code: e.code || "error", finishedAt: Date.now() };
    await setSession({ captureState: err });
    broadcast({ type: cancelled ? "capture:cancelled" : "capture:error", error: e.message, code: e.code });
    if (!cancelled) throw e;
    return null;
  } finally {
    capture = null;
    const r = await getSession("recState");
    if (!r?.active) await setBadge("", null);
  }
}
var OFFSCREEN_URL = "offscreen.html";
async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)] });
  return ctx.length > 0;
}
var creatingOffscreen = null;
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA", "DISPLAY_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Records the tab/screen with MediaRecorder, mixes audio and composites the webcam overlay."
    }).finally(() => {
      creatingOffscreen = null;
    });
  }
  await creatingOffscreen;
}
async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {
  });
}
function sendToHost(hostId, msg) {
  return chrome.runtime.sendMessage({ ...msg, target: "recorder", hostId });
}
var pickers = /* @__PURE__ */ new Map();
async function openRecorderWindow(sources) {
  const reqId = Math.random().toString(36).slice(2);
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`recorder.html?req=${reqId}&sources=${sources.join(",")}`),
    type: "popup",
    width: 380,
    height: 330,
    focused: true
  });
  return new Promise((resolve) => {
    pickers.set(reqId, { resolve: (r) => resolve({ ...r, windowId: win.id, hostId: `window:${reqId}` }), windowId: win.id });
  });
}
async function hostAlive(st) {
  if (!st?.hostId) return false;
  if (st.hostId === "offscreen") return hasOffscreen();
  if (st.hostWindowId == null) return false;
  return chrome.windows.get(st.hostWindowId).then(() => true, () => false);
}
chrome.windows.onRemoved.addListener(async (windowId) => {
  for (const [id, p] of pickers) if (p.windowId === windowId) {
    pickers.delete(id);
    p.resolve({ streamId: null, options: {} });
  }
  const st = await getSession("recState");
  if (st?.active && st.hostWindowId === windowId) {
    await setSession({ recState: { active: false, state: "error", error: "The recording-control window was closed. Unsaved data can be recovered from Capture History." } });
    await setBadge("", null);
    if (st.overlayTabId) chrome.tabs.sendMessage(st.overlayTabId, { type: "overlay:teardown" }).catch(() => {
    });
  }
});
async function injectOverlay(tabId, settings, mode) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (restrictionReason(tab.url)) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["recording-overlay.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "overlay:init", settings, mode });
    return true;
  } catch {
    return false;
  }
}
async function overlayMessage(msg) {
  const st = await getSession("recState");
  if (st?.overlayTabId) chrome.tabs.sendMessage(st.overlayTabId, msg).catch(() => {
  });
}
async function startRecording(req) {
  const cur = await getSession("recState");
  if (cur?.active) throw new Error("A recording is already in progress.");
  const settings = { ...await getSettings(), ...req.config || {} };
  const source = req.source || settings.recSource;
  let streamId = req.streamId || null;
  let tab = req.tabId ? await chrome.tabs.get(req.tabId).catch(() => null) : await activeTab();
  let canTabAudio = false;
  let viaPicker = false;
  let host = null;
  if (source === "tab") {
    if (!tab) throw new Error("No tab selected for recording.");
    const reason = restrictionReason(tab.url);
    if (reason && !/^chrome-extension:/.test(tab.url || "")) throw new Error(`${reason} Choose \u201CEntire screen / window\u201D instead.`);
    if (!streamId) {
      try {
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        canTabAudio = true;
      } catch (e) {
        const msg = String(e?.message || e);
        if (/active stream/i.test(msg)) throw new Error("This tab is already being captured. Stop the other capture first.");
        if (!/invoked|activeTab|permission/i.test(msg)) throw new Error(`Tab capture failed: ${msg}`);
        if (!req.allowPicker) {
          throw new Error("Chrome only allows recording a tab directly after you click the extension icon on that tab. Open the popup on the tab you want to record and press Record.");
        }
        const pick = await openRecorderWindow(["tab", "audio"]);
        if (!pick.streamId) return { cancelled: true };
        streamId = pick.streamId;
        canTabAudio = !!pick.options?.canRequestAudioTrack;
        viaPicker = true;
        host = pick;
      }
    } else canTabAudio = true;
  } else {
    const pick = await openRecorderWindow(req.pickerSources || ["screen", "window", "tab", "audio"]);
    if (!pick.streamId) return { cancelled: true };
    streamId = pick.streamId;
    canTabAudio = !!pick.options?.canRequestAudioTrack;
    host = pick;
  }
  if (!host) await ensureOffscreen();
  const hostId = host ? host.hostId : "offscreen";
  let overlayTabId = null;
  const wantsOverlay = settings.showToolbar || settings.cursorHighlight || settings.clickEffects || settings.syntheticCursor;
  if (tab && wantsOverlay && !viaPicker && (source === "tab" || tab.active)) {
    if (await injectOverlay(tab.id, settings, source)) overlayTabId = tab.id;
  }
  await setSession({
    recState: {
      active: true,
      state: "preparing",
      source,
      tabId: source === "tab" ? tab?.id : null,
      overlayTabId,
      hostId,
      hostWindowId: host?.windowId ?? null,
      title: source === "tab" ? tab?.title : "Screen recording",
      url: source === "tab" ? tab?.url : "",
      startedAt: Date.now()
    }
  });
  let tabSize = null;
  if (source === "tab" && !viaPicker && tab) {
    let dpr = 1;
    try {
      [{ result: dpr }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => devicePixelRatio });
    } catch {
      dpr = await chrome.tabs.getZoom(tab.id).catch(() => 1) || 1;
    }
    if (tab.width && tab.height) tabSize = { width: Math.round(tab.width * dpr), height: Math.round(tab.height * dpr) };
  }
  const res = await sendToHost(hostId, {
    type: "rec:begin",
    streamId,
    source: viaPicker ? "screen" : source,
    canTabAudio,
    settings,
    tabSize,
    meta: { title: source === "tab" ? tab?.title : "", url: source === "tab" ? tab?.url : "" }
  }).catch((e) => ({ ok: false, error: e.message }));
  if (res?.cancelled && host) chrome.windows.remove(host.windowId).catch(() => {
  });
  if (!res?.ok) {
    await setSession({ recState: { active: false, state: "error", error: res?.error || "Recorder failed to start" } });
    if (overlayTabId) chrome.tabs.sendMessage(overlayTabId, { type: "overlay:teardown" }).catch(() => {
    });
    await setBadge("", null);
    if (host) chrome.windows.remove(host.windowId).catch(() => {
    });
    throw new Error(res?.error || "The recorder failed to start.");
  }
  return { ok: true, ...res };
}
function badgeTime(sec) {
  sec = Math.floor(sec);
  if (sec < 600) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  return `${Math.floor(sec / 60)}m`;
}
async function onRecorderStatus(status) {
  const prev = await getSession("recState") || {};
  const next = { ...prev, ...status, active: !["done", "error", "cancelled", "idle"].includes(status.state) };
  await setSession({ recState: next });
  if (status.state === "countdown") await setBadge(String(status.countdown), "#f59e0b");
  else if (status.state === "recording") await setBadge(badgeTime(status.elapsed || 0), "#dc2626");
  else if (status.state === "paused") await setBadge("II", "#f59e0b");
  else if (!next.active) await setBadge("", null);
  if (prev.overlayTabId) chrome.tabs.sendMessage(prev.overlayTabId, { type: "rec:status", status: next }).catch(() => {
  });
}
async function onRecorderFinished({ itemId, error, cancelled }) {
  const st = await getSession("recState") || {};
  if (st.overlayTabId) chrome.tabs.sendMessage(st.overlayTabId, { type: "overlay:teardown" }).catch(() => {
  });
  await setSession({ recState: { active: false, state: error ? "error" : cancelled ? "cancelled" : "done", itemId, error, finishedAt: Date.now() } });
  await setBadge("", null);
  if (st.hostWindowId != null) chrome.windows.remove(st.hostWindowId).catch(() => {
  });
  else await closeOffscreen();
  const settings = await getSettings();
  if (itemId && settings.openEditorAfterRecording) await openPage(`video-editor.html?id=${encodeURIComponent(itemId)}`);
}
async function recorderCommand(type, extra = {}) {
  const st = await getSession("recState");
  if (!st?.active) throw new Error("No active recording.");
  if (type === "rec:annotate-toggle") {
    await overlayMessage({ type: "overlay:annotate-toggle" });
    return { ok: true };
  }
  if (!await hostAlive(st)) {
    await setSession({ recState: { active: false, state: "error", error: "The recorder stopped unexpectedly." } });
    await setBadge("", null);
    throw new Error("The recorder is no longer running.");
  }
  return sendToHost(st.hostId, { type, ...extra });
}
var handlers = {
  "capture:start": (m) => {
    startCapture(m).catch(() => {
    });
    return { ok: true };
  },
  "capture:start-wait": (m) => startCapture(m).then((item) => ({ ok: true, itemId: item?.id })),
  "capture:cancel": async () => {
    if (capture) {
      capture.cancelled = true;
      chrome.scripting.executeScript({ target: { tabId: capture.tabId }, func: () => window.__fphdAgent?.cancel() }).catch(() => {
      });
    }
    return { ok: true };
  },
  "capture:get-state": async () => ({ state: await getSession("captureState") || null, busy: !!capture }),
  "rec:start": (m) => startRecording(m),
  "rec:pause": () => recorderCommand("rec:pause"),
  "rec:resume": () => recorderCommand("rec:resume"),
  "rec:stop": () => recorderCommand("rec:stop"),
  "rec:cancel": () => recorderCommand("rec:cancel"),
  "rec:screenshot": () => recorderCommand("rec:screenshot"),
  "rec:mute": (m) => recorderCommand("rec:mute", { muted: m.muted }),
  "rec:webcam": (m) => recorderCommand("rec:webcam", { enabled: m.enabled, position: m.position }),
  "rec:annotate-toggle": () => recorderCommand("rec:annotate-toggle"),
  "rec:get-state": async () => ({ state: await getSession("recState") || null }),
  // from the offscreen recorder
  "rec:status": async (m) => {
    await onRecorderStatus(m.status);
    return { ok: true };
  },
  // m.hostId identifies the sender
  "rec:finished": async (m) => {
    await onRecorderFinished(m);
    return { ok: true };
  },
  "rec:notify": async (m) => {
    await overlayMessage({ type: "overlay:toast", text: m.text });
    broadcast({ type: "rec:toast", text: m.text });
    return { ok: true };
  },
  "open:page": async (m) => {
    await openPage(m.path);
    return { ok: true };
  },
  "picker:result": async (m) => {
    const p = pickers.get(m.reqId);
    if (p) {
      pickers.delete(m.reqId);
      p.resolve({ streamId: m.streamId, options: { canRequestAudioTrack: m.canRequestAudioTrack } });
    }
    return { ok: true };
  },
  "recovery:list": async () => ({ sets: await listChunkSets() })
};
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === "offscreen") return false;
  const h = handlers[msg.type];
  if (!h) return false;
  Promise.resolve().then(() => h(msg, sender)).then((r) => sendResponse(r ?? { ok: true }), (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});
chrome.commands.onCommand.addListener(async (command, tab) => {
  try {
    if (command === "capture-full-page") await startCapture({ mode: "full", tabId: tab?.id });
    else if (command === "toggle-recording-pause") {
      const st = await getSession("recState");
      if (st?.active) await recorderCommand(st.state === "paused" ? "rec:resume" : "rec:pause");
    } else if (command === "stop-recording") await recorderCommand("rec:stop");
    else if (command === "toggle-annotation") await recorderCommand("rec:annotate-toggle");
  } catch {
  }
});
async function reconcile() {
  const st = await getSession("recState");
  if (st?.active && !await hostAlive(st)) {
    await setSession({ recState: { active: false, state: "error", error: "The recording was interrupted." } });
    await setBadge("", null);
  }
}
chrome.runtime.onStartup.addListener(reconcile);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await reconcile();
  if (reason === "install") await openPage("app.html#dashboard");
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await getSession("recState");
  if (st?.overlayTabId === tabId) await setSession({ recState: { ...st, overlayTabId: null } });
  if (capture?.tabId === tabId) capture.cancelled = true;
});
//# sourceMappingURL=background.js.map
