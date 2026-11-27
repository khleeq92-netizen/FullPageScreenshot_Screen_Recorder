// Full-page capture orchestration (runs in the service worker).
// Scrolls the page with the injected page agent, captures each viewport with
// chrome.tabs.captureVisibleTab (lossless PNG, device-pixel resolution), and stitches
// frames into full-resolution segments using the *actual* scroll offsets reported by the page.
import { Stitcher, MAX_CANVAS_DIM } from '../stitching/stitcher.js';
import { putBlob, putItem, newId, deleteBlob } from '../storage/db.js';

const CAPTURE_MIN_INTERVAL = 550; // Chrome allows max 2 captureVisibleTab calls per second
let lastCaptureAt = 0;

export class CaptureError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function restrictionReason(url) {
  if (!url) return 'This page cannot be captured: Chrome does not let extensions access its internal pages (chrome://, the Web Store, other extensions), or access to this tab was not granted.';
  if (/^(chrome|edge|brave|opera|vivaldi|about|devtools|chrome-search|chrome-untrusted|view-source):/i.test(url)) {
    return 'Chrome does not allow extensions to capture its internal pages (chrome://, about:, etc.).';
  }
  if (/^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url)) {
    return 'Chrome blocks extensions on Chrome Web Store pages.';
  }
  if (/^chrome-extension:/i.test(url)) return 'Pages of other extensions cannot be captured.';
  if (/^(data|blob|javascript):/i.test(url)) return 'This kind of page (data:/blob: URL) cannot be scripted for full-page capture.';
  if (/^https?:\/\/[^/]*\.pdf(\b|$)/i.test(url) || /\.pdf(\?|#|$)/i.test(url)) return null; // PDF viewer: visible capture only (handled later)
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureViewport(windowId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCaptureAt + CAPTURE_MIN_INTERVAL - Date.now();
    if (wait > 0) await sleep(wait);
    lastCaptureAt = Date.now();
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      const blob = await (await fetch(dataUrl)).blob();
      return await createImageBitmap(blob);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(msg)) { await sleep(700); continue; }
      if (/permission|activeTab|<all_urls>/i.test(msg)) {
        throw new CaptureError('Chrome did not grant permission to capture this tab. Click the extension icon on the page you want to capture (or allow site access) and try again.', 'permission');
      }
      if (/dragging|image readback failed/i.test(msg) && attempt < 5) { await sleep(500); continue; }
      throw new CaptureError(`Screen capture failed: ${msg}`, 'capture');
    }
  }
  throw new CaptureError('Screen capture was rate-limited by Chrome repeatedly.', 'rate');
}

async function injectAgent(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['page-agent.js'] });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Cannot access|cannot be scripted|extensions gallery|chrome:\/\//i.test(msg)) {
      throw new CaptureError('Chrome does not allow extensions to access this page, so a full-page capture is not possible here. You can still use “Capture Visible Screen”.', 'restricted');
    }
    if (/permission/i.test(msg)) {
      throw new CaptureError('Permission to access this page is missing. Open the extension from the page you want to capture and try again.', 'permission');
    }
    throw new CaptureError(`Could not prepare the page: ${msg}`, 'inject');
  }
}

async function agentCall(tabId, method, args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (m, a) => (window.__fphdAgent ? window.__fphdAgent[m](a) : { __missing: true }),
    args: [method, args ?? {}],
  });
  if (!res) throw new CaptureError('The page did not respond (it may have navigated away).', 'page');
  if (res.result && res.result.__missing) throw new CaptureError('The page reloaded during capture.', 'page');
  return res.result;
}

async function ensureTabVisible(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new CaptureError('The tab was closed during capture.', 'closed');
  if (!tab.active) throw new CaptureError('Capture stopped because the tab was switched. Keep the page visible while capturing.', 'switched');
  return tab;
}

