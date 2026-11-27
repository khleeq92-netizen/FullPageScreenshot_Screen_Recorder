// Privacy & security tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, IDB_HELPERS, tabIdOf, sendMsg } from './harness.mjs';
import { sleep, waitRec, startRec } from './rec-helpers.mjs';

export const launchOptions = { dropFake: true };

const LOCAL = /^(chrome-extension:|blob:|data:|about:|chrome:|http:\/\/127\.0\.0\.1[:/])/;
// Documentation links inside library error messages / XML namespaces – strings, never requested.
// `.example` is a reserved, never-resolving domain (RFC 2606) used for the filename preview in Settings.
const DOC_STRINGS = /^https?:\/\/((www\.w3\.org|www\.webmproject\.org|aomediacodec\.github\.io)\/|[a-z0-9.-]+\.example\b)/;

export const tests = [
  ['production manifest uses minimal permissions (no host access, no content scripts, local CSP)', async () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/manifest.json'), 'utf8'));
    assert.equal(m.manifest_version, 3);
    assert.equal(m.host_permissions, undefined, 'no always-on host permissions');
    assert.equal(m.content_scripts, undefined, 'nothing is injected automatically');
    assert.deepEqual(m.optional_host_permissions, ['<all_urls>']);
    assert.deepEqual([...m.permissions].sort(), ['activeTab', 'desktopCapture', 'downloads', 'offscreen', 'scripting', 'storage', 'tabCapture', 'unlimitedStorage'].sort());
    assert.match(m.content_security_policy.extension_pages, /script-src 'self'/);
    assert.doesNotMatch(m.content_security_policy.extension_pages, /https?:/);
  }],

  ['bundles contain no network endpoints or upload APIs', async () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'dist')).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(ROOT, 'dist', f), 'utf8');
      const urls = (src.match(/https?:\/\/[a-zA-Z0-9._~:/?#@!$&'*+,;=%-]+/g) || []).filter((u) => !DOC_STRINGS.test(u));
      assert.deepEqual(urls, [], `${f} contains URLs: ${urls.join(', ')}`);
      assert.doesNotMatch(src, /XMLHttpRequest|new WebSocket|sendBeacon|EventSource/, f);
    }
  }],

  ['no external requests during capture, export and recording', async (env, url) => {
    const external = [];
    const onReq = (req) => { const u = req.url(); if (!LOCAL.test(u)) external.push(u); };
    env.context.on('request', onReq);
    try {
      const page = await env.context.newPage();
      await page.goto(`${url}/bands?n=30`); await page.bringToFront();
      const tabId = await tabIdOf(env.ctrl, '/bands?n=30');
      const r = await sendMsg(env.ctrl, { type: 'capture:start-wait', tabId, openEditor: false });
      const ed = await env.context.newPage();
      await ed.goto(env.extUrl(`screenshot.html?id=${r.itemId}`));
      await ed.waitForFunction(() => window.__ready === true);
      await ed.click('#export-pdf');
      await ed.waitForFunction(() => window.__lastExport, null, { timeout: 60000 });
      await ed.close();
      await page.bringToFront();
      await startRec(env, { tabId, config: { recAudio: 'tab' } });
      await sleep(2000);
      await sendMsg(env.ctrl, { type: 'rec:stop' });
      const st = await waitRec(env, (s) => !s.active);
      const ve = await env.context.newPage();
      await ve.goto(env.extUrl(`video-editor.html?id=${st.itemId}`));
      await ve.waitForFunction(() => window.__editorReady === true, null, { timeout: 30000 });
      await ve.evaluate(() => { const p = window.__editor.project; window.__editor.project = { ...p, rotation: 90 }; });
      await ve.evaluate(() => window.__editor.runExport({ format: 'webm', resolution: 'source', fps: 'source', quality: 'standard', audio: true, name: 'x' }));
      await ve.waitForFunction(() => window.__lastVideoExport, null, { timeout: 120000 });
      for (const p of ['popup.html', 'app.html#dashboard', 'app.html#recorder', 'app.html#history', 'app.html#settings']) {
        const x = await env.context.newPage(); await x.goto(env.extUrl(p)); await sleep(600); await x.close();
      }
      await ve.close(); await page.close();
    } finally { env.context.off('request', onReq); }
    assert.deepEqual(external, [], `external requests: ${external.join(', ')}`);
  }],

  ['nothing is captured or recorded without an explicit action', async (env, url) => {
    const fresh = await env.ctrl.evaluate(async (h) => { eval(h); return (await __all('items')).length; }, IDB_HELPERS);
    const page = await env.context.newPage();
    await page.goto(`${url}/media`); await sleep(1500);
    await page.goto(`${url}/bands?n=5`); await sleep(1500);
    const after = await env.ctrl.evaluate(async (h) => { eval(h); return (await __all('items')).length; }, IDB_HELPERS);
    assert.equal(after, fresh);
    const contexts = await env.sw.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
    assert.equal(contexts.length, 0, 'no recorder running');
    assert.equal(await page.evaluate(() => !!document.getElementById('__fphd_root__') || !!window.__fphdAgent), false, 'no scripts injected');
    await page.close();
  }],

  ['microphone/camera are not requested just by opening pages', async (env) => {
    const p = await env.context.newPage();
    await p.goto(env.extUrl('app.html#recorder')); await sleep(1200);
    const st = await p.evaluate(async () => [(await navigator.permissions.query({ name: 'microphone' })).state, (await navigator.permissions.query({ name: 'camera' })).state]);
    assert.deepEqual(st, ['prompt', 'prompt']);
    await p.close();
  }],

  ['"Delete temporary files" removes orphaned media and unfinished chunks but keeps history', async (env) => {
    const before = await env.ctrl.evaluate(async (h) => { eval(h); return { items: (await __all('items')).length, blobs: (await __all('blobs')).length }; }, IDB_HELPERS);
    await env.ctrl.evaluate(async () => {
      const db = await new Promise((res) => { const q = indexedDB.open('fullpage-hd-capture'); q.onsuccess = () => res(q.result); });
      await new Promise((res) => { const t = db.transaction(['blobs', 'chunks'], 'readwrite'); t.objectStore('blobs').put({ key: 'orphan:x', blob: new Blob(['x']) }); t.objectStore('chunks').put({ recId: 'rec_dead', seq: 0, blob: new Blob(['y']), at: Date.now() }); t.oncomplete = res; });
    });
    const s = await env.context.newPage();
    await s.goto(env.extUrl('app.html#settings'));
    await s.click('#cleanup-temp');
    await sleep(1200);
    const after = await env.ctrl.evaluate(async (h) => { eval(h); return { items: (await __all('items')).length, blobs: (await __all('blobs')).length, chunks: (await __all('chunks')).length, orphan: !!(await __get('blobs', 'orphan:x')) }; }, IDB_HELPERS);
    assert.equal(after.orphan, false); assert.equal(after.chunks, 0); assert.equal(after.items, before.items); assert.equal(after.blobs, before.blobs);
    await s.close();
  }],

  ['history: delete one capture, then clear everything', async (env) => {
    const h0 = await env.context.newPage();
    await h0.goto(env.extUrl('app.html#history'));
    await h0.waitForSelector('.cap-card');
    const n0 = await h0.locator('.cap-card').count();
    const firstId = await h0.locator('.cap-card').first().getAttribute('data-id');
    await h0.locator('.cap-card').first().locator('button[title="Delete"]').click();
    await h0.locator('.modal .btn.danger').click();
    await h0.waitForFunction((n) => document.querySelectorAll('.cap-card').length === n - 1, n0);
    const gone = await env.ctrl.evaluate(async ({ id, h }) => { eval(h); return { item: await __get('items', id), blobs: (await __all('blobs')).filter((b) => b.key.startsWith(`${id}:`)).length }; }, { id: firstId, h: IDB_HELPERS });
    assert.equal(gone.item, undefined); assert.equal(gone.blobs, 0, 'media of the deleted capture removed');
    await h0.click('#hist-clear');
    await h0.locator('.modal .btn.danger').click();
    await h0.waitForSelector('.empty');
    const left = await env.ctrl.evaluate(async (h) => { eval(h); return [(await __all('items')).length, (await __all('blobs')).length, (await __all('projects')).length]; }, IDB_HELPERS);
    assert.deepEqual(left, [0, 0, 0]);
    await h0.close();
  }],

  ['keyboard shortcuts: all four default keys are actually assigned by Chrome', async (env) => {
    const cmds = Object.fromEntries((await env.ctrl.evaluate(() => chrome.commands.getAll())).map((c) => [c.name, c.shortcut]));
    assert.deepEqual(
      { open: cmds._execute_action, capture: cmds['capture-full-page'], record: cmds['toggle-recording'], pause: cmds['toggle-recording-pause'] },
      { open: 'Alt+Shift+F', capture: 'Alt+Shift+S', record: 'Alt+Shift+V', pause: 'Alt+Shift+K' },
    );
    for (const n of ['capture-visible', 'record-screen', 'stop-recording', 'toggle-annotation']) assert.ok(n in cmds, `${n} is available to assign`);
  }],
];
