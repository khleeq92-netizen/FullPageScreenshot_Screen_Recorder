// Video export worker: decodes the source with WebCodecs (via mediabunny), renders every output frame
// with the same renderer as the editor preview, mixes/edits audio, and re-encodes to WebM (VP9/Opus)
// or MP4 (H.264 + AAC, Opus fallback) – a real transcode, never a renamed container.
// Output is streamed to a temporary file in the origin-private file system to keep memory bounded.
import {
  Input, Output, BlobSource, ALL_FORMATS, CanvasSink, AudioSampleSink, CanvasSource, AudioSampleSource, AudioSample,
  Mp4OutputFormat, WebMOutputFormat, StreamTarget, BufferTarget, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
} from 'mediabunny';
import { outToSrc, outputDuration, gainAt, segmentOutRanges } from '../video-editor/project.js';
import { renderFrame } from '../video-editor/render-frame.js';

let cancelled = false;

async function openTarget(name) {
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    return { target: new StreamTarget(writable, { chunked: true }), finish: async () => handle.getFile(), cleanup: async () => { try { await root.removeEntry(name); } catch { /* ignore */ } }, writable };
  } catch {
    const t = new BufferTarget();
    return { target: t, finish: async () => new Blob([t.buffer]), cleanup: async () => {} };
  }
}