async function makeThumb(bitmap, sx, sy, sw, sh) {
  const tw = 320; const th = Math.max(1, Math.round(Math.min(sh, sw * 0.75) * (tw / sw)));
  const c = new OffscreenCanvas(tw, th);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, Math.min(sh, sw * 0.75), 0, 0, tw, th);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

/**
 * Capture the visible viewport only.
 */
export async function captureVisible(tab, settings, { onProgress = () => {} } = {}) {
  const reason = restrictionReason(tab.url);
  let info = { viewportWidth: tab.width, viewportHeight: tab.height, dpr: 1, url: tab.url, title: tab.title };
  if (!reason) {
    try { await injectAgent(tab.id); info = await agentCall(tab.id, 'visibleInfo'); } catch { /* visible capture still works */ }
  }
  onProgress({ phase: 'capturing', progress: 0.5 });
  const bmp = await captureViewport(tab.windowId);
  const id = newId('shot');
  const blob = await new Promise((resolve) => {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    c.convertToBlob({ type: 'image/png' }).then(resolve);
  });
  const segKey = `${id}:seg0`;
  await putBlob(segKey, blob);
  const thumb = await makeThumb(bmp, 0, 0, bmp.width, bmp.height);
  await putBlob(`${id}:thumb`, thumb);
  const scale = info.viewportWidth ? bmp.width / info.viewportWidth : 1;
  const item = {
    id, kind: 'screenshot', mode: 'visible',
    title: tab.title || info.title || 'Screenshot', url: tab.url || info.url || '',
    createdAt: Date.now(), width: bmp.width, height: bmp.height,
    cssWidth: Math.round(bmp.width / scale), cssHeight: Math.round(bmp.height / scale),
    scale, dpr: info.dpr, frames: 1, status: 'complete', warnings: [],
    segments: [{ key: segKey, y: 0, height: bmp.height, size: blob.size }],
    size: blob.size, thumbKey: `${id}:thumb`, format: 'png',
  };
  bmp.close();
  await putItem(item);
  return item;
}

/**
 * Capture the full page.
 * @param {chrome.tabs.Tab} tab
 * @param {object} settings
 * @param {{onProgress:Function, isCancelled:Function}} hooks
 */
