// Webcam overlay geometry shared by the recorder compositor, recorder preview and video editor.
export function webcamRect(outW, outH, o) {
  const sizePct = Math.max(5, Math.min(60, Number(o.size ?? o.webcamSize ?? 22)));
  const shape = o.shape ?? o.webcamShape ?? 'circle';
  const camAspect = o.camAspect || 16 / 9;
  const w = Math.round(outW * sizePct / 100);
  const h = shape === 'circle' ? w : Math.round(w / camAspect);
  const m = Math.round(Math.min(outW, outH) * 0.03);
  const pos = o.position ?? o.webcamPosition ?? 'bottom-right';
  let x; let y;
  if (pos === 'top-left') { x = m; y = m; }
  else if (pos === 'top-right') { x = outW - w - m; y = m; }
  else if (pos === 'bottom-left') { x = m; y = outH - h - m; }
  else if (pos === 'custom') {
    x = Math.round((o.x ?? o.webcamX ?? 0.75) * outW); y = Math.round((o.y ?? o.webcamY ?? 0.7) * outH);
  } else { x = outW - w - m; y = outH - h - m; }
  x = Math.max(0, Math.min(outW - w, x)); y = Math.max(0, Math.min(outH - h, y));
  return { x, y, w, h, shape };
}

/** Draw a camera frame into ctx at rect (cover-cropped, optionally mirrored, circle/rounded). */
export function drawWebcam(ctx, frame, frameW, frameH, rect, { opacity = 1, mirror = true, border = true } = {}) {
  const { x, y, w, h, shape } = rect;
  const scale = Math.max(w / frameW, h / frameH);
  const sw = w / scale; const sh = h / scale;
  const sx = (frameW - sw) / 2; const sy = (frameH - sh) / 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
  else if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.08);
  else ctx.rect(x, y, w, h);
  ctx.save();
  ctx.clip();
  if (mirror) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h); }
  else ctx.drawImage(frame, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  if (border) {
    ctx.lineWidth = Math.max(2, Math.round(w * 0.015));
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }
  ctx.restore();
}
