// Video editor tests: real editing through the UI + WebCodecs export, verified with ffprobe/ffmpeg.
// Source fixture: 6 s 1280x720 VP9/Opus – 0-2 s red, 2-4 s green, 4-6 s blue, 440 Hz tone, white 64px square top-left.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';
import { dumpBlob, getItemById, probe, volumeDb, frameAt, sleep } from './rec-helpers.mjs';

export const launchOptions = { dropFake: true };

const FIXTURE = path.join(ROOT, 'tests/fixtures/media/rgb-6s.webm');

async function importFixture(env, { webcam = false } = {}) {
  const b64 = fs.readFileSync(FIXTURE).toString('base64');
  return env.ctrl.evaluate(async ({ b64, webcam }) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const blob = new Blob([u], { type: 'video/webm' });
    const id = `imp_test_${Math.random().toString(36).slice(2)}`;
    const db = await new Promise((res) => { const q = indexedDB.open('fullpage-hd-capture'); q.onsuccess = () => res(q.result); });
    const put = (store, val) => new Promise((res, rej) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(val); t.oncomplete = res; t.onerror = () => rej(t.error); });
    await put('blobs', { key: `${id}:video`, blob });
    if (webcam) await put('blobs', { key: `${id}:webcam`, blob });
    await put('items', { id, kind: 'video', title: 'RGB fixture', url: '', createdAt: Date.now(), duration: 6, width: 1280, height: 720, fps: 30, targetFps: 30, format: 'webm', mimeType: 'video/webm', size: blob.size, blobKey: `${id}:video`, webcamBlobKey: webcam ? `${id}:webcam` : null, webcamLayout: webcam ? { size: 25, shape: 'circle', position: 'bottom-right', opacity: 100 } : null, status: 'complete', warnings: [] });
    return id;
  }, { b64, webcam });
}

async function openEditor(env, id) {
  const p = await env.context.newPage();
  await p.goto(env.extUrl(`video-editor.html?id=${id}`));
  await p.waitForFunction(() => window.__editorReady === true, null, { timeout: 30000 });
  return p;
}

async function exportWith(p, opts) {
  await p.evaluate(() => { window.__lastVideoExport = null; });
  await p.evaluate((o) => window.__editor.runExport({ format: 'webm', resolution: 'source', fps: 'source', quality: 'high', audio: true, name: 'test', ...o }), opts);
  await p.waitForFunction(() => window.__lastVideoExport, null, { timeout: 180000 });
  const r = await p.evaluate(() => window.__lastVideoExport);
  if (r.error) throw new Error(r.error);
  return r;
}

const isRed = (c) => c[0] > 180 && c[1] < 70 && c[2] < 70;
const isGreen = (c) => c[1] > 180 && c[0] < 70 && c[2] < 70;
const isBlue = (c) => c[2] > 180 && c[0] < 70 && c[1] < 70;

