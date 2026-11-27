// End-to-end screenshot tests in a real Chrome with the extension loaded.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tabIdOf, sendMsg, verifyBands, IDB_HELPERS } from './harness.mjs';

const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

async function openAndCapture(env, url, path_, { mode = 'full', settings = null } = {}) {
  if (settings) await env.ctrl.evaluate(async (s) => { const cur = (await chrome.storage.local.get('settings')).settings || {}; await chrome.storage.local.set({ settings: { ...cur, ...s } }); }, settings);
  const page = await env.context.newPage();
  await page.goto(`${url}${path_}`);
  await page.bringToFront();
  await page.waitForTimeout(300);
  const tabId = await tabIdOf(env.ctrl, path_.split('?')[0]);
  const r = await sendMsg(env.ctrl, { type: 'capture:start-wait', mode, tabId, openEditor: false });
  return { page, r, tabId };
}

export async function completedDownloads(p, afterId, count, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const done = await p.evaluate((id) => new Promise((r) => chrome.downloads.search({}, (d) => r(d.filter((x) => x.id > id).sort((a, b) => a.id - b.id)))), afterId);
    if (done.some((d) => d.state === 'interrupted')) throw new Error(`download interrupted: ${done.find((d) => d.state === 'interrupted').error}`);
    if (done.length >= count && done.every((d) => d.state === 'complete')) return done.map((d) => d.filename);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('downloads did not complete');
}

async function resetSettings(env) {
  await env.ctrl.evaluate(() => chrome.storage.local.remove('settings'));
}

async function exportFrom(env, itemId, kind, opts = {}) {
  const p = await env.context.newPage();
  await p.goto(env.extUrl(`screenshot.html?id=${itemId}`));
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  if (opts.name) await p.fill('#exp-name', opts.name);
  if (opts.quality) await p.selectOption('#jpg-q', String(opts.quality));
  if (opts.pdfLayout) await p.selectOption('#pdf-layout', opts.pdfLayout);
  if (opts.paper) await p.selectOption('#pdf-paper', opts.paper);
  if (opts.orient) await p.selectOption('#pdf-orient', opts.orient);
  const beforeId = await p.evaluate(() => new Promise((r) => chrome.downloads.search({}, (d) => r(Math.max(0, ...d.map((x) => x.id))))));
  await p.click(kind === 'jpeg' ? '#export-jpg' : kind === 'pdf' ? '#export-pdf' : '#export-png');
  await p.waitForFunction(() => window.__lastExport, null, { timeout: 180000 });
  const res = await p.evaluate(() => window.__lastExport);
  if (res.error) throw new Error(res.error);
  const fresh = await completedDownloads(p, beforeId, res.sizes.length);
  await p.close();
  return { res, files: fresh };
}