export async function captureFullPage(tab, settings, { onProgress = () => {}, isCancelled = () => false } = {}) {
  const reason = restrictionReason(tab.url);
  if (reason) throw new CaptureError(reason, 'restricted');
  const tabId = tab.id; const windowId = tab.windowId;
  await ensureTabVisible(tabId);
  await injectAgent(tabId);

  const id = newId('shot');
  const warnings = [];
  let stitcher = null;
  let restored = false;
  const restore = async () => {
    if (restored) return; restored = true;
    await agentCall(tabId, 'restore').catch(() => {});
  };

  try {
    onProgress({ phase: 'preparing', progress: 0 });
    let m = await agentCall(tabId, 'prepare', { stickyMode: settings.stickyMode, hideScrollbars: settings.hideScrollbars });
    if (m.innerScroller) warnings.push(`This page scrolls inside an element (<${m.innerScroller.tag}>). The scrolling region was captured.`);
    if (m.hasCrossOriginFrames) warnings.push('The page contains embedded frames from other sites. They are captured as displayed, but their inner scroll content is not expanded.');

    const maxCssHeight = Math.max(1000, Number(settings.maxCaptureHeight) || 60000);
    if (settings.lazyLoadPrep) {
      onProgress({ phase: 'loading', progress: 0 });
      const r = await agentCall(tabId, 'preScroll', { delay: Number(settings.lazyLoadDelay) || 200, maxHeight: maxCssHeight });
      if (r.cancelled || isCancelled()) throw new CaptureError('Capture cancelled.', 'cancelled');
      m = r;
    }

    const clientH = m.rect.height; const clientW = m.rect.width;
    const horizontal = settings.captureHorizontal && m.totalWidth > clientW + 1;
    let scale = null; let outW = 0; let maxPxH = 0;
    let coveredY = 0; let row = 0; let frames = 0; let totalCssH = m.totalHeight;
    let truncated = false; let thumbBlob = null;
    let requestY = 0;
    let last = m;

    while (true) {
      if (isCancelled()) throw new CaptureError('Capture cancelled.', 'cancelled');
      const limitCss = Math.min(totalCssH, maxCssHeight);
      const isLastRow = requestY + clientH >= limitCss - 1;
      const role = row === 0 && isLastRow ? 'only' : row === 0 ? 'first' : isLastRow ? 'last' : 'middle';
      let coveredX = 0; let requestX = 0; let rowEnd = coveredY; let col = 0;

      while (true) {
        const r = await agentCall(tabId, 'scrollTo', { x: requestX, y: requestY, role, delay: Number(settings.scrollDelay) || 300 });
        if (r.cancelled || isCancelled()) throw new CaptureError('Capture cancelled.', 'cancelled');
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
            onSegment: async (seg) => { await putBlob(`${id}:seg${seg.index}`, seg.blob); },
          });
        } else if (Math.abs(s - scale) / scale > 0.01) {
          bmp.close();
          throw new CaptureError('The page zoom or window size changed during capture. Please try again without resizing.', 'zoom');
        }
        const rx = Math.round(r.rect.x * scale); const ry = Math.round(r.rect.y * scale);
        const rw = Math.min(Math.round(r.rect.width * scale), bmp.width - rx);
        const rh = Math.min(Math.round(r.rect.height * scale), bmp.height - ry);
        const dx0 = Math.round(r.scrollX * scale); const dy0 = Math.round(r.scrollY * scale);
        if (dy0 > coveredY + 1) warnings.push(`A ${dy0 - coveredY}px gap was detected near y=${coveredY}px (the page prevented exact scrolling).`);
        if (horizontal && dx0 > coveredX + 1) warnings.push(`A horizontal gap was detected near x=${coveredX}px.`);
        const y0 = Math.max(coveredY, dy0); const y1 = Math.min(dy0 + rh, maxPxH);
        const x0 = horizontal ? Math.max(coveredX, dx0) : 0; const x1 = Math.min(horizontal ? dx0 + rw : rw, outW);
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
      onProgress({ phase: 'capturing', progress: Math.min(0.99, coveredY / Math.max(1, limitPx)), frames });
      if (!progressed) break;
      if (coveredY >= limitPx - 1) {
        if (totalCssH > maxCssHeight) truncated = true;
        break;
      }
      if (frames > 3000) { truncated = true; warnings.push('Stopped after 3000 frames.'); break; }
      requestY = coveredY / scale;
      row++;
    }

    await restore();
    onProgress({ phase: 'finalizing', progress: 0.995, frames });
    const height = coveredY;
    const segs = await stitcher.finish(height);
    if (truncated) warnings.push(`The page is longer than the maximum capture height (${maxCssHeight.toLocaleString()} CSS px). Increase it in Settings to capture more.`);
    if (thumbBlob) await putBlob(`${id}:thumb`, thumbBlob);
    const item = {
      id, kind: 'screenshot', mode: 'full',
      title: tab.title || m.title || 'Full page capture', url: tab.url || m.url,
      createdAt: Date.now(), width: outW, height,
      cssWidth: Math.round(outW / scale), cssHeight: Math.round(height / scale),
      scale, dpr: m.dpr, frames, status: truncated ? 'truncated' : 'complete',
      warnings: [...new Set(warnings)],
      segments: segs.map((s) => ({ key: `${id}:seg${s.index}`, y: s.y, height: s.height, size: s.size })),
      size: segs.reduce((a, s) => a + s.size, 0),
      thumbKey: thumbBlob ? `${id}:thumb` : null, format: 'png',
    };
    await putItem(item);
    return item;
  } catch (e) {
    stitcher?.abort();
    await restore();
    // remove partially written segments
    for (const i of stitcher?.flushed || []) await deleteBlob(`${id}:seg${i}`).catch(() => {});
    throw e;
  }
}
