// Streaming baseline JPEG encoder.
//
// Why a custom encoder?
//  * Canvas `toBlob('image/jpeg')` needs the whole image in one canvas, which caps the size at the
//    browser canvas limit (32767 px / ~268 MP). Full-page screenshots can be taller than that.
//    This encoder consumes the image in horizontal strips, so a single JPEG can be as large as the
//    JPEG format allows (65535 x 65535) without downscaling and with bounded memory.
//  * It supports 4:4:4 chroma (no colour subsampling), which keeps small coloured text sharp.
//
// Standard JPEG algorithms (ITU-T T.81 Annex K tables, AAN DCT). JFIF density records the
// capture DPI so prints come out at the on-screen physical size.

const NATURAL = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

const STD_LUM_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const STD_CHR_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

export const STD_DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
export const STD_DC_LUM_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const STD_DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
export const STD_DC_CHR_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const STD_AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
export const STD_AC_LUM_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];
export const STD_AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
export const STD_AC_CHR_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

const AASF = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379];

export const JPEG_MAX_DIM = 65535;

function buildHuffman(bits, vals) {
  const codes = new Uint16Array(256); const sizes = new Uint8Array(256);
  let code = 0; let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) { codes[vals[k]] = code; sizes[vals[k]] = len; k++; code++; }
    code <<= 1;
  }
  return { codes, sizes };
}

