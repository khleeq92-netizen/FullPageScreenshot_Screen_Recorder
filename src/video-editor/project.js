// Video edit project: an edit decision list over the untouched source recording.
//   segments  – kept source ranges in order (seconds) with per-segment speed
//   overlays  – text / shapes / highlights / blur regions with output-time ranges and
//               coordinates normalised to the output frame (resolution independent)
//   crop      – normalised source rectangle, rotation – 0/90/180/270
//   audio     – volume (0..2), mute, fade in/out (seconds)
//   webcam    – layout of a separately recorded webcam track (when present)

export function newProject(duration, item) {
  return {
    version: 1,
    duration,
    segments: [{ id: rid(), start: 0, end: duration, speed: 1 }],
    overlays: [],
    crop: null,
    rotation: 0,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    webcam: item?.webcamBlobKey ? { visible: true, offset: 0, ...(item.webcamLayout || {}), size: item.webcamLayout?.size ?? 22, shape: item.webcamLayout?.shape ?? 'circle', position: item.webcamLayout?.position ?? 'bottom-right', opacity: item.webcamLayout?.opacity ?? 100 } : null,
  };
}

export const rid = () => Math.random().toString(36).slice(2, 10);

export function outputDuration(p) {
  return p.segments.reduce((a, s) => a + (s.end - s.start) / (s.speed || 1), 0);
}

/** Map output time -> {src, seg, index}. */
export function outToSrc(p, t) {
  let acc = 0;
  for (let i = 0; i < p.segments.length; i++) {
    const s = p.segments[i]; const d = (s.end - s.start) / s.speed;
    if (t < acc + d || i === p.segments.length - 1) {
      const local = Math.max(0, Math.min(d, t - acc));
      return { src: Math.min(s.end, s.start + local * s.speed), seg: s, index: i, segOutStart: acc };
    }
    acc += d;
  }
  return { src: 0, seg: p.segments[0], index: 0, segOutStart: 0 };
}

/** Map a source time to output time (null if the source time was cut). */
export function srcToOut(p, src) {
  let acc = 0;
  for (const s of p.segments) {
    if (src >= s.start - 1e-6 && src <= s.end + 1e-6) return acc + (Math.min(src, s.end) - s.start) / s.speed;
    acc += (s.end - s.start) / s.speed;
  }
  return null;
}

export function segmentOutRanges(p) {
  let acc = 0;
  return p.segments.map((s) => { const d = (s.end - s.start) / s.speed; const r = { seg: s, start: acc, end: acc + d }; acc += d; return r; });
}

/** Split the segment under output time t. Returns true if split. */
export function splitAt(p, t, minLen = 0.05) {
  const { src, index, seg } = outToSrc(p, t);
  if (src - seg.start < minLen || seg.end - src < minLen) return false;
  const a = { ...seg, end: src }; const b = { ...seg, id: rid(), start: src };
  p.segments.splice(index, 1, a, b);
  return true;
}

export function deleteSegment(p, id) {
  if (p.segments.length <= 1) return false;
  const i = p.segments.findIndex((s) => s.id === id);
  if (i < 0) return false;
  const r = segmentOutRanges(p)[i];
  const removed = r.end - r.start;
  p.segments.splice(i, 1);
  // shift overlays after the removed range, clip ones inside it
  p.overlays = p.overlays.map((o) => {
    if (o.start >= r.end) return { ...o, start: o.start - removed, end: o.end - removed };
    if (o.end <= r.start) return o;
    const ns = Math.min(o.start, r.start); const ne = Math.max(r.start, o.end - removed);
    return { ...o, start: ns, end: Math.max(ns + 0.1, ne) };
  }).filter((o) => o.end > o.start);
  return true;
}

/** Trim the beginning: drop source before output time t. */
export function trimStartAt(p, t) {
  const { src, index } = outToSrc(p, t);
  const removedOut = t;
  p.segments = p.segments.slice(index);
  p.segments[0] = { ...p.segments[0], start: Math.min(src, p.segments[0].end - 0.05) };
  p.overlays = p.overlays.map((o) => ({ ...o, start: Math.max(0, o.start - removedOut), end: o.end - removedOut })).filter((o) => o.end > 0.05);
}

/** Trim the ending: drop source after output time t. */
export function trimEndAt(p, t) {
  const { src, index } = outToSrc(p, t);
  p.segments = p.segments.slice(0, index + 1);
  const last = p.segments[p.segments.length - 1];
  p.segments[p.segments.length - 1] = { ...last, end: Math.max(src, last.start + 0.05) };
  const dur = outputDuration(p);
  p.overlays = p.overlays.filter((o) => o.start < dur).map((o) => ({ ...o, end: Math.min(o.end, dur) }));
}

/** Source-space crop rect in pixels. */
export function cropPx(p, srcW, srcH) {
  const c = p.crop;
  if (!c) return { x: 0, y: 0, w: srcW, h: srcH };
  const x = Math.round(c.x * srcW); const y = Math.round(c.y * srcH);
  return { x, y, w: Math.max(2, Math.round(c.w * srcW)), h: Math.max(2, Math.round(c.h * srcH)) };
}

/** Natural output size (after crop + rotation, before scaling). */
export function naturalOutputSize(p, srcW, srcH) {
  const c = cropPx(p, srcW, srcH);
  const r = ((p.rotation || 0) % 360 + 360) % 360;
  return r === 90 || r === 270 ? { width: c.h, height: c.w } : { width: c.w, height: c.h };
}

/** Fit natural size into a target height (never upscaling) with even dimensions (codec requirement). */
export function scaledOutputSize(p, srcW, srcH, target) {
  const n = naturalOutputSize(p, srcW, srcH);
  let w = n.width; let h = n.height;
  if (target && target !== 'source') {
    const th = Number(target);
    const short = Math.min(w, h);
    if (th < short) { const k = th / short; w *= k; h *= k; }
  }
  return { width: Math.max(2, Math.round(w / 2) * 2), height: Math.max(2, Math.round(h / 2) * 2) };
}

export function isIdentity(p) {
  return p.segments.length === 1 && p.segments[0].start <= 0.001 && p.segments[0].end >= p.duration - 0.001 && p.segments[0].speed === 1
    && !p.crop && !p.rotation && !p.overlays.length && p.volume === 1 && !p.muted && !p.fadeIn && !p.fadeOut && !(p.webcam?.visible);
}

export function gainAt(p, tOut, dur) {
  if (p.muted) return 0;
  let g = p.volume;
  if (p.fadeIn > 0 && tOut < p.fadeIn) g *= Math.max(0, tOut / p.fadeIn);
  if (p.fadeOut > 0 && tOut > dur - p.fadeOut) g *= Math.max(0, (dur - tOut) / p.fadeOut);
  return g;
}

export function fadeAlpha(p, tOut, dur) {
  let a = 1;
  if (p.fadeIn > 0 && tOut < p.fadeIn) a = Math.min(a, tOut / p.fadeIn);
  if (p.fadeOut > 0 && tOut > dur - p.fadeOut) a = Math.min(a, (dur - tOut) / p.fadeOut);
  return Math.max(0, Math.min(1, a));
}
