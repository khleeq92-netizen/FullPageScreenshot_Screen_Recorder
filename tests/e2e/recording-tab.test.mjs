// Tab recording tests (real tab capture – Chrome's fake-device flag would replace tab capture, so it is off here).
import assert from 'node:assert/strict';
import { sleep, recState, waitRec, startRec, dumpBlob, getItemById, probe, volumeDb, frameAt, tabIdOf, sendMsg } from './rec-helpers.mjs';
import { IDB_HELPERS } from './harness.mjs';

export const launchOptions = { dropFake: true };

async function mediaTab(env, url) {
  const page = await env.context.newPage();
  await page.goto(`${url}/media?${Math.random()}`);
  await page.bringToFront();
  const tabId = await tabIdOf(env.ctrl, page.url().split('/').pop());
  return { page, tabId };
}

export const tests = [
  ['tab recording 1080p30 with tab audio: real dimensions, duration, audible audio', async (env, url) => {
    const { page, tabId } = await mediaTab(env, url);
    const r = await startRec(env, { tabId, config: { recAudio: 'tab', recResolution: '1080', recFps: 30, recCodec: 'vp9' } });
    assert.equal(r.ok, true, JSON.stringify(r));
    await page.mouse.click(400, 400); // starts the page's 440 Hz tone
    await sleep(4000);
    const live = await recState(env);
    assert.equal(live.state, 'recording'); assert.ok(live.bytes > 0, 'chunks are being written');
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    assert.equal(st.state, 'done');
    const item = await getItemById(env, st.itemId);
    const f = await dumpBlob(env, item.blobKey);
    const p = probe(f);
    assert.equal(p.v.codec_name, 'vp9'); assert.equal(p.a.codec_name, 'opus');
    assert.ok(p.v.width <= 1920 && p.v.height <= 1080, `${p.v.width}x${p.v.height}`);
    assert.equal(p.v.width, item.width); assert.equal(p.v.height, item.height);
    assert.ok(Math.abs(p.duration - item.duration) < 0.3 && p.duration > 3.5, `duration ${p.duration} vs ${item.duration}`);
    assert.ok(p.frames > 20, `decoded ${p.frames} frames`);
    const vol = volumeDb(f);
    assert.ok(vol.max > -20, `tab audio should be audible (max ${vol.max} dB)`);
    console.log(`      ${p.v.width}x${p.v.height}, ${p.duration.toFixed(2)} s, ${p.frames} frames (measured ${item.fps} fps), audio max ${vol.max} dB`);
    await page.close();
  }],

  ['720p setting is respected and not upscaled', async (env, url) => {
    const { page, tabId } = await mediaTab(env, url);
    await startRec(env, { tabId, config: { recAudio: 'none', recResolution: '720' } });
    await sleep(2000);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    const p = probe(await dumpBlob(env, (await getItemById(env, st.itemId)).blobKey));
    assert.ok(p.v.width <= 1280 && p.v.height <= 720, `${p.v.width}x${p.v.height}`);
    assert.equal(p.a, undefined, 'no audio track when audio is off');
    await page.close();
  }],

  ['pause/resume produces one file whose duration excludes the pause', async (env, url) => {
    const { page, tabId } = await mediaTab(env, url);
    await startRec(env, { tabId, config: { recAudio: 'tab' } });
    await sleep(2000);
    await sendMsg(env.ctrl, { type: 'rec:pause' });
    assert.equal((await waitRec(env, (s) => s.state === 'paused')).state, 'paused');
    await sleep(3000);
    await sendMsg(env.ctrl, { type: 'rec:resume' });
    await sleep(2000);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    const item = await getItemById(env, st.itemId);
    const p = probe(await dumpBlob(env, item.blobKey));
    assert.ok(p.duration > 3.4 && p.duration < 5, `duration ${p.duration} should be ~4 s (pause excluded)`);
    await page.close();
  }],

  ['cancel discards the recording and its temporary chunks', async (env, url) => {
    const before = await env.ctrl.evaluate(async (h) => { eval(h); return (await __all('items')).length; }, IDB_HELPERS);
    const { page, tabId } = await mediaTab(env, url);
    await startRec(env, { tabId, config: { recAudio: 'none' } });
    await sleep(2500);
    await sendMsg(env.ctrl, { type: 'rec:cancel' });
    const st = await waitRec(env, (s) => !s.active);
    assert.equal(st.state, 'cancelled');
    const after = await env.ctrl.evaluate(async (h) => { eval(h); return { items: (await __all('items')).length, chunks: (await __all('chunks')).length }; }, IDB_HELPERS);
    assert.equal(after.items, before); assert.equal(after.chunks, 0);
    await page.close();
  }],

  ['recording survives closing the page that started it (popup closure)', async (env, url) => {
    const { page, tabId } = await mediaTab(env, url);
    const starter = await env.context.newPage();
    await starter.goto(env.extUrl('popup.html'));
    await starter.evaluate(({ tabId }) => chrome.runtime.sendMessage({ type: 'rec:start', source: 'tab', tabId, config: { countdown: 0, recAudio: 'none', openEditorAfterRecording: false } }), { tabId });
    await waitRec(env, (s) => s.state === 'recording');
    await starter.close();
    await page.bringToFront();
    await sleep(2500);
    assert.equal((await recState(env)).state, 'recording');
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    assert.equal(st.state, 'done');
    assert.ok(probe(await dumpBlob(env, (await getItemById(env, st.itemId)).blobKey)).duration > 2);
    await page.close();
  }],

  ['closing the recorded tab (source terminated) stops and saves a playable file', async (env, url) => {
    const { page, tabId } = await mediaTab(env, url);
    await startRec(env, { tabId, config: { recAudio: 'tab' } });
    await sleep(2500);
    await page.close();
    const st = await waitRec(env, (s) => !s.active, 20000);
    assert.equal(st.state, 'done', JSON.stringify(st));
    const item = await getItemById(env, st.itemId);
    assert.ok(item.warnings.some((w) => /stopped|ended/i.test(w)));
    assert.ok(probe(await dumpBlob(env, item.blobKey)).frames > 10);
  }],

  ['in-page overlay: toolbar + click effects injected during recording and removed afterwards', async (env, url) => {
    const { page, tabId } = await mediaTab(env, url);
    await startRec(env, { tabId, config: { recAudio: 'none', showToolbar: true, clickEffects: true } });
    await waitRec(env, (s) => s.state === 'recording');
    await sleep(700);
    assert.equal(await page.evaluate(() => !!document.getElementById('__fphd_root__')), true);
    // annotation toggle round trip
    await sendMsg(env.ctrl, { type: 'rec:annotate-toggle' });
    await sleep(300);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    await waitRec(env, (s) => !s.active);
    await sleep(700);
    assert.equal(await page.evaluate(() => !!document.getElementById('__fphd_root__')), false);
    await page.close();
  }],

  ['annotations drawn on the page appear in the recorded video', async (env, url) => {
    const page = await env.context.newPage();
    await page.goto(`${url}/bands?n=20&bh=400`); await page.bringToFront();
    const tabId = await tabIdOf(env.ctrl, '/bands?n=20&bh=400');
    await startRec(env, { tabId, config: { recAudio: 'none', showToolbar: true, syntheticCursor: false } });
    await waitRec(env, (s) => s.state === 'recording');
    await sendMsg(env.ctrl, { type: 'rec:annotate-toggle' });
    await sleep(400);
    // draw a thick red pen stroke across the middle (pen is the default tool, red default colour)
    await page.mouse.move(200, 300); await page.mouse.down();
    for (let x = 200; x <= 900; x += 20) await page.mouse.move(x, 300);
    await page.mouse.up();
    await sleep(1500);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    const item = await getItemById(env, st.itemId);
    const f = await dumpBlob(env, item.blobKey);
    const fr = frameAt(f, Math.max(0.1, probe(f).duration - 0.4));
    const [vw, vh] = await page.evaluate(() => [innerWidth, innerHeight]);
    assert.ok(Math.abs(fr.w / fr.h - vw / vh) < 0.02, `video aspect ${fr.w}x${fr.h} should match the tab ${vw}x${vh} (no letterbox)`);
    const k = fr.w / vw;
    const c = fr.px(550 * k, 300 * k);
    assert.ok(c[0] > 180 && c[1] < 90 && c[2] < 90, `expected red annotation in video, got ${c}`);
    const edge = fr.px(2, fr.h / 2);
    assert.ok(edge.some((v) => v > 30), `no black letterbox bar at the left edge (${edge})`);
    await page.close();
  }],

  ['screenshot during recording is saved to history', async (env, url) => {
    const { page, tabId } = await mediaTab(env, url);
    await startRec(env, { tabId, config: { recAudio: 'none' } });
    await waitRec(env, (s) => s.state === 'recording');
    await sleep(1000);
    const r = await sendMsg(env.ctrl, { type: 'rec:screenshot' });
    assert.equal(r.ok, true);
    const shot = await getItemById(env, r.itemId);
    assert.equal(shot.mode, 'recording-frame'); assert.ok(shot.width >= 640);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    await waitRec(env, (s) => !s.active);
    await page.close();
  }],

  ['VP8 and H.264 codec options record playable files', async (env, url) => {
    for (const codec of ['vp8', 'h264']) {
      const { page, tabId } = await mediaTab(env, url);
      await startRec(env, { tabId, config: { recAudio: 'tab', recCodec: codec } });
      await sleep(2000);
      await sendMsg(env.ctrl, { type: 'rec:stop' });
      const st = await waitRec(env, (s) => !s.active);
      const item = await getItemById(env, st.itemId);
      const p = probe(await dumpBlob(env, item.blobKey, item.format));
      assert.equal(p.v.codec_name, codec === 'h264' ? 'h264' : 'vp8', item.mimeType);
      assert.ok(p.frames > 10);
      await page.close();
    }
  }],
];
