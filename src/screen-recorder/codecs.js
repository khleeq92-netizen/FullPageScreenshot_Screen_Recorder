// Recording format helpers.
export const RESOLUTIONS = {
  '720': [1280, 720], '1080': [1920, 1080], '1440': [2560, 1440], '2160': [3840, 2160], source: [7680, 4320],
};

const CANDIDATES = {
  vp9: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9'],
  vp8: ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8'],
  av1: ['video/webm;codecs=av01,opus', 'video/webm;codecs=av1,opus'],
  h264: ['video/webm;codecs=h264,opus', 'video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2'],
};

export function pickMimeType(codec, hasAudio) {
  const order = [codec, 'vp9', 'vp8'].filter((c, i, a) => c && a.indexOf(c) === i);
  for (const c of order) {
    for (let m of CANDIDATES[c] || []) {
      if (!hasAudio) m = m.replace(/,(opus|mp4a[^;]*)$/, '');
      if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, codec: c, fallback: c !== codec };
    }
  }
  if (MediaRecorder.isTypeSupported('video/webm')) return { mimeType: 'video/webm', codec: 'default', fallback: true };
  throw new Error('This browser cannot record video with MediaRecorder.');
}

/** Bits per pixel per frame for each quality preset (1080p30: 5 / 10 / 25 Mbps). */
const BPP = { standard: 0.08, high: 0.16, max: 0.4 };

export function videoBitrate({ width, height, fps, quality, customMbps }) {
  if (quality === 'custom') return Math.round(Math.max(0.5, Number(customMbps) || 8) * 1e6);
  const bpp = BPP[quality] || BPP.high;
  return Math.round(Math.min(120e6, Math.max(1e6, width * height * Math.max(15, fps) * bpp)));
}

export function audioBitrate(quality) {
  return quality === 'max' ? 256000 : quality === 'standard' ? 128000 : 192000;
}
