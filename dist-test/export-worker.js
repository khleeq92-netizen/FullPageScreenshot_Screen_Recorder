// src/image-processing/renderer.js
function cropRect(doc, srcW, srcH) {
  const c = doc?.crop;
  if (!c) return { x: 0, y: 0, w: srcW, h: srcH };
  const x = Math.max(0, Math.min(srcW - 1, Math.round(c.x)));
  const y = Math.max(0, Math.min(srcH - 1, Math.round(c.y)));
  const w = Math.max(1, Math.min(srcW - x, Math.round(c.w)));
  const h = Math.max(1, Math.min(srcH - y, Math.round(c.h)));
  return { x, y, w, h };
}
function outputSize(doc, srcW, srcH) {
  const c = cropRect(doc, srcW, srcH);
  const r = ((doc?.rotation || 0) % 360 + 360) % 360;
  return r === 90 || r === 270 ? { width: c.h, height: c.w } : { width: c.w, height: c.h };
}
function applySourceTransform(ctx, doc, srcW, srcH, ox, oy, s = 1) {
  const c = cropRect(doc, srcW, srcH);
  const r = ((doc?.rotation || 0) % 360 + 360) % 360;
  ctx.setTransform(s, 0, 0, s, -ox * s, -oy * s);
  if (r === 90) {
    ctx.translate(c.h, 0);
    ctx.rotate(Math.PI / 2);
  } else if (r === 180) {
    ctx.translate(c.w, c.h);
    ctx.rotate(Math.PI);
  } else if (r === 270) {
    ctx.translate(0, c.w);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.translate(-c.x, -c.y);
}
function outputRectToSource(doc, srcW, srcH, x, y, w, h) {
  const c = cropRect(doc, srcW, srcH);
  const r = ((doc?.rotation || 0) % 360 + 360) % 360;
  let sx, sy, sw, sh;
  if (r === 0) {
    sx = x;
    sy = y;
    sw = w;
    sh = h;
  } else if (r === 180) {
    sx = c.w - x - w;
    sy = c.h - y - h;
    sw = w;
    sh = h;
  } else if (r === 90) {
    sx = y;
    sy = c.h - x - w;
    sw = h;
    sh = w;
  } else {
    sx = c.w - y - h;
    sy = x;
    sw = h;
    sh = w;
  }
  return { x: sx + c.x, y: sy + c.y, w: sw, h: sh };
}
var SegmentSource = class {
  constructor(segments, width, { cacheSize = 3 } = {}) {
    this.segments = segments.slice().sort((a, b) => a.y - b.y);
    this.width = width;
    this.height = this.segments.reduce((m, s) => Math.max(m, s.y + s.height), 0);
    this.cache = /* @__PURE__ */ new Map();
    this.cacheSize = cacheSize;
  }
  async bitmap(seg) {
    let p = this.cache.get(seg);
    if (p) {
      this.cache.delete(seg);
      this.cache.set(seg, p);
      return p;
    }
    p = createImageBitmap(seg.blob);
    this.cache.set(seg, p);
    while (this.cache.size > this.cacheSize) {
      const [k, v] = this.cache.entries().next().value;
      this.cache.delete(k);
      v.then((b) => b.close()).catch(() => {
      });
    }
    return p;
  }
  overlapping(y0, y1) {
    return this.segments.filter((s) => s.y < y1 && s.y + s.height > y0);
  }
  async drawRange(ctx, y0, y1) {
    for (const seg of this.overlapping(y0, y1)) {
      const bmp = await this.bitmap(seg);
      ctx.drawImage(bmp, 0, seg.y);
    }
  }
  close() {
    for (const p of this.cache.values()) p.then((b) => b.close()).catch(() => {
    });
    this.cache.clear();
  }
};
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
async function buildBlurPatches(src, doc, { scale = 1 } = {}) {
  const patches = /* @__PURE__ */ new Map();
  for (const a of doc?.annotations || []) {
    if (a.type !== "blur") continue;
    const x = Math.round(Math.min(a.x1, a.x2));
    const y = Math.round(Math.min(a.y1, a.y2));
    const w = Math.round(Math.abs(a.x2 - a.x1));
    const h = Math.round(Math.abs(a.y2 - a.y1));
    if (w < 2 || h < 2) continue;
    const strength = Math.max(2, a.strength || 14);
    const m = Math.ceil(strength * 3);
    const px = Math.max(0, x - m);
    const py = Math.max(0, y - m);
    const pw = Math.min(src.width, x + w + m) - px;
    const ph = Math.min(src.height, y + h + m) - py;
    const ws = Math.max(1, Math.round(pw * scale));
    const hs = Math.max(1, Math.round(ph * scale));
    const base = makeCanvas(ws, hs);
    const bctx = base.getContext("2d");
    bctx.setTransform(scale, 0, 0, scale, -px * scale, -py * scale);
    await src.drawRange(bctx, py, py + ph);
    const out = makeCanvas(ws, hs);
    const octx = out.getContext("2d");
    if (a.mode === "pixelate") {
      const cell = Math.max(2, strength * scale);
      const tw = Math.max(1, Math.round(ws / cell));
      const th = Math.max(1, Math.round(hs / cell));
      const tiny = makeCanvas(tw, th);
      const tctx = tiny.getContext("2d");
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(base, 0, 0, tw, th);
      octx.imageSmoothingEnabled = false;
      octx.drawImage(tiny, 0, 0, ws, hs);
    } else if (a.mode === "solid") {
      octx.fillStyle = a.color || "#000";
      octx.fillRect(0, 0, ws, hs);
    } else {
      octx.filter = `blur(${strength * scale}px)`;
      octx.drawImage(base, 0, 0);
      octx.filter = "none";
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
function drawAnnotation(ctx, a, patches) {
  ctx.save();
  const color = a.color || "#ef4444";
  const lw = a.width || 4;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const x = Math.min(a.x1, a.x2);
  const y = Math.min(a.y1, a.y2);
  const w = Math.abs(a.x2 - a.x1);
  const h = Math.abs(a.y2 - a.y1);
  switch (a.type) {
    case "arrow": {
      const head = Math.max(10, lw * 4);
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x2 - Math.cos(ang) * head * 0.6, a.y2 - Math.sin(ang) * head * 0.6);
      ctx.stroke();
      arrowHead(ctx, a.x1, a.y1, a.x2, a.y2, head);
      break;
    }
    case "line":
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x2, a.y2);
      ctx.stroke();
      break;
    case "rect":
      if (a.fill) {
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      }
      ctx.strokeRect(x, y, w, h);
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      if (a.fill) {
        ctx.globalAlpha = 0.25;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
      break;
    case "highlight":
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = a.color || "#facc15";
      ctx.fillRect(x, y, w, h);
      break;
    case "pen": {
      const pts = a.points || [];
      if (pts.length < 2) break;
      if (a.highlighter) {
        ctx.globalAlpha = 0.4;
        ctx.globalCompositeOperation = "multiply";
      }
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
      break;
    }
    case "text": {
      const size = a.fontSize || 32;
      ctx.font = `${a.bold === false ? 400 : 700} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textBaseline = "top";
      const lines = String(a.text || "").split("\n");
      const lh = size * 1.25;
      if (a.background) {
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
        ctx.fillStyle = a.background;
        ctx.fillRect(a.x1 - size * 0.3, a.y1 - size * 0.2, tw + size * 0.6, lines.length * lh + size * 0.3);
        ctx.fillStyle = color;
      }
      lines.forEach((l, i) => ctx.fillText(l, a.x1, a.y1 + i * lh));
      break;
    }
    case "blur": {
      const p = patches?.get(a.id);
      if (p) {
        ctx.beginPath();
        ctx.rect(p.rect.x, p.rect.y, p.rect.w, p.rect.h);
        ctx.clip();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(p.canvas, p.x, p.y, p.w, p.h);
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
async function renderRegion(ctx, src, doc, region, { scale = 1, patches = null, background = "#ffffff" } = {}) {
  const { x, y, w, h } = region;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, Math.ceil(w * scale), Math.ceil(h * scale));
  applySourceTransform(ctx, doc, src.width, src.height, x, y, scale);
  const sb = outputRectToSource(doc, src.width, src.height, x, y, w, h);
  ctx.imageSmoothingEnabled = scale !== 1;
  ctx.imageSmoothingQuality = "high";
  await src.drawRange(ctx, sb.y, sb.y + sb.h);
  for (const a of doc?.annotations || []) {
    if (a.hidden) continue;
    drawAnnotation(ctx, a, patches);
  }
  ctx.restore();
}
function findQuietRow(imageData, fromRow, toRow) {
  const { data, width } = imageData;
  const step = Math.max(1, Math.floor(width / 400));
  for (let r = toRow; r >= fromRow; r--) {
    const o = r * width * 4;
    const r0 = data[o], g0 = data[o + 1], b0 = data[o + 2];
    let ok = true;
    for (let x = 0; x < width; x += step) {
      const p = o + x * 4;
      if (Math.abs(data[p] - r0) > 10 || Math.abs(data[p + 1] - g0) > 10 || Math.abs(data[p + 2] - b0) > 10) {
        ok = false;
        break;
      }
    }
    if (ok) return r;
  }
  return -1;
}

// src/image-processing/jpeg-encoder.js
var NATURAL = new Uint8Array([
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63
]);
var STD_LUM_Q = [
  16,
  11,
  10,
  16,
  24,
  40,
  51,
  61,
  12,
  12,
  14,
  19,
  26,
  58,
  60,
  55,
  14,
  13,
  16,
  24,
  40,
  57,
  69,
  56,
  14,
  17,
  22,
  29,
  51,
  87,
  80,
  62,
  18,
  22,
  37,
  56,
  68,
  109,
  103,
  77,
  24,
  35,
  55,
  64,
  81,
  104,
  113,
  92,
  49,
  64,
  78,
  87,
  103,
  121,
  120,
  101,
  72,
  92,
  95,
  98,
  112,
  100,
  103,
  99
];
var STD_CHR_Q = [
  17,
  18,
  24,
  47,
  99,
  99,
  99,
  99,
  18,
  21,
  26,
  66,
  99,
  99,
  99,
  99,
  24,
  26,
  56,
  99,
  99,
  99,
  99,
  99,
  47,
  66,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99,
  99
];
var STD_DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
var STD_DC_LUM_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
var STD_DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
var STD_DC_CHR_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
var STD_AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
var STD_AC_LUM_VALS = [
  1,
  2,
  3,
  0,
  4,
  17,
  5,
  18,
  33,
  49,
  65,
  6,
  19,
  81,
  97,
  7,
  34,
  113,
  20,
  50,
  129,
  145,
  161,
  8,
  35,
  66,
  177,
  193,
  21,
  82,
  209,
  240,
  36,
  51,
  98,
  114,
  130,
  9,
  10,
  22,
  23,
  24,
  25,
  26,
  37,
  38,
  39,
  40,
  41,
  42,
  52,
  53,
  54,
  55,
  56,
  57,
  58,
  67,
  68,
  69,
  70,
  71,
  72,
  73,
  74,
  83,
  84,
  85,
  86,
  87,
  88,
  89,
  90,
  99,
  100,
  101,
  102,
  103,
  104,
  105,
  106,
  115,
  116,
  117,
  118,
  119,
  120,
  121,
  122,
  131,
  132,
  133,
  134,
  135,
  136,
  137,
  138,
  146,
  147,
  148,
  149,
  150,
  151,
  152,
  153,
  154,
  162,
  163,
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  178,
  179,
  180,
  181,
  182,
  183,
  184,
  185,
  186,
  194,
  195,
  196,
  197,
  198,
  199,
  200,
  201,
  202,
  210,
  211,
  212,
  213,
  214,
  215,
  216,
  217,
  218,
  225,
  226,
  227,
  228,
  229,
  230,
  231,
  232,
  233,
  234,
  241,
  242,
  243,
  244,
  245,
  246,
  247,
  248,
  249,
  250
];
var STD_AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119];
var STD_AC_CHR_VALS = [
  0,
  1,
  2,
  3,
  17,
  4,
  5,
  33,
  49,
  6,
  18,
  65,
  81,
  7,
  97,
  113,
  19,
  34,
  50,
  129,
  8,
  20,
  66,
  145,
  161,
  177,
  193,
  9,
  35,
  51,
  82,
  240,
  21,
  98,
  114,
  209,
  10,
  22,
  36,
  52,
  225,
  37,
  241,
  23,
  24,
  25,
  26,
  38,
  39,
  40,
  41,
  42,
  53,
  54,
  55,
  56,
  57,
  58,
  67,
  68,
  69,
  70,
  71,
  72,
  73,
  74,
  83,
  84,
  85,
  86,
  87,
  88,
  89,
  90,
  99,
  100,
  101,
  102,
  103,
  104,
  105,
  106,
  115,
  116,
  117,
  118,
  119,
  120,
  121,
  122,
  130,
  131,
  132,
  133,
  134,
  135,
  136,
  137,
  138,
  146,
  147,
  148,
  149,
  150,
  151,
  152,
  153,
  154,
  162,
  163,
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  178,
  179,
  180,
  181,
  182,
  183,
  184,
  185,
  186,
  194,
  195,
  196,
  197,
  198,
  199,
  200,
  201,
  202,
  210,
  211,
  212,
  213,
  214,
  215,
  216,
  217,
  218,
  226,
  227,
  228,
  229,
  230,
  231,
  232,
  233,
  234,
  242,
  243,
  244,
  245,
  246,
  247,
  248,
  249,
  250
];
var AASF = [1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.5411961, 0.275899379];
var JPEG_MAX_DIM = 65535;
function buildHuffman(bits, vals) {
  const codes = new Uint16Array(256);
  const sizes = new Uint8Array(256);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) {
      codes[vals[k]] = code;
      sizes[vals[k]] = len;
      k++;
      code++;
    }
    code <<= 1;
  }
  return { codes, sizes };
}
function scaleQuant(base, quality) {
  quality = Math.max(1, Math.min(100, Math.round(quality)));
  const scale = quality < 50 ? 5e3 / quality : 200 - quality * 2;
  const q = new Uint8Array(64);
  for (let i = 0; i < 64; i++) q[i] = Math.max(1, Math.min(255, Math.floor((base[i] * scale + 50) / 100)));
  return q;
}
function fdtblFor(q) {
  const t = new Float32Array(64);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    t[row * 8 + col] = 1 / (q[row * 8 + col] * AASF[row] * AASF[col] * 8);
  }
  return t;
}
var ByteSink = class {
  constructor(cap = 1 << 20) {
    this.buf = new Uint8Array(cap);
    this.len = 0;
  }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  byte(b) {
    if (this.len >= this.buf.length) this.ensure(1);
    this.buf[this.len++] = b;
  }
  word(w) {
    this.byte(w >> 8 & 255);
    this.byte(w & 255);
  }
  bytes(arr) {
    this.ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  }
  take() {
    const out = this.buf.slice(0, this.len);
    this.len = 0;
    return out;
  }
};
var JpegStreamEncoder = class {
  /**
   * @param {{width:number,height:number,quality?:number,subsampling?:'444'|'420',dpi?:number}} o
   */
  constructor({ width, height, quality = 95, subsampling = "444", dpi = 96 }) {
    if (!(width > 0 && height > 0)) throw new Error("Invalid JPEG dimensions");
    if (width > JPEG_MAX_DIM || height > JPEG_MAX_DIM) throw new Error(`JPEG dimensions are limited to ${JPEG_MAX_DIM}px`);
    this.width = width;
    this.height = height;
    this.sub = subsampling === "420" ? 2 : 1;
    this.mcuW = 8 * this.sub;
    this.mcuH = 8 * this.sub;
    this.quality = quality;
    this.dpi = Math.max(1, Math.min(65535, Math.round(dpi)));
    this.qY = scaleQuant(STD_LUM_Q, quality);
    this.qC = scaleQuant(STD_CHR_Q, quality);
    this.fY = fdtblFor(this.qY);
    this.fC = fdtblFor(this.qC);
    this.dcY = buildHuffman(STD_DC_LUM_BITS, STD_DC_LUM_VALS);
    this.acY = buildHuffman(STD_AC_LUM_BITS, STD_AC_LUM_VALS);
    this.dcC = buildHuffman(STD_DC_CHR_BITS, STD_DC_CHR_VALS);
    this.acC = buildHuffman(STD_AC_CHR_BITS, STD_AC_CHR_VALS);
    this.out = new ByteSink();
    this.bitBuf = 0;
    this.bitCnt = 0;
    this.predY = 0;
    this.predCb = 0;
    this.predCr = 0;
    this.rowsDone = 0;
    this.strip = new Uint8ClampedArray(width * this.mcuH * 4);
    this.stripRows = 0;
    this.blk = new Float32Array(64);
    this.blkCb = new Float32Array(64);
    this.blkCr = new Float32Array(64);
    this.cb4 = new Float32Array(256);
    this.cr4 = new Float32Array(256);
    this.du = new Int32Array(64);
    this.headerWritten = false;
  }
  _writeHeader() {
    const o = this.out;
    o.word(65496);
    o.word(65504);
    o.word(16);
    o.bytes([74, 70, 73, 70, 0]);
    o.byte(1);
    o.byte(2);
    o.byte(1);
    o.word(this.dpi);
    o.word(this.dpi);
    o.byte(0);
    o.byte(0);
    o.word(65499);
    o.word(132);
    o.byte(0);
    for (let i = 0; i < 64; i++) o.byte(this.qY[NATURAL[i]]);
    o.byte(1);
    for (let i = 0; i < 64; i++) o.byte(this.qC[NATURAL[i]]);
    o.word(65472);
    o.word(17);
    o.byte(8);
    o.word(this.height);
    o.word(this.width);
    o.byte(3);
    o.byte(1);
    o.byte(this.sub === 2 ? 34 : 17);
    o.byte(0);
    o.byte(2);
    o.byte(17);
    o.byte(1);
    o.byte(3);
    o.byte(17);
    o.byte(1);
    const tables = [
      [0, STD_DC_LUM_BITS, STD_DC_LUM_VALS],
      [16, STD_AC_LUM_BITS, STD_AC_LUM_VALS],
      [1, STD_DC_CHR_BITS, STD_DC_CHR_VALS],
      [17, STD_AC_CHR_BITS, STD_AC_CHR_VALS]
    ];
    let len = 2;
    for (const [, b, v] of tables) len += 17 + v.length;
    o.word(65476);
    o.word(len);
    for (const [cls, b, v] of tables) {
      o.byte(cls);
      o.bytes(b);
      o.bytes(v);
    }
    o.word(65498);
    o.word(12);
    o.byte(3);
    o.byte(1);
    o.byte(0);
    o.byte(2);
    o.byte(17);
    o.byte(3);
    o.byte(17);
    o.byte(0);
    o.byte(63);
    o.byte(0);
    this.headerWritten = true;
  }
  _bits(code, len) {
    this.bitBuf = this.bitBuf << len | code & (1 << len) - 1;
    this.bitCnt += len;
    const o = this.out;
    while (this.bitCnt >= 8) {
      this.bitCnt -= 8;
      const b = this.bitBuf >>> this.bitCnt & 255;
      o.byte(b);
      if (b === 255) o.byte(0);
    }
    this.bitBuf &= (1 << this.bitCnt) - 1;
  }
  _flushBits() {
    if (this.bitCnt > 0) this._bits(127, 8 - this.bitCnt);
  }
  _encodeBlock(data, fdtbl, pred, dc, ac) {
    for (let i2 = 0; i2 < 64; i2 += 8) {
      const d0 = data[i2], d1 = data[i2 + 1], d2 = data[i2 + 2], d3 = data[i2 + 3], d4 = data[i2 + 4], d5 = data[i2 + 5], d6 = data[i2 + 6], d7 = data[i2 + 7];
      const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3;
      const t13 = t0 - t3;
      let t11 = t1 + t2;
      let t12 = t1 - t2;
      data[i2] = t10 + t11;
      data[i2 + 4] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      data[i2 + 2] = t13 + z1;
      data[i2 + 6] = t13 - z1;
      t10 = t4 + t5;
      t11 = t5 + t6;
      t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433;
      const z2 = 0.5411961 * t10 + z5;
      const z4 = 1.306562965 * t12 + z5;
      const z3 = t11 * 0.707106781;
      const z11 = t7 + z3;
      const z13 = t7 - z3;
      data[i2 + 5] = z13 + z2;
      data[i2 + 3] = z13 - z2;
      data[i2 + 1] = z11 + z4;
      data[i2 + 7] = z11 - z4;
    }
    for (let i2 = 0; i2 < 8; i2++) {
      const d0 = data[i2], d1 = data[i2 + 8], d2 = data[i2 + 16], d3 = data[i2 + 24], d4 = data[i2 + 32], d5 = data[i2 + 40], d6 = data[i2 + 48], d7 = data[i2 + 56];
      const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3;
      const t13 = t0 - t3;
      let t11 = t1 + t2;
      let t12 = t1 - t2;
      data[i2] = t10 + t11;
      data[i2 + 32] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      data[i2 + 16] = t13 + z1;
      data[i2 + 48] = t13 - z1;
      t10 = t4 + t5;
      t11 = t5 + t6;
      t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433;
      const z2 = 0.5411961 * t10 + z5;
      const z4 = 1.306562965 * t12 + z5;
      const z3 = t11 * 0.707106781;
      const z11 = t7 + z3;
      const z13 = t7 - z3;
      data[i2 + 40] = z13 + z2;
      data[i2 + 24] = z13 - z2;
      data[i2 + 8] = z11 + z4;
      data[i2 + 56] = z11 - z4;
    }
    const du = this.du;
    for (let k = 0; k < 64; k++) {
      const n = NATURAL[k];
      let v = Math.round(data[n] * fdtbl[n]);
      if (k > 0) {
        if (v > 1023) v = 1023;
        else if (v < -1023) v = -1023;
      }
      du[k] = v;
    }
    const diff = du[0] - pred;
    if (diff === 0) this._bits(dc.codes[0], dc.sizes[0]);
    else {
      const a = diff < 0 ? -diff : diff;
      const cat = 32 - Math.clz32(a);
      this._bits(dc.codes[cat], dc.sizes[cat]);
      this._bits(diff < 0 ? diff - 1 : diff, cat);
    }
    let end = 63;
    while (end > 0 && du[end] === 0) end--;
    if (end === 0) {
      this._bits(ac.codes[0], ac.sizes[0]);
      return du[0];
    }
    let i = 1;
    while (i <= end) {
      const start = i;
      while (du[i] === 0 && i <= end) i++;
      let zeros = i - start;
      if (zeros >= 16) {
        const n16 = zeros >> 4;
        for (let m = 0; m < n16; m++) this._bits(ac.codes[240], ac.sizes[240]);
        zeros &= 15;
      }
      const v = du[i];
      const a = v < 0 ? -v : v;
      const cat = 32 - Math.clz32(a);
      const sym = (zeros << 4) + cat;
      this._bits(ac.codes[sym], ac.sizes[sym]);
      this._bits(v < 0 ? v - 1 : v, cat);
      i++;
    }
    if (end !== 63) this._bits(ac.codes[0], ac.sizes[0]);
    return du[0];
  }
  _encodeMcuRow(px, rowsValid) {
    const W = this.width;
    const s = this.sub;
    const mcuW = this.mcuW;
    const blk = this.blk, bcb = this.blkCb, bcr = this.blkCr;
    const maxRow = rowsValid - 1;
    if (s === 1) {
      for (let bx = 0; bx < W; bx += 8) {
        for (let y = 0; y < 8; y++) {
          const ry = y > maxRow ? maxRow : y;
          const rowOff = ry * W;
          for (let x = 0; x < 8; x++) {
            let cx = bx + x;
            if (cx >= W) cx = W - 1;
            const p = (rowOff + cx) * 4;
            const r = px[p], g = px[p + 1], b = px[p + 2];
            const k = y * 8 + x;
            blk[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
            bcb[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
            bcr[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
          }
        }
        this.predY = this._encodeBlock(blk, this.fY, this.predY, this.dcY, this.acY);
        this.predCb = this._encodeBlock(bcb, this.fC, this.predCb, this.dcC, this.acC);
        this.predCr = this._encodeBlock(bcr, this.fC, this.predCr, this.dcC, this.acC);
      }
      return;
    }
    const cb4 = this.cb4, cr4 = this.cr4;
    for (let bx = 0; bx < W; bx += mcuW) {
      for (let y = 0; y < 16; y++) {
        const ry = y > maxRow ? maxRow : y;
        const rowOff = ry * W;
        for (let x = 0; x < 16; x++) {
          let cx = bx + x;
          if (cx >= W) cx = W - 1;
          const p = (rowOff + cx) * 4;
          const r = px[p], g = px[p + 1], b = px[p + 2];
          const k = y * 16 + x;
          cb4[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          cr4[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      for (let q = 0; q < 4; q++) {
        const ox = (q & 1) * 8;
        const oy = (q >> 1) * 8;
        for (let y = 0; y < 8; y++) {
          const yy = oy + y;
          const ry = yy > maxRow ? maxRow : yy;
          const rowOff = ry * W;
          for (let x = 0; x < 8; x++) {
            let cx = bx + ox + x;
            if (cx >= W) cx = W - 1;
            const p = (rowOff + cx) * 4;
            blk[y * 8 + x] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2] - 128;
          }
        }
        this.predY = this._encodeBlock(blk, this.fY, this.predY, this.dcY, this.acY);
      }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const k = y * 32 + x * 2;
        bcb[y * 8 + x] = (cb4[k] + cb4[k + 1] + cb4[k + 16] + cb4[k + 17]) * 0.25;
        bcr[y * 8 + x] = (cr4[k] + cr4[k + 1] + cr4[k + 16] + cr4[k + 17]) * 0.25;
      }
      this.predCb = this._encodeBlock(bcb, this.fC, this.predCb, this.dcC, this.acC);
      this.predCr = this._encodeBlock(bcr, this.fC, this.predCr, this.dcC, this.acC);
    }
  }
  /**
   * Feed `rows` rows of RGBA pixels (width = this.width). Returns encoded bytes produced so far.
   * @param {Uint8ClampedArray|Uint8Array} rgba
   * @param {number} rows
   */
  addRows(rgba, rows) {
    if (!this.headerWritten) this._writeHeader();
    const W4 = this.width * 4;
    const mh = this.mcuH;
    let r = 0;
    while (r < rows) {
      if (this.rowsDone + this.stripRows >= this.height) break;
      if (this.stripRows === 0 && rows - r >= mh && this.rowsDone + mh <= this.height) {
        this._encodeMcuRow(rgba.subarray(r * W4, (r + mh) * W4), mh);
        this.rowsDone += mh;
        r += mh;
        continue;
      }
      const n = Math.min(mh - this.stripRows, rows - r);
      this.strip.set(rgba.subarray(r * W4, (r + n) * W4), this.stripRows * W4);
      this.stripRows += n;
      r += n;
      if (this.stripRows === mh) {
        this._encodeMcuRow(this.strip, mh);
        this.rowsDone += mh;
        this.stripRows = 0;
      }
    }
    return this.out.take();
  }
  /** Flush remaining rows (edge-replicated) and write EOI. */
  finish() {
    if (!this.headerWritten) this._writeHeader();
    if (this.stripRows > 0) {
      this._encodeMcuRow(this.strip, this.stripRows);
      this.rowsDone += this.stripRows;
      this.stripRows = 0;
    }
    if (this.rowsDone < this.height) throw new Error(`JPEG encoder received ${this.rowsDone} of ${this.height} rows`);
    this._flushBits();
    this.out.word(65497);
    return this.out.take();
  }
};

// src/pdf/pdf-writer.js
var enc = new TextEncoder();
var MAX_PAGE_UNITS = 14400;
function pdfString(s) {
  const str = String(s ?? "");
  let hex = "FEFF";
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp > 65535) {
      const v = cp - 65536;
      hex += (55296 + (v >> 10)).toString(16).padStart(4, "0") + (56320 + (v & 1023)).toString(16).padStart(4, "0");
    } else hex += cp.toString(16).padStart(4, "0");
  }
  return `<${hex.toUpperCase()}>`;
}
function pdfDate(d = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  return `(D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(tz) / 60))}'${p(Math.abs(tz) % 60)}')`;
}
var num = (n) => {
  const r = Math.round(n * 1e3) / 1e3;
  return Number.isInteger(r) ? String(r) : r.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};
var PdfBuilder = class {
  constructor({ title = "", author = "FullPage HD Capture" } = {}) {
    this.objects = [];
    this.pages = [];
    this.title = title;
    this.author = author;
    this.catalogId = this._reserve();
    this.pagesId = this._reserve();
    this.imageCount = 0;
  }
  _reserve() {
    this.objects.push(null);
    return this.objects.length;
  }
  _set(id, parts) {
    this.objects[id - 1] = parts;
  }
  _add(parts) {
    const id = this._reserve();
    this._set(id, parts);
    return id;
  }
  /** Add a JPEG image. Returns a handle used by addPage(). */
  addJpeg(jpegBlob, width, height) {
    const name = `Im${++this.imageCount}`;
    const id = this._add([
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBlob.size} >>
stream
`,
      jpegBlob,
      "\nendstream"
    ]);
    return { id, name, width, height };
  }
  /**
   * Add a page. Sizes are in PDF points (1/72 in). Draws: [{image, x, y, w, h}] with y measured from the TOP of the page.
   * Very large pages are expressed with /UserUnit so they keep their true proportions.
   */
  addPage(widthPt, heightPt, draws) {
    let unit = 1;
    const maxDim = Math.max(widthPt, heightPt);
    if (maxDim > MAX_PAGE_UNITS) unit = Math.ceil(maxDim / MAX_PAGE_UNITS * 1e3) / 1e3;
    const W = widthPt / unit;
    const H = heightPt / unit;
    let content = "";
    const xobj = [];
    for (const d of draws) {
      const w = d.w / unit;
      const h = d.h / unit;
      const x = d.x / unit;
      const yTop = d.y / unit;
      content += `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(H - yTop - h)} cm /${d.image.name} Do Q
`;
      if (!xobj.some((o) => o.name === d.image.name)) xobj.push(d.image);
    }
    const contentBytes = enc.encode(content);
    const contentId = this._add([`<< /Length ${contentBytes.length} >>
stream
`, contentBytes, "\nendstream"]);
    const res = `<< /XObject << ${xobj.map((o) => `/${o.name} ${o.id} 0 R`).join(" ")} >> /ProcSet [/PDF /ImageC] >>`;
    const pageId = this._add([
      `<< /Type /Page /Parent ${this.pagesId} 0 R /MediaBox [0 0 ${num(W)} ${num(H)}]${unit !== 1 ? ` /UserUnit ${num(unit)}` : ""} /Resources ${res} /Contents ${contentId} 0 R >>`
    ]);
    this.pages.push(pageId);
    return pageId;
  }
  build() {
    this._set(this.pagesId, [`<< /Type /Pages /Kids [${this.pages.map((p) => `${p} 0 R`).join(" ")}] /Count ${this.pages.length} >>`]);
    this._set(this.catalogId, [`<< /Type /Catalog /Pages ${this.pagesId} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`]);
    const infoId = this._add([`<< /Title ${pdfString(this.title)} /Producer ${pdfString("FullPage HD Capture")} /Creator ${pdfString(this.author)} /CreationDate ${pdfDate()} >>`]);
    const parts = [];
    let offset = 0;
    const push = (p) => {
      const part = typeof p === "string" ? enc.encode(p) : p;
      parts.push(part);
      offset += part instanceof Blob ? part.size : part.byteLength;
    };
    push("%PDF-1.6\n");
    push(new Uint8Array([37, 226, 227, 207, 211, 10]));
    const offsets = [];
    this.objects.forEach((obj, i) => {
      if (!obj) throw new Error(`PDF object ${i + 1} missing`);
      offsets.push(offset);
      push(`${i + 1} 0 obj
`);
      for (const p of obj) push(p);
      push("\nendobj\n");
    });
    const xrefAt = offset;
    let xref = `xref
0 ${this.objects.length + 1}
0000000000 65535 f 
`;
    for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n 
`;
    push(xref);
    push(`trailer
<< /Size ${this.objects.length + 1} /Root ${this.catalogId} 0 R /Info ${infoId} 0 R >>
startxref
${xrefAt}
%%EOF
`);
    return new Blob(parts, { type: "application/pdf" });
  }
};
var PAPER_SIZES_PT = {
  a4: { w: 595.276, h: 841.89 },
  letter: { w: 612, h: 792 }
};
var MM_TO_PT = 72 / 25.4;

// src/image-processing/export-worker.js
var PNG_MAX_DIM = 32767;
var PNG_MAX_AREA = 268e6;
function stripRowsFor(width) {
  return Math.max(16, Math.floor(16e6 / width / 16) * 16);
}
function ctxFor(w, h) {
  const c = new OffscreenCanvas(w, h);
  return c.getContext("2d", { willReadFrequently: true, alpha: false });
}
async function encodeRegionJpeg(src, doc, patches, outW, y0, h, opts, onRows) {
  const enc2 = new JpegStreamEncoder({ width: outW, height: h, quality: opts.quality, subsampling: opts.subsampling, dpi: opts.dpi });
  const parts = [];
  const rows = stripRowsFor(outW);
  let ctx = null;
  for (let y = 0; y < h; y += rows) {
    const n = Math.min(rows, h - y);
    if (!ctx || ctx.canvas.height !== n) ctx = ctxFor(outW, n);
    await renderRegion(ctx, src, doc, { x: 0, y: y0 + y, w: outW, h: n }, { patches });
    const img = ctx.getImageData(0, 0, outW, n);
    parts.push(enc2.addRows(img.data, n));
    onRows?.(n);
  }
  parts.push(enc2.finish());
  return new Blob(parts, { type: "image/jpeg" });
}
function splitEven(total, max) {
  const n = Math.ceil(total / max);
  const base = Math.ceil(total / n / 16) * 16;
  const out = [];
  let y = 0;
  while (y < total) {
    const h = Math.min(base, total - y);
    out.push({ y, h });
    y += h;
  }
  return out;
}
async function exportJpeg(job, progress) {
  const { width: outW, height: outH } = outputSize(job.doc, job.width, job.height);
  if (outW > JPEG_MAX_DIM) throw new Error(`The image is ${outW}px wide; JPEG supports at most ${JPEG_MAX_DIM}px. Crop or rotate it, or use PDF.`);
  const src = new SegmentSource(job.segments, job.width);
  const patches = await buildBlurPatches(src, job.doc);
  const parts = splitEven(outH, JPEG_MAX_DIM);
  let done = 0;
  const files = [];
  for (const p of parts) {
    files.push(await encodeRegionJpeg(src, job.doc, patches, outW, p.y, p.h, job, (n) => {
      done += n;
      progress(done / outH);
    }));
  }
  src.close();
  return { files, width: outW, height: outH, parts: parts.map((p) => ({ width: outW, height: p.h })) };
}
async function exportPng(job, progress) {
  const { width: outW, height: outH } = outputSize(job.doc, job.width, job.height);
  if (outW > PNG_MAX_DIM) throw new Error("The image is too wide for PNG export in the browser. Use JPG or PDF.");
  const src = new SegmentSource(job.segments, job.width);
  const patches = await buildBlurPatches(src, job.doc);
  const maxRows = Math.min(PNG_MAX_DIM, Math.floor(PNG_MAX_AREA / outW / 4));
  const parts = splitEven(outH, Math.max(16, maxRows));
  const files = [];
  let done = 0;
  for (const p of parts) {
    const c = new OffscreenCanvas(outW, p.h);
    const ctx = c.getContext("2d");
    await renderRegion(ctx, src, job.doc, { x: 0, y: p.y, w: outW, h: p.h }, { patches });
    files.push(await c.convertToBlob({ type: "image/png" }));
    c.width = c.height = 1;
    done += p.h;
    progress(done / outH);
  }
  src.close();
  return { files, width: outW, height: outH, parts: parts.map((p) => ({ width: outW, height: p.h })) };
}
async function exportPdf(job, progress) {
  const { width: outW, height: outH } = outputSize(job.doc, job.width, job.height);
  const src = new SegmentSource(job.segments, job.width);
  const patches = await buildBlurPatches(src, job.doc);
  const pdf = new PdfBuilder({ title: job.title || "Capture" });
  const ptPerPx = 0.75 / (job.scale || 1);
  const jpegOpts = { quality: job.quality, subsampling: job.subsampling, dpi: job.dpi };
  let done = 0;
  if (job.pdfLayout !== "paged") {
    const CHUNK = 8192;
    const draws = [];
    for (let y = 0; y < outH; y += CHUNK) {
      const h = Math.min(CHUNK, outH - y);
      const hDraw = Math.min(h + 1, outH - y);
      const blob2 = await encodeRegionJpeg(src, job.doc, patches, outW, y, hDraw, jpegOpts, (n) => {
        done += n;
        progress(Math.min(0.99, done / outH));
      });
      const img = pdf.addJpeg(blob2, outW, hDraw);
      draws.push({ image: img, x: 0, y: y * ptPerPx, w: outW * ptPerPx, h: hDraw * ptPerPx });
    }
    pdf.addPage(outW * ptPerPx, outH * ptPerPx, draws);
  } else {
    const paper = PAPER_SIZES_PT[job.pdfPaper] || PAPER_SIZES_PT.a4;
    const landscape = job.pdfOrientation === "landscape";
    const pw = landscape ? paper.h : paper.w;
    const ph = landscape ? paper.w : paper.h;
    const m = Math.max(0, Math.min(50, Number(job.pdfMarginMm) || 0)) * MM_TO_PT;
    const cw = pw - 2 * m;
    const ch = ph - 2 * m;
    const k = Math.min(cw / outW, ptPerPx * 4);
    const rowsPerPage = Math.max(16, Math.floor(ch / k));
    let y = 0;
    while (y < outH) {
      let h = Math.min(rowsPerPage, outH - y);
      if (job.pdfSmartBreaks && y + h < outH) {
        const look = Math.min(h - 16, Math.floor(rowsPerPage * 0.15));
        if (look > 8) {
          const ctx = ctxFor(outW, look);
          await renderRegion(ctx, src, job.doc, { x: 0, y: y + h - look, w: outW, h: look }, { patches });
          const r = findQuietRow(ctx.getImageData(0, 0, outW, look), 0, look - 1);
          if (r > 0) h = h - look + r + 1;
        }
      }
      const blob2 = await encodeRegionJpeg(src, job.doc, patches, outW, y, h, jpegOpts, (n) => {
        done += n;
        progress(Math.min(0.99, done / outH));
      });
      const img = pdf.addJpeg(blob2, outW, h);
      const drawW = outW * k;
      const x = m + (cw - drawW) / 2;
      pdf.addPage(pw, ph, [{ image: img, x, y: m, w: drawW, h: h * k }]);
      y += h;
    }
  }
  src.close();
  const blob = pdf.build();
  return { files: [blob], width: outW, height: outH, pages: pdf.pages.length };
}
async function exportPreview(job) {
  const { width: outW, height: outH } = outputSize(job.doc, job.width, job.height);
  const scale = Math.min(1, job.maxWidth / outW, 16e3 / outH);
  const w = Math.max(1, Math.round(outW * scale));
  const h = Math.max(1, Math.round(outH * scale));
  const src = new SegmentSource(job.segments, job.width);
  const patches = await buildBlurPatches(src, job.doc, { scale: 1 });
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d");
  await renderRegion(ctx, src, job.doc, { x: 0, y: 0, w: outW, h: outH }, { scale, patches });
  src.close();
  return { files: [await c.convertToBlob({ type: "image/jpeg", quality: 0.9 })], width: outW, height: outH };
}
self.onmessage = async (e) => {
  const job = e.data;
  const progress = (p) => self.postMessage({ type: "progress", id: job.id, progress: p });
  try {
    let res;
    if (job.cmd === "jpeg") res = await exportJpeg(job, progress);
    else if (job.cmd === "png") res = await exportPng(job, progress);
    else if (job.cmd === "pdf") res = await exportPdf(job, progress);
    else if (job.cmd === "preview") res = await exportPreview(job);
    else throw new Error(`Unknown command ${job.cmd}`);
    self.postMessage({ type: "done", id: job.id, ...res });
  } catch (err) {
    self.postMessage({ type: "error", id: job.id, message: String(err?.message || err) });
  }
};
//# sourceMappingURL=export-worker.js.map
