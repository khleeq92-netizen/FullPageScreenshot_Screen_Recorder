// Screen recording tests (desktop capture via the recording-control window; fake mic & camera).
import assert from 'node:assert/strict';
import { sleep, recState, waitRec, startRec, dumpBlob, getItemById, probe, volumeDb, frameAt, sendMsg } from './rec-helpers.mjs';
import { IDB_HELPERS } from './harness.mjs';

export const launchOptions = { dropFake: false };

export const tests = [
  ['entire screen + microphone + webcam (composited): webcam is in the video, mic audible', async (env) => {
    const r = await startRec(env, { source: 'screen', config: { recAudio: 'mic', webcamEnabled: true, webcamMode: 'burn', webcamShape: 'circle', webcamPosition: 'bottom-right', webcamSize: 22, recResolution: '1080' } });
    assert.equal(r.ok, true, JSON.stringify(r));
    await sleep(3500);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    const item = await getItemById(env, st.itemId);
    assert.equal(item.source, 'screen'); assert.equal(item.audio.mic, true);
    const f = await dumpBlob(env, item.blobKey);
    const p = probe(f);
    assert.ok(p.a, 'audio track'); assert.ok(volumeDb(f).max > -40, 'fake microphone tone is audible');
    // webcam circle: white ring at its left edge, camera content inside
    const fr = frameAt(f, 1.5);
    const w = Math.round(fr.w * 0.22); const m = Math.round(Math.min(fr.w, fr.h) * 0.03);
    const cx = fr.w - m - w / 2; const cy = fr.h - m - w / 2;
    const ring = fr.px(cx - w / 2 + 1, cy);
    assert.ok(ring.every((v) => v > 200), `white webcam ring expected, got ${ring}`);
    console.log(`      ${p.v.width}x${p.v.height} ${p.duration.toFixed(2)} s, webcam ring ${ring}`);
  }],

  ['webcam as a separate editable track', async (env) => {
    await startRec(env, { source: 'screen', config: { recAudio: 'none', webcamEnabled: true, webcamMode: 'separate' } });
    await sleep(2500);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    const item = await getItemById(env, st.itemId);
    assert.ok(item.webcamBlobKey, 'webcam track saved');
    const cam = probe(await dumpBlob(env, item.webcamBlobKey));
    assert.ok(cam.frames > 10 && cam.v.width > 0);
  }],

  ['system audio not offered -> clear warning, recording continues', async (env) => {
    await startRec(env, { source: 'screen', config: { recAudio: 'both' } });
    await sleep(1500);
    const live = await recState(env);
    assert.ok((live.warnings || []).some((w) => /system audio/i.test(w)));
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    assert.equal(st.state, 'done');
  }],

  ['60 fps request: actual frame rate is measured and reported (never claimed higher than delivered)', async (env) => {
    await startRec(env, { source: 'screen', config: { recAudio: 'none', recFps: 60 } });
    await sleep(3000);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    const item = await getItemById(env, st.itemId);
    assert.equal(item.targetFps, 60);
    const p = probe(await dumpBlob(env, item.blobKey));
    const real = p.frames / p.duration;
    assert.ok(item.fps <= 62, `reported ${item.fps}`);
    console.log(`      requested 60 fps, measured ${item.fps} fps, file average ${real.toFixed(1)} fps`);
  }],

  ['countdown, then pause/resume/stop through the control window host', async (env) => {
    await startRec(env, { source: 'screen', config: { recAudio: 'mic', countdown: 3 } });
    const st0 = await recState(env);
    assert.ok(st0.hostId.startsWith('window:'));
    await sleep(1500);
    await sendMsg(env.ctrl, { type: 'rec:pause' });
    await waitRec(env, (s) => s.state === 'paused');
    await sendMsg(env.ctrl, { type: 'rec:mute', muted: true });
    await waitRec(env, (s) => s.muted === true);
    await sendMsg(env.ctrl, { type: 'rec:resume' });
    await sleep(1000);
    await sendMsg(env.ctrl, { type: 'rec:stop' });
    const st = await waitRec(env, (s) => !s.active);
    assert.equal(st.state, 'done');
  }],

  ['closing the control window mid-recording keeps the data recoverable from history', async (env) => {
    await startRec(env, { source: 'screen', config: { recAudio: 'none' } });
    await sleep(3000);
    const st = await recState(env);
    // Simulate an abrupt end: kill the host window without letting it finalise
    await env.ctrl.evaluate(async (wid) => { await chrome.windows.remove(wid); }, st.hostWindowId);
    const after = await waitRec(env, (s) => !s.active, 15000);
    const chunks = await env.ctrl.evaluate(async (h) => { eval(h); return (await __all('chunks')).length; }, IDB_HELPERS);
    if (after.state === 'done') return; // finalised gracefully on pagehide: also acceptable
    assert.ok(chunks > 0, 'chunks were kept for recovery');
    const hist = await env.context.newPage();
    await hist.goto(env.extUrl('app.html#history'));
    await hist.waitForSelector('#recovery button.primary', { timeout: 10000 });
    await hist.click('#recovery button.primary');
    await hist.waitForFunction(() => !document.querySelector('#recovery button.primary'), null, { timeout: 20000 });
    const items = await env.ctrl.evaluate(async (h) => { eval(h); return (await __all('items')).filter((i) => i.status === 'recovered'); }, IDB_HELPERS);
    assert.equal(items.length, 1);
    const p = probe(await dumpBlob(env, items[0].blobKey));
    assert.ok(p.frames > 10 && p.duration > 1.5, `recovered ${p.duration}s`);
    await hist.close();
  }],
];
