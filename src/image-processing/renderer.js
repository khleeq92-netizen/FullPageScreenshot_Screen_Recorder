// Screenshot edit renderer – shared by the editor page (previews) and the export worker (final output).
//
// The original capture (lossless PNG segments) is never modified. An edit document describes
// annotations (in original-image pixel coordinates), an optional crop rectangle and a rotation.
// Output pixels are produced region-by-region, so arbitrarily tall images can be exported at
// full resolution without ever allocating a canvas larger than the browser allows.

export function cropRect(doc, srcW, srcH) {
  const c = doc?.crop;
  if (!c) return { x: 0, y: 0, w: srcW, h: srcH };
  const x = Math.max(0, Math.min(srcW - 1, Math.round(c.x)));
  const y = Math.max(0, Math.min(srcH - 1, Math.round(c.y)));
  const w = Math.max(1, Math.min(srcW - x, Math.round(c.w)));
  const h = Math.max(1, Math.min(srcH - y, Math.round(c.h)));
  return { x, y, w, h };
}

export function outputSize(doc, srcW, srcH) {
  const c = cropRect(doc, srcW, srcH);
  const r = ((doc?.rotation || 0) % 360 + 360) % 360;
  return r === 90 || r === 270 ? { width: c.h, height: c.w } : { width: c.w, height: c.h };
}

/** Configure ctx so that drawing in source coordinates lands at output region (ox, oy) scaled by s. */
export function applySourceTransform(ctx, doc, srcW, srcH, ox, oy, s = 1) {
  const c = cropRect(doc, srcW, srcH);
  const r = ((doc?.rotation || 0) % 360 + 360) % 360;
  ctx.setTransform(s, 0, 0, s, -ox * s, -oy * s);
  if (r === 90) { ctx.translate(c.h, 0); ctx.rotate(Math.PI / 2); }
  else if (r === 180) { ctx.translate(c.w, c.h); ctx.rotate(Math.PI); }
  else if (r === 270) { ctx.translate(0, c.w); ctx.rotate(-Math.PI / 2); }
  ctx.translate(-c.x, -c.y);
}

/** Map an output-space rectangle to its bounding box in source space. */
export function outputRectToSource(doc, srcW, srcH, x, y, w, h) {
  const c = cropRect(doc, srcW, srcH);
  const r = ((doc?.rotation || 0) % 360 + 360) % 360;
  let sx, sy, sw, sh;
  if (r === 0) { sx = x; sy = y; sw = w; sh = h; }
  else if (r === 180) { sx = c.w - x - w; sy = c.h - y - h; sw = w; sh = h; }
  else if (r === 90) { sx = y; sy = c.h - x - w; sw = h; sh = w; }
  else { sx = c.w - y - h; sy = x; sw = h; sh = w; }
  return { x: sx + c.x, y: sy + c.y, w: sw, h: sh };
}

/** Lazily decodes PNG segments with a small LRU cache to bound memory. */
export class SegmentSource {
  constructor(segments, width, { cacheSize = 3 } = {}) {
    this.segments = segments.slice().sort((a, b) => a.y - b.y); // {blob, y, height}
    this.width = width;
    this.height = this.segments.reduce((m, s) => Math.max(m, s.y + s.height), 0);
    this.cache = new Map();
    this.cacheSize = cacheSize;
  }

  async bitmap(seg) {
    let p = this.cache.get(seg);
    if (p) { this.cache.delete(seg); this.cache.set(seg, p); return p; }
    p = createImageBitmap(seg.blob);
    this.cache.set(seg, p);
    while (this.cache.size > this.cacheSize) {
      const [k, v] = this.cache.entries().next().value;
      this.cache.delete(k);
      v.then((b) => b.close()).catch(() => {});
    }
    return p;
  }

  overlapping(y0, y1) { return this.segments.filter((s) => s.y < y1 && s.y + s.height > y0); }

  async drawRange(ctx, y0, y1) {
    for (const seg of this.overlapping(y0, y1)) {
      const bmp = await this.bitmap(seg);
      ctx.drawImage(bmp, 0, seg.y);
    }
  }

