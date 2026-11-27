// MediaRecorder writes WebM files without a Duration element, so players show an unknown length
// and seeking is unreliable. This patches the Segment > Info element with the real duration
// (only the first bytes of the file are rewritten; media data is untouched).

function readVint(buf, pos) {
  const first = buf[pos];
  if (first === undefined) return null;
  let len = 1; let mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    const b = buf[pos + i];
    if (b === undefined) return null;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { len, value, unknown: allOnes };
}

function readId(buf, pos) {
  const first = buf[pos];
  let len = 1; let mask = 0x80;
  while (len <= 4 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 4) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}

function sizeVint8(n) {
  const out = new Uint8Array(8); out[0] = 0x01;
  for (let i = 7; i >= 1; i--) { out[i] = n % 256; n = Math.floor(n / 256); }
  return out;
}

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_DURATION = 0x4489;
const ID_TIMECODESCALE = 0x2ad7b1;

/**
 * @param {Blob} blob WebM file
 * @param {number} durationMs real duration in milliseconds
 * @returns {Promise<Blob>}
 */
export async function fixWebmDuration(blob, durationMs) {
  const headLen = Math.min(blob.size, 256 * 1024);
  const buf = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
  let pos = 0;
  // EBML header
  const h = readId(buf, pos); if (!h || h.id !== 0x1a45dfa3) return blob;
  pos += h.len; const hs = readVint(buf, pos); pos += hs.len + hs.value;
  const seg = readId(buf, pos); if (!seg || seg.id !== ID_SEGMENT) return blob;
  pos += seg.len; const ss = readVint(buf, pos); pos += ss.len;
  // iterate segment children until Info
  while (pos < buf.length - 8) {
    const el = readId(buf, pos); if (!el) return blob;
    const sz = readVint(buf, pos + el.len); if (!sz) return blob;
    const dataStart = pos + el.len + sz.len;
    if (el.id === ID_INFO) {
      const infoEnd = dataStart + sz.value;
      if (infoEnd > buf.length) return blob;
      let timecodeScale = 1_000_000;
      const children = [];
      let p = dataStart;
      while (p < infoEnd) {
        const c = readId(buf, p); const cs = readVint(buf, p + c.len);
        const cStart = p + c.len + cs.len; const cEnd = cStart + cs.value;
        if (c.id === ID_TIMECODESCALE) { let v = 0; for (let i = cStart; i < cEnd; i++) v = v * 256 + buf[i]; timecodeScale = v || timecodeScale; }
        if (c.id !== ID_DURATION) children.push(buf.subarray(p, cEnd));
        p = cEnd;
      }
      const dur = new Uint8Array(11);
      dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;
      new DataView(dur.buffer).setFloat64(3, durationMs * (1_000_000 / timecodeScale));
      const bodyLen = children.reduce((a, c) => a + c.length, 0) + dur.length;
      const idBytes = buf.subarray(pos, pos + el.len);
      const newInfo = new Uint8Array(el.len + 8 + bodyLen);
      newInfo.set(idBytes, 0); newInfo.set(sizeVint8(bodyLen), el.len);
      let o = el.len + 8;
      for (const c of children) { newInfo.set(c, o); o += c.length; }
      newInfo.set(dur, o);
      return new Blob([buf.subarray(0, pos), newInfo, blob.slice(infoEnd)], { type: blob.type });
    }
    if (sz.unknown) return blob;
    pos = dataStart + sz.value;
  }
  return blob;
}