function scaleQuant(base, quality) {
  quality = Math.max(1, Math.min(100, Math.round(quality)));
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
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

class ByteSink {
  constructor(cap = 1 << 20) { this.buf = new Uint8Array(cap); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2; while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  byte(b) { if (this.len >= this.buf.length) this.ensure(1); this.buf[this.len++] = b; }
  word(w) { this.byte((w >> 8) & 0xff); this.byte(w & 0xff); }
  bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
  take() { const out = this.buf.slice(0, this.len); this.len = 0; return out; }
}

export class JpegStreamEncoder {
  /**
   * @param {{width:number,height:number,quality?:number,subsampling?:'444'|'420',dpi?:number}} o
   */
  constructor({ width, height, quality = 95, subsampling = '444', dpi = 96 }) {
    if (!(width > 0 && height > 0)) throw new Error('Invalid JPEG dimensions');
    if (width > JPEG_MAX_DIM || height > JPEG_MAX_DIM) throw new Error(`JPEG dimensions are limited to ${JPEG_MAX_DIM}px`);
    this.width = width; this.height = height;
    this.sub = subsampling === '420' ? 2 : 1;
    this.mcuW = 8 * this.sub; this.mcuH = 8 * this.sub;
    this.quality = quality; this.dpi = Math.max(1, Math.min(65535, Math.round(dpi)));
    this.qY = scaleQuant(STD_LUM_Q, quality); this.qC = scaleQuant(STD_CHR_Q, quality);
    this.fY = fdtblFor(this.qY); this.fC = fdtblFor(this.qC);
    this.dcY = buildHuffman(STD_DC_LUM_BITS, STD_DC_LUM_VALS);
    this.acY = buildHuffman(STD_AC_LUM_BITS, STD_AC_LUM_VALS);
    this.dcC = buildHuffman(STD_DC_CHR_BITS, STD_DC_CHR_VALS);
    this.acC = buildHuffman(STD_AC_CHR_BITS, STD_AC_CHR_VALS);
    this.out = new ByteSink();
    this.bitBuf = 0; this.bitCnt = 0;
    this.predY = 0; this.predCb = 0; this.predCr = 0;
    this.rowsDone = 0;
    // pending strip buffer for one MCU row
    this.strip = new Uint8ClampedArray(width * this.mcuH * 4);
    this.stripRows = 0;
    this.blk = new Float32Array(64); this.blkCb = new Float32Array(64); this.blkCr = new Float32Array(64);
    this.cb4 = new Float32Array(256); this.cr4 = new Float32Array(256); // 16x16 chroma for 4:2:0
    this.du = new Int32Array(64);
    this.headerWritten = false;
  }

  _writeHeader() {
    const o = this.out;
    o.word(0xffd8); // SOI
    // APP0 JFIF
    o.word(0xffe0); o.word(16); o.bytes([0x4a, 0x46, 0x49, 0x46, 0]); o.byte(1); o.byte(2);
    o.byte(1); o.word(this.dpi); o.word(this.dpi); o.byte(0); o.byte(0);
    // DQT
    o.word(0xffdb); o.word(132);
    o.byte(0); for (let i = 0; i < 64; i++) o.byte(this.qY[NATURAL[i]]);
    o.byte(1); for (let i = 0; i < 64; i++) o.byte(this.qC[NATURAL[i]]);
    // SOF0
    o.word(0xffc0); o.word(17); o.byte(8); o.word(this.height); o.word(this.width); o.byte(3);
    o.byte(1); o.byte(this.sub === 2 ? 0x22 : 0x11); o.byte(0);
    o.byte(2); o.byte(0x11); o.byte(1);
    o.byte(3); o.byte(0x11); o.byte(1);
    // DHT
    const tables = [
      [0x00, STD_DC_LUM_BITS, STD_DC_LUM_VALS], [0x10, STD_AC_LUM_BITS, STD_AC_LUM_VALS],
      [0x01, STD_DC_CHR_BITS, STD_DC_CHR_VALS], [0x11, STD_AC_CHR_BITS, STD_AC_CHR_VALS],
    ];
    let len = 2; for (const [, b, v] of tables) len += 17 + v.length;
    o.word(0xffc4); o.word(len);
    for (const [cls, b, v] of tables) { o.byte(cls); o.bytes(b); o.bytes(v); }
    // SOS
    o.word(0xffda); o.word(12); o.byte(3);
    o.byte(1); o.byte(0x00); o.byte(2); o.byte(0x11); o.byte(3); o.byte(0x11);
    o.byte(0); o.byte(63); o.byte(0);
    this.headerWritten = true;
  }

  _bits(code, len) {
    // accumulate MSB first
    this.bitBuf = (this.bitBuf << len) | (code & ((1 << len) - 1));
    this.bitCnt += len;
    const o = this.out;
    while (this.bitCnt >= 8) {
      this.bitCnt -= 8;
      const b = (this.bitBuf >>> this.bitCnt) & 0xff;
      o.byte(b);
      if (b === 0xff) o.byte(0);
    }
    this.bitBuf &= (1 << this.bitCnt) - 1;
  }

  _flushBits() {
    if (this.bitCnt > 0) this._bits(0x7f, 8 - this.bitCnt); // pad with 1-bits
  }

  _encodeBlock(data, fdtbl, pred, dc, ac) {
    // --- AAN forward DCT (rows then columns) ---
    for (let i = 0; i < 64; i += 8) {
      const d0 = data[i], d1 = data[i + 1], d2 = data[i + 2], d3 = data[i + 3], d4 = data[i + 4], d5 = data[i + 5], d6 = data[i + 6], d7 = data[i + 7];
      const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3; const t13 = t0 - t3; let t11 = t1 + t2; let t12 = t1 - t2;
      data[i] = t10 + t11; data[i + 4] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      data[i + 2] = t13 + z1; data[i + 6] = t13 - z1;
      t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433;
      const z2 = 0.5411961 * t10 + z5; const z4 = 1.306562965 * t12 + z5; const z3 = t11 * 0.707106781;
      const z11 = t7 + z3; const z13 = t7 - z3;
      data[i + 5] = z13 + z2; data[i + 3] = z13 - z2; data[i + 1] = z11 + z4; data[i + 7] = z11 - z4;
    }
    for (let i = 0; i < 8; i++) {
      const d0 = data[i], d1 = data[i + 8], d2 = data[i + 16], d3 = data[i + 24], d4 = data[i + 32], d5 = data[i + 40], d6 = data[i + 48], d7 = data[i + 56];
      const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
      let t10 = t0 + t3; const t13 = t0 - t3; let t11 = t1 + t2; let t12 = t1 - t2;
      data[i] = t10 + t11; data[i + 32] = t10 - t11;
      const z1 = (t12 + t13) * 0.707106781;
      data[i + 16] = t13 + z1; data[i + 48] = t13 - z1;
      t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
      const z5 = (t10 - t12) * 0.382683433;
      const z2 = 0.5411961 * t10 + z5; const z4 = 1.306562965 * t12 + z5; const z3 = t11 * 0.707106781;
      const z11 = t7 + z3; const z13 = t7 - z3;
      data[i + 40] = z13 + z2; data[i + 24] = z13 - z2; data[i + 8] = z11 + z4; data[i + 56] = z11 - z4;
    }
    // --- quantise into zig-zag order ---
    const du = this.du;
    for (let k = 0; k < 64; k++) {
      const n = NATURAL[k];
      let v = Math.round(data[n] * fdtbl[n]);
      if (k > 0) { if (v > 1023) v = 1023; else if (v < -1023) v = -1023; }
      du[k] = v;
    }
    // --- Huffman ---
    const diff = du[0] - pred;
    if (diff === 0) this._bits(dc.codes[0], dc.sizes[0]);
    else {
      const a = diff < 0 ? -diff : diff; const cat = 32 - Math.clz32(a);
      this._bits(dc.codes[cat], dc.sizes[cat]);
      this._bits(diff < 0 ? diff - 1 : diff, cat);
    }
    let end = 63; while (end > 0 && du[end] === 0) end--;
    if (end === 0) { this._bits(ac.codes[0], ac.sizes[0]); return du[0]; }
    let i = 1;
    while (i <= end) {
      const start = i;
      while (du[i] === 0 && i <= end) i++;
      let zeros = i - start;
      if (zeros >= 16) {
        const n16 = zeros >> 4;
        for (let m = 0; m < n16; m++) this._bits(ac.codes[0xf0], ac.sizes[0xf0]);
        zeros &= 15;
      }
      const v = du[i]; const a = v < 0 ? -v : v; const cat = 32 - Math.clz32(a);
      const sym = (zeros << 4) + cat;
      this._bits(ac.codes[sym], ac.sizes[sym]);
      this._bits(v < 0 ? v - 1 : v, cat);
      i++;
    }
    if (end !== 63) this._bits(ac.codes[0], ac.sizes[0]);
    return du[0];
  }

  _encodeMcuRow(px, rowsValid) {
    const W = this.width; const s = this.sub; const mcuW = this.mcuW;
    const blk = this.blk, bcb = this.blkCb, bcr = this.blkCr;
    const maxRow = rowsValid - 1;
    if (s === 1) {
      for (let bx = 0; bx < W; bx += 8) {
        for (let y = 0; y < 8; y++) {
          const ry = y > maxRow ? maxRow : y;
          const rowOff = ry * W;
          for (let x = 0; x < 8; x++) {
            let cx = bx + x; if (cx >= W) cx = W - 1;
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
    // 4:2:0 – 16x16 MCU: Y00 Y01 Y10 Y11 Cb Cr
    const cb4 = this.cb4, cr4 = this.cr4;
    for (let bx = 0; bx < W; bx += mcuW) {
      for (let y = 0; y < 16; y++) {
        const ry = y > maxRow ? maxRow : y; const rowOff = ry * W;
        for (let x = 0; x < 16; x++) {
          let cx = bx + x; if (cx >= W) cx = W - 1;
          const p = (rowOff + cx) * 4; const r = px[p], g = px[p + 1], b = px[p + 2];
          const k = y * 16 + x;
          cb4[k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
          cr4[k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
        }
      }
      for (let q = 0; q < 4; q++) {
        const ox = (q & 1) * 8; const oy = (q >> 1) * 8;
        for (let y = 0; y < 8; y++) {
          const yy = oy + y; const ry = yy > maxRow ? maxRow : yy; const rowOff = ry * W;
          for (let x = 0; x < 8; x++) {
            let cx = bx + ox + x; if (cx >= W) cx = W - 1;
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
    const W4 = this.width * 4; const mh = this.mcuH;
    let r = 0;
    while (r < rows) {
      if (this.rowsDone + this.stripRows >= this.height) break; // ignore extra rows
      if (this.stripRows === 0 && rows - r >= mh && this.rowsDone + mh <= this.height) {
        // fast path: full MCU row directly from the input
        this._encodeMcuRow(rgba.subarray(r * W4, (r + mh) * W4), mh);
        this.rowsDone += mh; r += mh; continue;
      }
      const n = Math.min(mh - this.stripRows, rows - r);
      this.strip.set(rgba.subarray(r * W4, (r + n) * W4), this.stripRows * W4);
      this.stripRows += n; r += n;
      if (this.stripRows === mh) {
        this._encodeMcuRow(this.strip, mh);
        this.rowsDone += mh; this.stripRows = 0;
      }
    }
    return this.out.take();
  }

  /** Flush remaining rows (edge-replicated) and write EOI. */
  finish() {
    if (!this.headerWritten) this._writeHeader();
    if (this.stripRows > 0) {
      this._encodeMcuRow(this.strip, this.stripRows);
      this.rowsDone += this.stripRows; this.stripRows = 0;
    }
    if (this.rowsDone < this.height) throw new Error(`JPEG encoder received ${this.rowsDone} of ${this.height} rows`);
    this._flushBits();
    this.out.word(0xffd9);
    return this.out.take();
  }
}

/** Convenience: encode a whole ImageData-like object. */
export function encodeJpeg(imageData, opts = {}) {
  const enc = new JpegStreamEncoder({ width: imageData.width, height: imageData.height, ...opts });
  const parts = [enc.addRows(imageData.data, imageData.height), enc.finish()];
  return new Blob(parts, { type: 'image/jpeg' });
}