  close() {
    for (const p of this.cache.values()) p.then((b) => b.close()).catch(() => {});
    this.cache.clear();
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/** Pre-render blurred/pixelated patches for blur annotations (from the untouched source). */
export async function buildBlurPatches(src, doc, { scale = 1 } = {}) {
  const patches = new Map();
  for (const a of doc?.annotations || []) {
    if (a.type !== 'blur') continue;
    const x = Math.round(Math.min(a.x1, a.x2)); const y = Math.round(Math.min(a.y1, a.y2));
    const w = Math.round(Math.abs(a.x2 - a.x1)); const h = Math.round(Math.abs(a.y2 - a.y1));
    if (w < 2 || h < 2) continue;
    const strength = Math.max(2, a.strength || 14);
    const m = Math.ceil(strength * 3);
    const px = Math.max(0, x - m); const py = Math.max(0, y - m);
    const pw = Math.min(src.width, x + w + m) - px; const ph = Math.min(src.height, y + h + m) - py;
    const ws = Math.max(1, Math.round(pw * scale)); const hs = Math.max(1, Math.round(ph * scale));
    const base = makeCanvas(ws, hs);
    const bctx = base.getContext('2d');
    bctx.setTransform(scale, 0, 0, scale, -px * scale, -py * scale);
    await src.drawRange(bctx, py, py + ph);
    const out = makeCanvas(ws, hs);
    const octx = out.getContext('2d');
    if (a.mode === 'pixelate') {
      const cell = Math.max(2, strength * scale);
      const tw = Math.max(1, Math.round(ws / cell)); const th = Math.max(1, Math.round(hs / cell));
      const tiny = makeCanvas(tw, th);
      const tctx = tiny.getContext('2d'); tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(base, 0, 0, tw, th);
      octx.imageSmoothingEnabled = false;
      octx.drawImage(tiny, 0, 0, ws, hs);
    } else if (a.mode === 'solid') {
      octx.fillStyle = a.color || '#000'; octx.fillRect(0, 0, ws, hs);
    } else {
      octx.filter = `blur(${strength * scale}px)`;
      octx.drawImage(base, 0, 0);
      octx.filter = 'none';
    }
    patches.set(a.id, { canvas: out, x: px, y: py, w: pw, h: ph, rect: { x, y, w, h } });
  }
  return patches;
}

function arrowHead(ctx, x1, y1, x2, y2, size) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(ang - Math.PI / 7), y2 - size * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(x2 - size * Math.cos(ang + Math.PI / 7), y2 - size * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

/** Draw a single vector annotation (source coordinates). */
export function drawAnnotation(ctx, a, patches) {
  ctx.save();
  const color = a.color || '#ef4444';
  const lw = a.width || 4;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const x = Math.min(a.x1, a.x2); const y = Math.min(a.y1, a.y2);
  const w = Math.abs(a.x2 - a.x1); const h = Math.abs(a.y2 - a.y1);
  switch (a.type) {
    case 'arrow': {
      const head = Math.max(10, lw * 4);
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      ctx.beginPath(); ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x2 - Math.cos(ang) * head * 0.6, a.y2 - Math.sin(ang) * head * 0.6); ctx.stroke();
      arrowHead(ctx, a.x1, a.y1, a.x2, a.y2, head);
      break;
    }
    case 'line':
      ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.x2, a.y2); ctx.stroke(); break;
    case 'rect':
      if (a.fill) { ctx.globalAlpha = 0.25; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
      ctx.strokeRect(x, y, w, h); break;
    case 'ellipse':
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      if (a.fill) { ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.stroke(); break;
    case 'highlight':
      ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = a.color || '#facc15'; ctx.fillRect(x, y, w, h); break;
    case 'pen': {
      const pts = a.points || [];
      if (pts.length < 2) break;
      if (a.highlighter) { ctx.globalAlpha = 0.4; ctx.globalCompositeOperation = 'multiply'; }
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke(); break;
    }
    case 'text': {
      const size = a.fontSize || 32;
      ctx.font = `${a.bold === false ? 400 : 700} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textBaseline = 'top';
      const lines = String(a.text || '').split('\n');
      const lh = size * 1.25;
      if (a.background) {
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
        ctx.fillStyle = a.background; ctx.fillRect(a.x1 - size * 0.3, a.y1 - size * 0.2, tw + size * 0.6, lines.length * lh + size * 0.3);
        ctx.fillStyle = color;
      }
      lines.forEach((l, i) => ctx.fillText(l, a.x1, a.y1 + i * lh));
      break;
    }
    case 'blur': {
      const p = patches?.get(a.id);
      if (p) {
        ctx.beginPath(); ctx.rect(p.rect.x, p.rect.y, p.rect.w, p.rect.h); ctx.clip();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(p.canvas, p.x, p.y, p.w, p.h);
      }
      break;
    }
    default: break;
  }
  ctx.restore();
}

/**
 * Render an output-space region into ctx (which must be sized region.w*scale x region.h*scale).
 */
export async function renderRegion(ctx, src, doc, region, { scale = 1, patches = null, background = '#ffffff' } = {}) {
  const { x, y, w, h } = region;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, Math.ceil(w * scale), Math.ceil(h * scale));
  applySourceTransform(ctx, doc, src.width, src.height, x, y, scale);
  const sb = outputRectToSource(doc, src.width, src.height, x, y, w, h);
  // Pixel-exact copy at 1:1 (rotation by multiples of 90° keeps pixels intact)
  ctx.imageSmoothingEnabled = scale !== 1;
  ctx.imageSmoothingQuality = 'high';
  await src.drawRange(ctx, sb.y, sb.y + sb.h);
  for (const a of doc?.annotations || []) {
    if (a.hidden) continue;
    drawAnnotation(ctx, a, patches);
  }
  ctx.restore();
}

/** Find a "quiet" row (uniform colour) near `target` searching upwards – used for smart page breaks. */
export function findQuietRow(imageData, fromRow, toRow) {
  const { data, width } = imageData;
  const step = Math.max(1, Math.floor(width / 400));
  for (let r = toRow; r >= fromRow; r--) {
    const o = r * width * 4;
    const r0 = data[o], g0 = data[o + 1], b0 = data[o + 2];
    let ok = true;
    for (let x = 0; x < width; x += step) {
      const p = o + x * 4;
      if (Math.abs(data[p] - r0) > 10 || Math.abs(data[p + 1] - g0) > 10 || Math.abs(data[p + 2] - b0) > 10) { ok = false; break; }
    }
    if (ok) return r;
  }
  return -1;
}
