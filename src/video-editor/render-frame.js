// Frame renderer shared by the editor preview and the exporter (WYSIWYG).
import { cropPx, fadeAlpha } from './project.js';
import { webcamRect, drawWebcam } from '../webcam/webcam-layout.js';

/**
 * Draw a fully edited output frame.
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx  sized outW x outH
 * @param {CanvasImageSource} frame source frame
 */
export function renderFrame(ctx, frame, srcW, srcH, outW, outH, p, tOut, dur, { webcamFrame = null, webcamW = 0, webcamH = 0, scratch = null, selectedId = null } = {}) {
  const c = cropPx(p, srcW, srcH);
  const r = ((p.rotation || 0) % 360 + 360) % 360;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  // map crop rect -> output with rotation
  const rot = r === 90 || r === 270;
  const sx = outW / (rot ? c.h : c.w); const sy = outH / (rot ? c.w : c.h);
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.scale(sx, sy);
  if (frame) ctx.drawImage(frame, c.x, c.y, c.w, c.h, -c.w / 2, -c.h / 2, c.w, c.h);
  ctx.restore();

  if (p.webcam?.visible && webcamFrame && webcamW) {
    const rect = webcamRect(outW, outH, { ...p.webcam, camAspect: webcamW / webcamH });
    drawWebcam(ctx, webcamFrame, webcamW, webcamH, rect, { opacity: (p.webcam.opacity ?? 100) / 100, mirror: true });
  }

  for (const o of p.overlays) {
    if (tOut < o.start || tOut > o.end) continue;
    drawOverlay(ctx, o, outW, outH, scratch, o.id === selectedId);
  }

  const a = fadeAlpha(p, tOut, dur);
  if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - a})`; ctx.fillRect(0, 0, outW, outH); }
}

export function drawOverlay(ctx, o, W, H, scratch, selected) {
  const u = H / 1000; // stroke widths & font sizes are expressed per 1000 px of output height
  const x = o.x * W; const y = o.y * H; const w = o.w * W; const hh = o.h * H;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = o.color || '#ef4444'; ctx.fillStyle = o.color || '#ef4444';
  ctx.lineWidth = Math.max(1, (o.width || 6) * u);
  switch (o.type) {
    case 'text': {
      const size = Math.max(6, (o.fontSize || 60) * u);
      ctx.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textBaseline = 'top';
      const lines = String(o.text || '').split('\n');
      if (o.background) {
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
        ctx.fillStyle = o.background; ctx.fillRect(x - size * 0.3, y - size * 0.2, tw + size * 0.6, lines.length * size * 1.25 + size * 0.3);
        ctx.fillStyle = o.color || '#fff';
      } else {
        ctx.lineWidth = Math.max(2, size / 7); ctx.strokeStyle = 'rgba(0,0,0,.65)';
        lines.forEach((l, i) => ctx.strokeText(l, x, y + i * size * 1.25));
      }
      lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.25));
      break;
    }
    case 'arrow': {
      const x1 = o.x1 * W, y1 = o.y1 * H, x2 = o.x2 * W, y2 = o.y2 * H;
      const head = Math.max(10, ctx.lineWidth * 4); const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(ang) * head * 0.6, y2 - Math.sin(ang) * head * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 7), y2 - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 7), y2 - head * Math.sin(ang + Math.PI / 7)); ctx.closePath(); ctx.fill();
      break;
    }
    case 'rect':
      if (o.fill) { ctx.globalAlpha = 0.25; ctx.fillRect(x, y, w, hh); ctx.globalAlpha = 1; }
      ctx.strokeRect(x, y, w, hh); break;
    case 'ellipse':
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + hh / 2, Math.max(1, w / 2), Math.max(1, hh / 2), 0, 0, Math.PI * 2);
      if (o.fill) { ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.stroke(); break;
    case 'highlight':
      ctx.globalAlpha = 0.35; ctx.fillStyle = o.color || '#facc15'; ctx.fillRect(x, y, w, hh); break;
    case 'spotlight': {
      // dim everything except the region
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(x, y, w, hh); ctx.fill('evenodd');
      break;
    }
    case 'blur': {
      if (w < 2 || hh < 2) break;
      const strength = Math.max(2, (o.strength || 12) * u);
      if (o.mode === 'solid') { ctx.fillStyle = o.color || '#000'; ctx.fillRect(x, y, w, hh); break; }
      // Copy the region of the already-rendered frame and blur/pixelate it in place.
      const sc = scratch || makeCanvas(1, 1);
      const pad = Math.ceil(strength * 2);
      const rx = Math.max(0, Math.floor(x - pad)); const ry = Math.max(0, Math.floor(y - pad));
      const rw = Math.min(W - rx, Math.ceil(w + 2 * pad)); const rh = Math.min(H - ry, Math.ceil(hh + 2 * pad));
      if (rw <= 0 || rh <= 0) break;
      sc.width = rw; sc.height = rh;
      const sctx = sc.getContext('2d');
      if (o.mode === 'pixelate') {
        const cell = Math.max(2, strength);
        const tw = Math.max(1, Math.round(rw / cell)); const th = Math.max(1, Math.round(rh / cell));
        sctx.imageSmoothingEnabled = true; sctx.drawImage(ctx.canvas, rx, ry, rw, rh, 0, 0, tw, th);
        ctx.beginPath(); ctx.rect(x, y, w, hh); ctx.clip();
        ctx.imageSmoothingEnabled = false; ctx.drawImage(sc, 0, 0, tw, th, rx, ry, rw, rh);
      } else {
        sctx.filter = `blur(${strength}px)`;
        sctx.drawImage(ctx.canvas, rx, ry, rw, rh, 0, 0, rw, rh);
        sctx.filter = 'none';
        ctx.beginPath(); ctx.rect(x, y, w, hh); ctx.clip();
        ctx.drawImage(sc, rx, ry);
      }
      break;
    }
    default: break;
  }
  ctx.restore();
  if (selected) {
    ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5;
    const b = overlayBounds(o, W, H); ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); ctx.restore();
  }
}

export function overlayBounds(o, W, H, ctx = null) {
  if (o.type === 'arrow') {
    const x1 = o.x1 * W, y1 = o.y1 * H, x2 = o.x2 * W, y2 = o.y2 * H;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  if (o.type === 'text') {
    const size = (o.fontSize || 60) * H / 1000; const lines = String(o.text || '').split('\n');
    let tw = Math.max(...lines.map((l) => l.length)) * size * 0.58;
    if (ctx) { ctx.save(); ctx.font = `700 ${size}px system-ui, sans-serif`; tw = Math.max(...lines.map((l) => ctx.measureText(l).width)); ctx.restore(); }
    return { x: o.x * W, y: o.y * H, w: tw, h: lines.length * size * 1.25 };
  }
  return { x: o.x * W, y: o.y * H, w: o.w * W, h: o.h * H };
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
