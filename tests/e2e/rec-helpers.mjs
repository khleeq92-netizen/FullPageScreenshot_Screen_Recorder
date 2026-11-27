import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IDB_HELPERS, sendMsg, tabIdOf } from './harness.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function recState(env) {
  return (await env.ctrl.evaluate(() => chrome.storage.session.get('recState'))).recState;
}

export async function waitRec(env, pred, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await recState(env); if (s && pred(s)) return s; await sleep(200); }
  throw new Error(`recording state condition not met; last: ${JSON.stringify(await recState(env))}`);
}

export async function startRec(env, { source = 'tab', tabId, config = {} }) {
  return sendMsg(env.ctrl, { type: 'rec:start', source, tabId, config: { countdown: 0, openEditorAfterRecording: false, ...config } });
}

/** Export an item's blob (or any blob key) from IndexedDB to a temp file and return its path. */
export async function dumpBlob(env, key, ext = 'webm') {
  const b64 = await env.ctrl.evaluate(async ({ key, h }) => {
    eval(h); const r = await __get('blobs', key); if (!r) return null;
    const buf = new Uint8Array(await r.blob.arrayBuffer()); let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }, { key, h: IDB_HELPERS });
  if (!b64) throw new Error(`blob ${key} not found`);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fphd-v-')), `out.${ext}`);
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  return f;
}

export async function getItemById(env, id) {
  return env.ctrl.evaluate(async ({ id, h }) => { eval(h); return __get('items', id); }, { id, h: IDB_HELPERS });
}

export function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const v = j.streams.find((s) => s.codec_type === 'video'); const a = j.streams.find((s) => s.codec_type === 'audio');
  // decode the whole file to verify it is playable and count frames / real duration
  const dec = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
  return { format: j.format, v, a, duration: Number(j.format.duration), frames: Number(dec) };
}

export function volumeDb(file, extra = []) {
  const res = execFileSync('bash', ['-c', `ffmpeg -hide_banner -i "${file}" ${extra.join(' ')} -af volumedetect -vn -f null - 2>&1 | grep -E "mean_volume|max_volume"`], { encoding: 'utf8' });
  const mean = Number((res.match(/mean_volume:\s*(-?[\d.]+|-inf)/) || [])[1]);
  const max = Number((res.match(/max_volume:\s*(-?[\d.]+|-inf)/) || [])[1]);
  return { mean, max };
}

/** Grab a frame at time t (seconds) as raw RGB via ffmpeg; returns {w,h,px(x,y)}. */
export function frameAt(file, t, scaleW = 0) {
  const vf = scaleW ? ['-vf', `scale=${scaleW}:-2`] : [];
  const info = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
  let [w, h] = info;
  if (scaleW) { h = Math.round((h * scaleW) / w / 2) * 2; w = scaleW; }
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', ...vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  return { w, h, px: (x, y) => { const o = (Math.round(y) * w + Math.round(x)) * 3; return [buf[o], buf[o + 1], buf[o + 2]]; } };
}

export { tabIdOf, sendMsg };
