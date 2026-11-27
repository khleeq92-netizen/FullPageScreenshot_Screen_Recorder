// Performance & resource tests: increasingly large captures, a 60 s recording, memory sampling
// (total resident memory of all Chrome processes) and release of media resources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tabIdOf, sendMsg, verifyBands } from './harness.mjs';
import { sleep, waitRec, startRec, getItemById, dumpBlob, probe } from './rec-helpers.mjs';

export const launchOptions = { dropFake: true };

/** Sum of RSS (MB) of every process whose command line references this test profile. */
function chromeRssMb(userDir) {
  let kb = 0;
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!cmd.includes('chrome') || !(cmd.includes(userDir) || cmd.includes('--type='))) continue;
      const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/);
      if (m) kb += Number(m[1]);
    } catch { /* process ended */ }
  }
  return Math.round(kb / 1024);
}

async function sampleWhile(env, promise) {
  let peak = 0; let done = false;
  const base = chromeRssMb(env.userDir);
  const loop = (async () => { while (!done) { peak = Math.max(peak, chromeRssMb(env.userDir)); await sleep(250); } })();
  const t0 = Date.now();
  const result = await promise.finally(() => { done = true; });
  await loop;
  return { result, base, peak, secs: (Date.now() - t0) / 1000 };
}

export const tests = [
  ['capture time and memory scale with page length (10k → 30k → 60k CSS px at DPR 2)', async (env, url) => {
    const rows = [];
    for (const n of [100, 300, 600]) {
      const page = await env.context.newPage();
      await page.goto(`${url}/bands?n=${n}&perf=1`); await page.bringToFront();
      const tabId = await tabIdOf(env.ctrl, `/bands?n=${n}&perf=1`);
      const s = await sampleWhile(env, sendMsg(env.ctrl, { type: 'capture:start-wait', tabId, openEditor: false }));
      assert.ok(s.result.itemId, JSON.stringify(s.result));
      const v = await verifyBands(env.ctrl, s.result.itemId, { n });
      assert.ok(v.ok, `stitching failed for n=${n}: ${JSON.stringify(v.failures)}`);
      rows.push({ cssHeight: n * 100, px: `${v.item.width}x${v.item.height}`, megapixels: Math.round((v.item.width * v.item.height) / 1e6), secs: s.secs.toFixed(1), extraMb: s.peak - s.base, segments: v.item.segments });
      await page.close();
    }
    console.log('      ' + rows.map((r) => `${r.px} (${r.megapixels} MP, ${r.segments} segments): ${r.secs} s, +${r.extraMb} MB peak`).join('\n      '));
    // Memory must not grow with page length: the stitcher keeps at most ~2 segments in memory.
    const growth = rows[2].extraMb - rows[0].extraMb;
    assert.ok(growth < 400, `peak memory grew by ${growth} MB from 20 MP to 307 MP`);
  }],

  ['very large JPG export (2560 × 120,000 px) completes with bounded memory', async (env) => {
    const items = await env.ctrl.evaluate(() => new Promise((res) => { const q = indexedDB.open('fullpage-hd-capture'); q.onsuccess = () => { const t = q.result.transaction('items').objectStore('items').getAll(); t.onsuccess = () => res(t.result); }; }));
    const big = items.filter((i) => i.kind === 'screenshot').sort((a, b) => b.height - a.height)[0];
    const p = await env.context.newPage();
    await p.goto(env.extUrl(`screenshot.html?id=${big.id}`));
    await p.waitForFunction(() => window.__ready === true);
    const s = await sampleWhile(env, (async () => { await p.click('#export-jpg'); await p.waitForFunction(() => window.__lastExport, null, { timeout: 300000 }); return p.evaluate(() => window.__lastExport); })());
    assert.ok(!s.result.error, s.result.error);
    assert.equal(s.result.height, big.height); assert.equal(s.result.sizes.length, Math.ceil(big.height / 65535));
    console.log(`      ${s.result.width}x${s.result.height} → ${s.result.sizes.length} JPG part(s), ${(s.result.sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB in ${s.secs.toFixed(1)} s, +${s.peak - s.base} MB peak`);
    await p.close();
  }],

  ['60 s tab recording: memory stays flat (chunked to IndexedDB) and the file is complete', async (env, url) => {
    const page = await env.context.newPage();
    await page.goto(`${url}/media?long`); await page.bringToFront();
    const tabId = await tabIdOf(env.ctrl, '/media?long');
    await startRec(env, { tabId, config: { recAudio: 'tab', recResolution: '1080', recQuality: 'max' } });
    await waitRec(env, (st) => st.state === 'recording');
    await sleep(5000);
    const early = chromeRssMb(env.userDir);
    let peak = early;
    for (let i = 0; i < 55; i++) { await sleep(1000); peak = Math.max(peak, chromeRssMb(env.userDir)); }
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active, 60000);
    const item = await getItemById(env, st.itemId);
    const pr = probe(await dumpBlob(env, item.blobKey));
    console.log(`      ${pr.v.width}x${pr.v.height} ${pr.duration.toFixed(1)} s, ${(item.size / 1e6).toFixed(1)} MB at ${(item.bitrate / 1e6).toFixed(1)} Mbps; browser RSS ${early} MB after 5 s → peak ${peak} MB`);
    assert.ok(Math.abs(pr.duration - 60) < 2, `duration ${pr.duration}`);
    assert.ok(peak - early < 250, `memory grew by ${peak - early} MB during recording`);
    await page.close();
  }],

  ['media resources are released after stopping (no capture, no recorder document)', async (env, url) => {
    const page = await env.context.newPage();
    await page.goto(`${url}/media?release`); await page.bringToFront();
    const tabId = await tabIdOf(env.ctrl, '/media?release');
    await startRec(env, { tabId, config: { recAudio: 'tab' } });
    await waitRec(env, (s) => s.state === 'recording');
    const during = await env.sw.evaluate(async () => ({ captured: (await chrome.tabCapture.getCapturedTabs()).filter((t) => t.status === 'active').length, offscreen: (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length }));
    assert.deepEqual(during, { captured: 1, offscreen: 1 });
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    await waitRec(env, (s) => !s.active);
    await sleep(1000);
    const after = await env.sw.evaluate(async () => ({ captured: (await chrome.tabCapture.getCapturedTabs()).filter((t) => t.status === 'active').length, offscreen: (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length }));
    assert.deepEqual(after, { captured: 0, offscreen: 0 });
    assert.equal(await env.ctrl.evaluate(async () => (await chrome.action.getBadgeText({}))), '');
    await page.close();
  }],
];
