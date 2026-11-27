// Launches Chrome for Testing with the (test build of the) extension under Xvfb.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // pre-installed globally (NODE_PATH)
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

/** Chrome derives an unpacked extension's ID from its absolute path. */
export function extensionIdFor(dir) {
  const hex = crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export async function launch({ ext = path.join(ROOT, 'dist-test'), dpr = 2, extraArgs = [], dropFake = false } = {}) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fphd-profile-'));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'fphd-dl-'));
  // Chrome preferences: download straight to a known folder without prompting.
  fs.mkdirSync(path.join(userDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDir, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true } }));
  const context = await chromium.launchPersistentContext(userDir, {
    headless: false,
    viewport: null,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
      // Lets the test extension use tabCapture without a toolbar click (which automation cannot perform).
      `--allowlisted-extension-id=${extensionIdFor(ext)}`,
      `--force-device-scale-factor=${dpr}`, '--window-size=1280,900', '--window-position=0,0',
      ...(dropFake ? [] : ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']),
      '--auto-select-desktop-capture-source=Entire screen', '--auto-accept-this-tab-capture',
      '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
      ...extraArgs,
    ],
  });
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  // Close the welcome tab opened on install
  await new Promise((r) => setTimeout(r, 800));
  for (const p of context.pages()) if (p.url().includes('app.html')) await p.close().catch(() => {});
  const ctrl = await context.newPage();
  await ctrl.goto(`chrome-extension://${extId}/app.html#history`);
  return { context, sw, extId, ctrl, downloads, userDir, extUrl: (p) => `chrome-extension://${extId}/${p}` };
}

/** Run code inside an extension page (has chrome.* and IndexedDB access). */
export const inExt = (ctrl, fn, arg) => ctrl.evaluate(fn, arg);

export async function tabIdOf(ctrl, urlPart) {
  return ctrl.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => (t.url || t.pendingUrl || "").includes(u))?.id, urlPart);
}

export async function sendMsg(ctrl, msg) {
  return ctrl.evaluate((m) => chrome.runtime.sendMessage(m), msg);
}

/** In-page helpers (string so it can be evaluated in extension pages). */
export const IDB_HELPERS = `
  window.__idb = () => new Promise((res, rej) => { const r = indexedDB.open('fullpage-hd-capture'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  window.__get = async (store, key) => { const db = await __idb(); return new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
  window.__all = async (store) => { const db = await __idb(); return new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
`;

export function bandColor(i) { return [(i * 37 + 40) % 256, (i * 91 + 20) % 256, (i * 53 + 90) % 256]; }

/**
 * Verify a captured "bands" page: sample every band at its expected position (scaled by the capture scale)
 * and compare with the expected colour. Returns {ok, checked, failures, item}.
 */
export async function verifyBands(ctrl, itemId, { n, bh = 100, skipTopCss = 0, skipBottomCss = 0, x = 400 } = {}) {
  return ctrl.evaluate(async ({ itemId, n, bh, skipTopCss, skipBottomCss, x, helpers }) => {
    eval(helpers); // eslint-disable-line no-eval
    const item = await __get('items', itemId);
    const color = (i) => [(i * 37 + 40) % 256, (i * 91 + 20) % 256, (i * 53 + 90) % 256];
    const failures = []; let checked = 0;
    const s = item.scale;
    for (const seg of item.segments) {
      const blob = (await __get('blobs', seg.key)).blob;
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height); const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      for (let i = 0; i < n; i++) {
        // sample 3 rows per band: near top, middle, near bottom (5 CSS px inset)
        for (const off of [6, bh / 2, bh - 6]) {
          const cssY = i * bh + off;
          if (cssY < skipTopCss || cssY > n * bh - skipBottomCss) continue;
          const py = Math.round(cssY * s) - seg.y;
          if (py < 0 || py >= bmp.height) continue;
          const px = Math.round(x * s);
          const o = (py * bmp.width + px) * 4;
          const got = [data[o], data[o + 1], data[o + 2]]; const exp = color(i);
          checked++;
          if (got.some((v, k) => Math.abs(v - exp[k]) > 3)) failures.push({ band: i, cssY, got, exp });
        }
      }
      bmp.close();
    }
    return { ok: failures.length === 0, checked, failures: failures.slice(0, 10), nFail: failures.length, item: { ...item, segments: item.segments.length } };
  }, { itemId, n, bh, skipTopCss, skipBottomCss, x, helpers: IDB_HELPERS });
}

export function listDownloads(dir) {
  return fs.readdirSync(dir).filter((f) => !f.endsWith('.crdownload')).map((f) => path.join(dir, f));
}

export async function waitForFiles(dir, count, ms = 60000, pred = () => true) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const all = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (!p.endsWith('.crdownload') && pred(p)) all.push(p); } };
    walk(dir);
    if (all.length >= count) return all;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${count} download(s) in ${dir}`);
}