export const tests = [
  ['no edits: original file is exported unchanged (no re-encode)', async (env) => {
    const id = await importFixture(env);
    const p = await openEditor(env, id);
    const r = await exportWith(p, {});
    assert.equal(r.copied, true);
    assert.equal(r.size, fs.statSync(FIXTURE).size);
    await p.close();
  }],

  ['split + delete middle clip + trim start/end through the UI', async (env) => {
    const id = await importFixture(env);
    const p = await openEditor(env, id);
    const seekTo = (t) => p.evaluate((t) => window.__editor.seek(t), t);
    await seekTo(2.0); await sleep(300); await p.click('#split');
    await seekTo(4.0); await sleep(300); await p.click('#split');
    // select the middle (green) clip on the timeline and delete it
    assert.equal(await p.locator('#track-video .clip').count(), 3);
    await p.locator('#track-video .clip').nth(1).click(); await p.click('#delete-seg');
    assert.equal(await p.$$eval('#track-video .clip', (e) => e.length), 2);
    // trim beginning at 0.5 s and end 0.5 s before the end (output time)
    await seekTo(0.5); await sleep(300); await p.click('#trim-start');
    const dur = await p.evaluate(() => window.__editor.project.segments.reduce((a, s) => a + (s.end - s.start) / s.speed, 0));
    await seekTo(dur - 0.5); await sleep(300); await p.click('#trim-end');
    const segsOut = await p.evaluate(() => window.__editor.project.segments.map((s) => [s.start, s.end]));
    assert.equal(segsOut.length, 2);
    assert.ok(Math.abs(segsOut[0][0] - 0.5) < 0.05 && Math.abs(segsOut[0][1] - 2) < 0.05, JSON.stringify(segsOut));
    assert.ok(Math.abs(segsOut[1][0] - 4) < 0.05 && Math.abs(segsOut[1][1] - 5.5) < 0.1, JSON.stringify(segsOut));
    // undo / redo round trip
    await p.click('#undo'); assert.ok((await p.evaluate(() => window.__editor.project.segments[1].end)) > 5.9);
    await p.click('#redo'); assert.ok((await p.evaluate(() => window.__editor.project.segments[1].end)) < 5.6);
    const r = await exportWith(p, {});
    const f = await dumpBlob(env, `${r.itemId}:video`);
    const pr = probe(f);
    assert.ok(Math.abs(pr.duration - 3.0) < 0.15, `duration ${pr.duration}`);
    let green = 0; const seen = [];
    for (let t = 0.05; t < pr.duration - 0.05; t += 0.2) { const c = frameAt(f, t, 320).px(160, 90); if (isGreen(c)) green++; seen.push(isRed(c) ? 'R' : isBlue(c) ? 'B' : isGreen(c) ? 'G' : '?'); }
    assert.equal(green, 0, `deleted green segment must not appear: ${seen.join('')}`);
    assert.match(seen.join(''), /^R+B+$/, seen.join(''));
    // original untouched
    const orig = await getItemById(env, id);
    const of = await dumpBlob(env, orig.blobKey);
    assert.equal(fs.statSync(of).size, fs.statSync(FIXTURE).size);
    await p.close();
  }],

  ['crop + rotate + text + solid redaction + rectangle + volume are in the exported file', async (env) => {
    const id = await importFixture(env);
    const p = await openEditor(env, id);
    await p.evaluate(() => {
      const pr = window.__editor.project;
      window.__editor.project = {
        ...pr,
        crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, rotation: 90, volume: 0.5,
        overlays: [
          { id: 'b', type: 'blur', mode: 'solid', color: '#0000ff', x: 0.5, y: 0.5, w: 0.3, h: 0.2, start: 0, end: 6 },
          { id: 'r', type: 'rect', color: '#ffff00', width: 30, fill: true, x: 0.1, y: 0.8, w: 0.3, h: 0.1, start: 0, end: 6 },
          { id: 't', type: 'text', text: 'HELLO', color: '#ffffff', fontSize: 80, x: 0.05, y: 0.05, w: 0, h: 0, start: 0, end: 6 },
        ],
      };
    });
    const r = await exportWith(p, {});
    const f = await dumpBlob(env, `${r.itemId}:video`);
    const pr = probe(f);
    // crop 640x360 then rotate 90° -> 360x640
    assert.equal(pr.v.width, 360); assert.equal(pr.v.height, 640);
    const fr = frameAt(f, 1.0);
    assert.ok(isBlue(fr.px(360 * 0.65, 640 * 0.6)), `redaction box ${fr.px(360 * 0.65, 640 * 0.6)}`);
    // rectangle outline (yellow stroke on its top edge) and its 25 % fill (yellow over red = orange)
    const edge = fr.px(360 * 0.25, 640 * 0.8); assert.ok(edge[0] > 180 && edge[1] > 180 && edge[2] < 120, `yellow rectangle outline ${edge}`);
    const fill = fr.px(360 * 0.25, 640 * 0.85); assert.ok(fill[0] > 200 && fill[1] > 40 && fill[1] < 110, `translucent fill ${fill}`);
    // the white 64px square was at the source top-left; after 90° rotation it is at the top-right
    const sq = fr.px(360 - 10, 10); assert.ok(sq.every((v) => v > 200), `rotated corner marker ${sq}`);
    const vSrc = volumeDb(FIXTURE); const vOut = volumeDb(f);
    assert.ok(vSrc.max - vOut.max > 4.5 && vSrc.max - vOut.max < 7.5, `volume 50% => about -6 dB (src ${vSrc.max}, out ${vOut.max})`);
    await p.close();
  }],

  ['2× speed halves the duration; 480p resize; mute removes audio', async (env) => {
    const id = await importFixture(env);
    const p = await openEditor(env, id);
    await p.evaluate(() => { const pr = window.__editor.project; window.__editor.project = { ...pr, segments: [{ ...pr.segments[0], speed: 2 }], muted: true }; });
    const r = await exportWith(p, { resolution: '480' });
    const pr = probe(await dumpBlob(env, `${r.itemId}:video`));
    assert.ok(Math.abs(pr.duration - 3) < 0.15, `duration ${pr.duration}`);
    assert.equal(pr.v.height, 480); assert.equal(pr.v.width, 854);
    assert.equal(pr.a, undefined, 'muted export has no audio track');
    await p.close();
  }],

  ['fade in/out darkens the first and last frames', async (env) => {
    const id = await importFixture(env);
    const p = await openEditor(env, id);
    await p.evaluate(() => { const pr = window.__editor.project; window.__editor.project = { ...pr, fadeIn: 1, fadeOut: 1 }; });
    const r = await exportWith(p, {});
    const f = await dumpBlob(env, `${r.itemId}:video`);
    const start = frameAt(f, 0.02, 320).px(160, 90); const mid = frameAt(f, 1.5, 320).px(160, 90);
    assert.ok(start[0] < 60 && mid[0] > 180, `fade-in start ${start} mid ${mid}`);
    await p.close();
  }],

  ['MP4 export is a real H.264 encode (not a renamed WebM)', async (env) => {
    const id = await importFixture(env);
    const p = await openEditor(env, id);
    await p.evaluate(() => { const pr = window.__editor.project; window.__editor.project = { ...pr, overlays: [{ id: 't', type: 'text', text: 'MP4', color: '#fff', fontSize: 60, x: 0.1, y: 0.1, w: 0, h: 0, start: 0, end: 6 }] }; });
    const r = await exportWith(p, { format: 'mp4' });
    const f = await dumpBlob(env, `${r.itemId}:video`, 'mp4');
    const pr = probe(f);
    assert.equal(pr.format.format_name.includes('mp4'), true, pr.format.format_name);
    assert.equal(pr.v.codec_name, 'h264');
    assert.ok(['aac', 'opus'].includes(pr.a.codec_name), pr.a.codec_name);
    assert.ok(pr.frames >= 170, `frames ${pr.frames}`);
    console.log(`      MP4: ${pr.v.codec_name} + ${pr.a.codec_name}${r.warnings?.length ? ` (${r.warnings.join(' ')})` : ''}`);
    await p.close();
  }],

  ['separate webcam track is composited at the chosen position on export', async (env) => {
    const id = await importFixture(env, { webcam: true });
    const p = await openEditor(env, id);
    assert.equal(await p.$$eval('#track-webcam', (e) => e.length), 1, 'webcam track shown on the timeline');
    await p.evaluate(() => { const pr = window.__editor.project; window.__editor.project = { ...pr, webcam: { ...pr.webcam, visible: true, position: 'top-left', size: 25, shape: 'rect' } }; });
    const r = await exportWith(p, {});
    const f = await dumpBlob(env, `${r.itemId}:video`);
    // at t=3 s the main video is green; the webcam (same fixture, mirrored) is also green, but its
    // white border marks the overlay rectangle at the top-left
    const fr = frameAt(f, 3.0);
    const w = Math.round(1280 * 0.25); const m = Math.round(720 * 0.03);
    const border = fr.px(m + w / 2, m + 1);
    assert.ok(border.every((v) => v > 200), `webcam border ${border}`);
    await p.close();
  }],

  ['exported recording reopens in the editor', async (env) => {
    const id = await importFixture(env);
    const p = await openEditor(env, id);
    await p.evaluate(() => { const pr = window.__editor.project; window.__editor.project = { ...pr, rotation: 180 }; });
    const r = await exportWith(p, {});
    await p.close();
    const p2 = await openEditor(env, r.itemId);
    const info = await p2.evaluate(() => ({ dur: window.__editor.project.duration, title: document.title }));
    assert.ok(Math.abs(info.dur - 6) < 0.2, JSON.stringify(info));
    const item = await getItemById(env, r.itemId);
    assert.equal(item.parentId, id);
    await p2.close();
  }],
];
