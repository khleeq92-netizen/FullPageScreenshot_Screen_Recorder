// Thumbnails and audio waveform peaks for the timeline (decoded locally with WebCodecs via mediabunny).
import { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioSampleSink } from 'mediabunny';

export async function makeThumbnails(blob, duration, count = 30, height = 32) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return [];
    const first = await vt.getFirstTimestamp().catch(() => 0);
    const w = Math.round((vt.displayWidth / vt.displayHeight) * height);
    const sink = new CanvasSink(vt, { width: w * 2, height: height * 2, fit: 'contain' });
    const times = Array.from({ length: count }, (_, i) => first + (duration * (i + 0.5)) / count);
    const out = [];
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      const t = times[i++];
      if (!wc) continue;
      const c = wc.canvas;
      const blobOut = c.convertToBlob ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }) : await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
      out.push({ t, url: URL.createObjectURL(blobOut), w });
    }
    return out;
  } finally { input.dispose?.(); }
}

/** Peak amplitude per `bucket` seconds across the whole source. */
export async function computePeaks(blob, duration, bucket = 0.05, onPartial) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const at = await input.getPrimaryAudioTrack();
    if (!at || !(await at.canDecode())) return null;
    const n = Math.ceil(duration / bucket) + 1;
    const peaks = new Float32Array(n);
    const sink = new AudioSampleSink(at);
    let tmp = new Float32Array(0); let k = 0;
    for await (const s of sink.samples()) {
      const nf = s.numberOfFrames; const sr = s.sampleRate;
      if (tmp.length < nf) tmp = new Float32Array(nf);
      s.copyTo(tmp, { planeIndex: 0, format: 'f32-planar' });
      const t0 = s.timestamp; s.close();
      for (let i = 0; i < nf; i += 4) {
        const b = Math.floor((t0 + i / sr) / bucket);
        if (b >= 0 && b < n) { const v = Math.abs(tmp[i]); if (v > peaks[b]) peaks[b] = v; }
      }
      if (++k % 50 === 0) onPartial?.(peaks);
    }
    return { peaks, bucket };
  } finally { input.dispose?.(); }
}

export async function probe(blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    let fps = null;
    if (vt) { try { const st = await vt.computePacketStats(300); fps = st.averagePacketRate; } catch { /* ignore */ } }
    return {
      duration, width: vt?.displayWidth, height: vt?.displayHeight, videoCodec: vt?.codec, audioCodec: at?.codec || null,
      channels: at?.numberOfChannels || 0, sampleRate: at?.sampleRate || 0, fps, canDecode: vt ? await vt.canDecode() : false,
      format: (await input.getFormat()).name,
    };
  } finally { input.dispose?.(); }
}