async function run(job, post) {
  const { project: p, source, webcam, opts } = job;
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const vTrack = await input.getPrimaryVideoTrack();
  if (!vTrack) throw new Error('The source has no video track');
  if (!(await vTrack.canDecode())) throw new Error(`This browser cannot decode the source video codec (${vTrack.codec}).`);
  const aTrack = opts.audio ? await input.getPrimaryAudioTrack() : null;
  const srcW = vTrack.displayWidth; const srcH = vTrack.displayHeight;
  const outW = opts.width; const outH = opts.height; const fps = opts.fps;
  const dur = outputDuration(p);

  let camInput = null; let camTrack = null; let camSink = null;
  if (webcam && p.webcam?.visible) {
    camInput = new Input({ source: new BlobSource(webcam), formats: ALL_FORMATS });
    camTrack = await camInput.getPrimaryVideoTrack();
    if (camTrack) camSink = new CanvasSink(camTrack, { width: 640, poolSize: 3 });
  }

  const isMp4 = opts.format === 'mp4';
  const vCodec = await getFirstEncodableVideoCodec(isMp4 ? ['avc', 'hevc', 'vp9'] : ['vp9', 'vp8', 'av1'], { width: outW, height: outH, bitrate: opts.videoBitrate });
  if (!vCodec) throw new Error(`No ${isMp4 ? 'MP4' : 'WebM'} video encoder is available in this browser at ${outW}×${outH}.`);
  let aCodec = null;
  if (aTrack) {
    aCodec = await getFirstEncodableAudioCodec(isMp4 ? ['aac', 'opus'] : ['opus', 'vorbis'], { numberOfChannels: Math.min(2, aTrack.numberOfChannels), sampleRate: aTrack.sampleRate });
  }
  const warnings = [];
  if (isMp4 && vCodec !== 'avc') warnings.push(`H.264 encoding is not available; the MP4 uses ${vCodec.toUpperCase()}.`);
  if (isMp4 && aCodec === 'opus') warnings.push('AAC encoding is not available in this Chrome build, so the MP4 audio is Opus (plays in Chrome, Firefox, VLC; some older players may not support it).');
  if (aTrack && !aCodec) warnings.push('No audio encoder is available – the export has no audio.');

  const tmpName = `tmp-export-${Date.now()}.${isMp4 ? 'mp4' : 'webm'}`;
  const tgt = await openTarget(tmpName);
  const output = new Output({ format: isMp4 ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(), target: tgt.target });
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d', { alpha: false });
  const scratch = new OffscreenCanvas(1, 1);
  const videoSource = new CanvasSource(canvas, { codec: vCodec, bitrate: opts.videoBitrate, keyFrameInterval: 2, latencyMode: 'quality' });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource = null;
  const channels = aTrack ? Math.min(2, aTrack.numberOfChannels) : 0;
  const rate = aTrack?.sampleRate || 48000;
  if (aCodec) { audioSource = new AudioSampleSource({ codec: aCodec, bitrate: opts.audioBitrate }); output.addAudioTrack(audioSource); }
  await output.start();

  const totalFrames = Math.max(1, Math.round(dur * fps));
  let framesDone = 0; let audioDone = 0;
  const report = () => post({ type: 'progress', progress: Math.min(0.995, (framesDone / totalFrames) * (aCodec ? 0.85 : 1) + (aCodec ? (audioDone / Math.max(0.001, dur)) * 0.15 : 0)) });

  async function videoLoop() {
    const sink = new CanvasSink(vTrack, { poolSize: 3 });
    const srcTimes = (function* () { for (let i = 0; i < totalFrames; i++) yield outToSrc(p, i / fps).src; })();
    const camTimes = camSink ? (function* () { for (let i = 0; i < totalFrames; i++) yield Math.max(0, outToSrc(p, i / fps).src + (p.webcam.offset || 0)); })() : null;
    const camIter = camSink ? camSink.canvasesAtTimestamps(camTimes) : null;
    let first = 0;
    try { first = await vTrack.getFirstTimestamp(); } catch { first = 0; }
    let i = 0;
    let last = null;
    for await (const wrapped of sink.canvasesAtTimestamps((function* () { for (const t of srcTimes) yield Math.max(first, t); })())) {
      if (cancelled) throw new Error('Export cancelled');
      const t = i / fps;
      const frame = wrapped?.canvas || last;
      if (wrapped) last = wrapped.canvas;
      let cam = null;
      if (camIter) { const r = await camIter.next(); cam = r.value?.canvas || null; }
      renderFrame(ctx, frame, srcW, srcH, outW, outH, p, t, dur, { webcamFrame: cam, webcamW: cam?.width, webcamH: cam?.height, scratch });
      await videoSource.add(t, 1 / fps);
      i++; framesDone = i;
      if (i % 10 === 0) report();
    }
    videoSource.close();
  }

  async function audioLoop() {
    if (!audioSource) return;
    const sink = new AudioSampleSink(aTrack);
    const BLOCK = rate; // emit ~1 s blocks
    let outPos = 0; // samples written
    const buf = Array.from({ length: channels }, () => new Float32Array(BLOCK));
    let fill = 0;
    const flush = async (final = false) => {
      if (!fill) return;
      const n = fill;
      const planar = new Float32Array(n * channels);
      for (let c = 0; c < channels; c++) planar.set(buf[c].subarray(0, n), c * n);
      const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: channels, sampleRate: rate, timestamp: (outPos - n) / rate });
      await audioSource.add(sample);
      sample.close();
      fill = 0;
      void final;
    };
    const push = async (chData, n) => {
      let off = 0;
      while (off < n) {
        const k = Math.min(n - off, BLOCK - fill);
        for (let c = 0; c < channels; c++) buf[c].set(chData[c].subarray(off, off + k), fill);
        fill += k; off += k; outPos += k;
        if (fill === BLOCK) await flush();
      }
    };
    const silence = async (n) => {
      const z = Array.from({ length: channels }, () => new Float32Array(Math.min(n, BLOCK)));
      while (n > 0) { const k = Math.min(n, BLOCK); await push(z.map((a) => a.subarray(0, k)), k); n -= k; }
    };
    for (const r of segmentOutRanges(p)) {
      const s = r.seg; const speed = s.speed || 1;
      const segOutSamples = Math.round((r.end - r.start) * rate);
      const segStartSample = Math.round(r.start * rate);
      if (outPos < segStartSample) await silence(segStartSample - outPos);
      // collect source samples of this segment and resample to output length when speed != 1
      let written = 0; // output samples written for this segment
      let carry = null; // leftover source samples for resampling continuity
      let srcCursor = s.start; // expected next source time
      for await (const sample of sink.samples(s.start, s.end)) {
        if (cancelled) { sample.close(); throw new Error('Export cancelled'); }
        const sr = sample.sampleRate; const nch = sample.numberOfChannels; const nf = sample.numberOfFrames;
        const data = [];
        for (let c = 0; c < channels; c++) {
          const arr = new Float32Array(nf);
          sample.copyTo(arr, { planeIndex: Math.min(c, nch - 1), format: 'f32-planar' });
          data.push(arr);
        }
        const t0 = sample.timestamp; sample.close();
        // crop to [s.start, s.end] and fill gaps
        let startIdx = Math.max(0, Math.round((Math.max(s.start, srcCursor) - t0) * sr));
        if (t0 > srcCursor + 0.02) {
          const gap = Math.round(((t0 - srcCursor) / speed) * rate);
          const k = Math.min(gap, segOutSamples - written);
          if (k > 0) { await silence(k); written += k; }
          startIdx = 0;
        }
        const endIdx = Math.min(nf, Math.round((s.end - t0) * sr));
        if (endIdx <= startIdx) continue;
        srcCursor = t0 + endIdx / sr;
        let chunk = data.map((a) => a.subarray(startIdx, endIdx));
        if (carry) { chunk = chunk.map((a, c) => { const m = new Float32Array(carry[c].length + a.length); m.set(carry[c]); m.set(a, carry[c].length); return m; }); carry = null; }
        let len = chunk[0].length;
        let out = chunk;
        if (speed !== 1 || sr !== rate) {
          const step = (speed * sr) / rate; // source samples per output sample
          const nOut = Math.floor((len - 1) / step);
          out = chunk.map((a) => { const o = new Float32Array(nOut); for (let j = 0; j < nOut; j++) { const pos = j * step; const i0 = pos | 0; const f = pos - i0; o[j] = a[i0] * (1 - f) + a[i0 + 1] * f; } return o; });
          const consumed = Math.round(nOut * step);
          carry = chunk.map((a) => a.slice(consumed));
          len = nOut;
        }
        len = Math.min(len, segOutSamples - written);
        if (len <= 0) break;
        // gain envelope (volume, mute, fades)
        for (let j = 0; j < len; j++) {
          const g = gainAt(p, (outPos + j) / rate, dur);
          for (let c = 0; c < channels; c++) { let v = out[c][j] * g; if (v > 1) v = 1; else if (v < -1) v = -1; out[c][j] = v; }
        }
        await push(out, len);
        written += len;
        audioDone = outPos / rate;
        report();
      }
      if (written < segOutSamples) await silence(segOutSamples - written);
    }
    await flush(true);
    audioSource.close();
  }

  try {
    await Promise.all([videoLoop(), audioLoop()]);
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    await tgt.cleanup();
    throw e;
  } finally {
    input.dispose?.(); camInput?.dispose?.();
  }
  const file = await tgt.finish();
  // Copy into a Blob owned by the page (the OPFS temp file is removed afterwards by the page).
  return { file, tmpName, mimeType: isMp4 ? 'video/mp4' : 'video/webm', vCodec, aCodec, warnings, width: outW, height: outH, fps, duration: dur, frames: totalFrames };
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'cancel') { cancelled = true; return; }
  if (m.type !== 'export') return;
  cancelled = false;
  const post = (msg) => self.postMessage(msg);
  try {
    const res = await run(m, post);
    post({ type: 'done', ...res });
  } catch (err) {
    post({ type: 'error', message: String(err?.message || err) });
  }
};