export const tests = [
  ['short page: single frame, exact viewport height', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/?short=1');
    const vh = await page.evaluate(() => innerHeight);
    const item = await env.ctrl.evaluate(async ({ id, h }) => { eval(h); return __get('items', id); }, { id: r.itemId, h: IDB_HELPERS });
    assert.equal(item.frames, 1); assert.equal(item.height, vh * 2); assert.equal(item.scale, 2); assert.equal(item.status, 'complete');
    await page.close();
  }],

  ['long page: pixel-exact stitching at DPR 2 (no gaps / duplicates)', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=80');
    const v = await verifyBands(env.ctrl, r.itemId, { n: 80 });
    assert.ok(v.ok, JSON.stringify(v.failures)); assert.equal(v.item.height, 16000); assert.equal(v.item.width, 2560);
    await page.close();
  }],

  ['odd band height (fractional overlaps / final partial viewport)', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=97&bh=73');
    const v = await verifyBands(env.ctrl, r.itemId, { n: 97, bh: 73 });
    assert.ok(v.ok, JSON.stringify(v.failures)); assert.equal(v.item.height, 97 * 73 * 2);
    await page.close();
  }],

  ['fixed header/footer/floating button appear once (minimise mode)', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=60&fixed=1&footer=1');
    const v = await verifyBands(env.ctrl, r.itemId, { n: 60, skipTopCss: 61, skipBottomCss: 41 });
    assert.ok(v.ok, `header/footer repeated: ${JSON.stringify(v.failures)}`);
    const top = await env.ctrl.evaluate(async ({ id, h }) => {
      eval(h); const it = await __get('items', id); const b = (await __get('blobs', it.segments[0].key)).blob;
      const bmp = await createImageBitmap(b); const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
      return [...x.getImageData(800, 40, 1, 1).data].slice(0, 3);
    }, { id: r.itemId, h: IDB_HELPERS });
    assert.deepEqual(top, [0, 0, 0], 'fixed header is shown at the top');
    await page.close();
  }],

  ['"handle normally" mode keeps fixed header as displayed (repeats)', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=60&fixed=1', { settings: { stickyMode: 'normal' } });
    const v = await verifyBands(env.ctrl, r.itemId, { n: 60, skipTopCss: 61 });
    assert.ok(v.nFail > 0, 'expected the fixed header to be repeated in normal mode');
    await resetSettings(env); await page.close();
  }],

  ['sticky header is neutralised (in-flow, appears once)', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=60&sticky=1');
    // the sticky header is in normal flow (60px) so bands start at y=60
    const res = await env.ctrl.evaluate(async ({ id, h }) => {
      eval(h); const it = await __get('items', id); const out = [];
      const color = (i) => [(i * 37 + 40) % 256, (i * 91 + 20) % 256, (i * 53 + 90) % 256];
      for (const seg of it.segments) {
        const b = (await __get('blobs', seg.key)).blob; const bmp = await createImageBitmap(b);
        const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
        for (let i = 0; i < 60; i++) { const py = (60 + i * 100 + 50) * 2 - seg.y; if (py < 0 || py >= bmp.height) continue; const d = x.getImageData(800, py, 1, 1).data; const e = color(i); if ([0, 1, 2].some((k) => Math.abs(d[k] - e[k]) > 3)) out.push(i); }
      }
      return { bad: out, height: it.height };
    }, { id: r.itemId, h: IDB_HELPERS });
    assert.deepEqual(res.bad, []); assert.equal(res.height, (60 + 6000) * 2);
    await page.close();
  }],

  ['page state restored after capture (scroll position & styles)', async (env, url) => {
    const page = await env.context.newPage();
    await page.goto(`${url}/bands?n=50&fixed=1`); await page.bringToFront();
    await page.evaluate(() => scrollTo(0, 1234));
    const tabId = await tabIdOf(env.ctrl, '/bands?n=50&fixed=1');
    await sendMsg(env.ctrl, { type: 'capture:start-wait', tabId, openEditor: false });
    const st = await page.evaluate(() => ({ y: scrollY, vis: getComputedStyle(document.getElementById('hdr')).visibility, style: !!document.getElementById('__fphd_capture_style__') }));
    assert.equal(st.y, 1234); assert.equal(st.vis, 'visible'); assert.equal(st.style, false);
    await page.close();
  }],

  ['lazy-loaded images and IntersectionObserver content are captured', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/lazy');
    const res = await env.ctrl.evaluate(async ({ id, h }) => {
      eval(h); const it = await __get('items', id); const missing = []; const late = [];
      const px = async (cssY, cssX) => {
        const y = Math.round(cssY * it.scale); const seg = it.segments.find((s) => y >= s.y && y < s.y + s.height);
        const b = (await __get('blobs', seg.key)).blob; const bmp = await createImageBitmap(b, 0, y - seg.y, bmp0w(it), 1);
        const c = new OffscreenCanvas(bmp.width, 1); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return [...x.getImageData(Math.round(cssX * it.scale), 0, 1, 1).data].slice(0, 3);
      };
      function bmp0w(i) { return i.width; }
      for (let i = 0; i < 30; i++) { const c = await px(100 + i * 300 + 120, 300); if (Math.abs(c[0] - 200) > 4 || Math.abs(c[2] - 50) > 4) missing.push({ i, c }); }
      for (let i = 0; i < 5; i++) { const c = await px(100 + 30 * 300 + i * 200 + 100, 300); if (!(c[1] > 180 && c[0] < 40)) late.push({ i, c }); }
      return { missing, late, status: it.status };
    }, { id: r.itemId, h: IDB_HELPERS });
    assert.deepEqual(res.missing, [], 'lazy images not loaded'); assert.deepEqual(res.late, [], 'observer content not loaded');
    await page.close();
  }],

  ['infinite scroll stops at the maximum capture height', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/infinite', { settings: { maxCaptureHeight: 9000 } });
    const item = await env.ctrl.evaluate(async ({ id, h }) => { eval(h); return __get('items', id); }, { id: r.itemId, h: IDB_HELPERS });
    assert.equal(item.status, 'truncated'); assert.equal(item.height, 18000); assert.ok(item.warnings.some((w) => /maximum capture height/i.test(w)));
    await resetSettings(env); await page.close();
  }],

  ['app layout with an inner scrolling element', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/inner');
    const item = await env.ctrl.evaluate(async ({ id, h }) => { eval(h); return __get('items', id); }, { id: r.itemId, h: IDB_HELPERS });
    assert.equal(item.height, 5000 * 2, 'full inner scroll height');
    const v = await verifyBands(env.ctrl, r.itemId, { n: 50 });
    assert.ok(v.ok, JSON.stringify(v.failures));
    await page.close();
  }],

  ['horizontally overflowing page is captured in 2D', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=30&wide=3000');
    const v = await verifyBands(env.ctrl, r.itemId, { n: 30, x: 2600 });
    assert.ok(v.ok, JSON.stringify(v.failures)); assert.equal(v.item.width, 6000);
    await page.close();
  }],

  ['table and news article pages complete with exact document height', async (env, url) => {
    for (const p of ['/table', '/article']) {
      const { r, page } = await openAndCapture(env, url, p);
      const docH = await page.evaluate(() => document.documentElement.scrollHeight);
      const item = await env.ctrl.evaluate(async ({ id, h }) => { eval(h); return __get('items', id); }, { id: r.itemId, h: IDB_HELPERS });
      assert.equal(item.status, 'complete'); assert.ok(Math.abs(item.height - docH * 2) <= 2, `${p}: ${item.height} vs ${docH * 2}`);
      await page.close();
    }
  }],

  ['visible-area capture', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=40', { mode: 'visible' });
    const vw = await page.evaluate(() => innerWidth);
    const item = await env.ctrl.evaluate(async ({ id, h }) => { eval(h); return __get('items', id); }, { id: r.itemId, h: IDB_HELPERS });
    assert.equal(item.mode, 'visible'); assert.equal(item.width, vw * 2);
    await page.close();
  }],

  ['restricted chrome:// page gives a clear error', async (env) => {
    const page = await env.context.newPage();
    await page.goto('chrome://version'); await page.bringToFront();
    const tabId = await tabIdOf(env.ctrl, 'chrome://version');
    const r = await sendMsg(env.ctrl, { type: 'capture:start-wait', tabId, openEditor: false });
    assert.equal(r.ok, false); assert.match(r.error, /internal pages/i);
    await page.close();
  }],

  ['cancel during capture leaves no item and restores the page', async (env, url) => {
    const count0 = await env.ctrl.evaluate(async (h) => { eval(h); return (await __all('items')).length; }, IDB_HELPERS);
    const page = await env.context.newPage();
    await page.goto(`${url}/bands?n=300`); await page.bringToFront();
    const tabId = await tabIdOf(env.ctrl, '/bands?n=300');
    const p = sendMsg(env.ctrl, { type: 'capture:start-wait', tabId, openEditor: false });
    await new Promise((r) => setTimeout(r, 2500));
    await sendMsg(env.ctrl, { type: 'capture:cancel' });
    const r = await p;
    assert.ok(!r.itemId);
    const count1 = await env.ctrl.evaluate(async (h) => { eval(h); return (await __all('items')).length; }, IDB_HELPERS);
    assert.equal(count1, count0);
    const st = await page.evaluate(() => ({ y: scrollY, style: !!document.getElementById('__fphd_capture_style__') }));
    assert.equal(st.y, 0); assert.equal(st.style, false);
    await page.close();
  }],

  ['JPG export: full resolution, 4:4:4, high fidelity vs lossless source', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/article');
    await page.close();
    const { res, files } = await exportFrom(env, r.itemId, 'jpeg', { name: 'jpgtest', quality: 95 });
    assert.equal(files.length, 1);
    const item = await env.ctrl.evaluate(async ({ id, h }) => { eval(h); return __get('items', id); }, { id: r.itemId, h: IDB_HELPERS });
    const out = py(`
import sys; from PIL import Image
im = Image.open(sys.argv[1]); print(im.size[0], im.size[1], im.info.get('dpi', (0,0))[0], im.mode)
`, files[0]).split(' ');
    assert.equal(Number(out[0]), item.width); assert.equal(Number(out[1]), item.height); assert.equal(Number(out[2]), 192);
    const sub = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', files[0]], { encoding: 'utf8' }).trim();
    assert.equal(sub, 'yuvj444p');
    // Compare with the lossless source segments (dumped from IndexedDB)
    const segs = await env.ctrl.evaluate(async ({ id, h }) => {
      eval(h); const it = await __get('items', id); const out = [];
      for (const s of it.segments) { const b = (await __get('blobs', s.key)).blob; const buf = new Uint8Array(await b.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); out.push(btoa(bin)); }
      return out;
    }, { id: r.itemId, h: IDB_HELPERS });
    const tmp = fs.mkdtempSync('/tmp/fphd-seg-');
    segs.forEach((b64, i) => fs.writeFileSync(path.join(tmp, `s${String(i).padStart(3, '0')}.png`), Buffer.from(b64, 'base64')));
    const psnr = py(`
import sys, glob, numpy as np; from PIL import Image
parts=[np.asarray(Image.open(f).convert('RGB')) for f in sorted(glob.glob(sys.argv[1]+'/s*.png'))]
src=np.concatenate(parts,0).astype(float); jp=np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(float)
mse=((src-jp)**2).mean(); print(round(10*np.log10(255**2/mse),2))
`, tmp, files[0]);
    assert.ok(Number(psnr) > 38, `PSNR ${psnr} dB too low`);
    console.log(`      JPG ${res.width}x${res.height}, PSNR ${psnr} dB vs lossless capture`);
  }],

  ['very long page: >65535px exported as full-res JPG parts; PDF single long page', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=400');
    await page.close();
    const v = await verifyBands(env.ctrl, r.itemId, { n: 400 });
    assert.ok(v.ok, JSON.stringify(v.failures)); assert.equal(v.item.height, 80000);
    const j = await exportFrom(env, r.itemId, 'jpeg', { name: 'verylong' });
    assert.equal(j.files.length, 2);
    const hs = j.files.map((f) => py('import sys; from PIL import Image; print(Image.open(sys.argv[1]).size[1])', f)).map(Number);
    assert.equal(hs.reduce((a, b) => a + b, 0), 80000, 'parts cover every row');
    const p = await exportFrom(env, r.itemId, 'pdf', { name: 'verylong', pdfLayout: 'single' });
    const info = execFileSync('pdfinfo', [p.files[0]], { encoding: 'utf8' });
    assert.match(info, /Pages:\s+1/);
    const imgs = execFileSync('pdfimages', ['-list', p.files[0]], { encoding: 'utf8' }).trim().split('\n').slice(2);
    const totalRows = imgs.reduce((a, l) => a + Number(l.trim().split(/\s+/)[4]), 0);
    assert.ok(imgs.every((l) => Number(l.trim().split(/\s+/)[3]) === 2560), 'every PDF image keeps 2560 px width');
    assert.ok(totalRows >= 80000, `PDF contains all rows (${totalRows})`);
  }],

  ['PDF A4 / Letter / landscape multi-page with margins', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/article');
    await page.close();
    for (const [paper, orient, size] of [['a4', 'portrait', [595, 842]], ['letter', 'landscape', [792, 612]]]) {
      const { files, res } = await exportFrom(env, r.itemId, 'pdf', { name: `paged_${paper}`, pdfLayout: 'paged', paper, orient });
      const info = execFileSync('pdfinfo', [files[0]], { encoding: 'utf8' });
      const m = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/); const pages = Number(info.match(/Pages:\s+(\d+)/)[1]);
      assert.ok(Math.abs(Number(m[1]) - size[0]) < 1 && Math.abs(Number(m[2]) - size[1]) < 1, info);
      assert.equal(pages, res.pages); assert.ok(pages > 3);
      const imgs = execFileSync('pdfimages', ['-list', files[0]], { encoding: 'utf8' }).trim().split('\n').slice(2);
      assert.equal(imgs.length, pages);
      assert.ok(imgs.every((l) => Number(l.trim().split(/\s+/)[3]) === res.width), 'page images keep full source width');
    }
  }],

  ['edits (crop + rotate + rectangle + text + blur) are present in export; original untouched', async (env, url) => {
    const { r, page } = await openAndCapture(env, url, '/bands?n=30');
    await page.close();
    await env.ctrl.evaluate(async ({ id }) => {
      const db = await new Promise((res) => { const q = indexedDB.open('fullpage-hd-capture'); q.onsuccess = () => res(q.result); });
      const doc = {
        crop: { x: 100, y: 200, w: 1000, h: 1600 }, rotation: 90,
        annotations: [
          { id: 'r1', type: 'rect', x1: 200, y1: 300, x2: 600, y2: 700, color: '#ff0000', width: 20 },
          { id: 't1', type: 'text', x1: 300, y1: 1000, x2: 300, y2: 1000, text: 'HELLO', color: '#00ff00', fontSize: 80 },
          { id: 'b1', type: 'blur', x1: 700, y1: 1200, x2: 1000, y2: 1500, mode: 'solid', color: '#0000ff', strength: 20 },
        ],
      };
      await new Promise((res) => { const t = db.transaction('projects', 'readwrite'); t.objectStore('projects').put({ itemId: id, data: doc, savedAt: Date.now() }); t.oncomplete = res; });
    }, { id: r.itemId });
    const { files } = await exportFrom(env, r.itemId, 'png', { name: 'edited' });
    const out = py(`
import sys; from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB'); w,h = im.size
# source (x,y) -> output after crop (100,200,1000x1600) and rotate 90 cw: ox = (1600-1) - (y-200), oy = x-100
def at(x,y): return im.getpixel(((1600-1)-(y-200), x-100))
print(w, h, at(200+5, 500), at(850, 1350))
`, files[0]);
    assert.match(out, /^1600 1000 \(255, 0, 0\) \(0, 0, 255\)$/, out);
    const v = await verifyBands(env.ctrl, r.itemId, { n: 30 });
    assert.ok(v.ok, 'original capture must be unchanged');
  }],
];
