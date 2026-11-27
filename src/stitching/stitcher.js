// Stitcher – assembles captured viewport frames into fixed-height, full-resolution segments.
// Works with OffscreenCanvas, so it runs in the service worker, pages and workers alike.
// A segment is a horizontal band of the final image (lossless PNG). Splitting into segments keeps
// memory bounded and side-steps browser canvas size limits, so the final image is never downscaled.

export const MAX_CANVAS_DIM = 32767;           // Chrome canvas dimension limit
export const SEGMENT_PIXEL_BUDGET = 48_000_000; // ~192 MB RGBA per segment canvas, upper bound

export function segmentRowsFor(width) {
  return Math.max(256, Math.min(4096, Math.floor(SEGMENT_PIXEL_BUDGET / Math.max(1, width))));
}

export class Stitcher {
  /**
   * @param {object} o
   * @param {number} o.width  final image width in device pixels
   * @param {(seg:{index:number,y:number,height:number,blob:Blob})=>Promise<void>} o.onSegment
   */
  constructor({ width, onSegment, segmentRows }) {
    if (width > MAX_CANVAS_DIM) throw new Error(`Capture width ${width}px exceeds the browser canvas limit`);
    this.width = width;
    this.rows = segmentRows || segmentRowsFor(width);
    this.onSegment = onSegment;
    this.open = new Map(); // index -> {canvas, ctx, maxY}
    this.flushed = new Set();
    this.maxY = 0;
    this.segments = [];
  }

  _seg(index) {
    let s = this.open.get(index);
    if (!s) {
      if (this.flushed.has(index)) throw new Error(`Stitch order error: segment ${index} already written`);
      const canvas = new OffscreenCanvas(this.width, this.rows);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.width, this.rows);
      s = { canvas, ctx, index };
      this.open.set(index, s);
    }
    return s;
  }

  /** Draw a source rectangle of `bitmap` at destination (dx, dy) of the final image (1:1, no scaling). */
  draw(bitmap, sx, sy, sw, sh, dx, dy) {
    if (sw <= 0 || sh <= 0) return;
    const first = Math.floor(dy / this.rows);
    const last = Math.floor((dy + sh - 1) / this.rows);
    for (let i = first; i <= last; i++) {
      const s = this._seg(i);
      const segY = i * this.rows;
      // Portion of the draw that falls in this segment
      const y0 = Math.max(dy, segY); const y1 = Math.min(dy + sh, segY + this.rows);
      s.ctx.drawImage(bitmap, sx, sy + (y0 - dy), sw, y1 - y0, dx, y0 - segY, sw, y1 - y0);
    }
    this.maxY = Math.max(this.maxY, dy + sh);
  }

  /** Encode and release every segment that lies completely above `y` (rows above y are final). */
  async flushUpTo(y) {
    for (const [index, s] of [...this.open.entries()].sort((a, b) => a[0] - b[0])) {
      if ((index + 1) * this.rows <= y) await this._flush(index, s, this.rows);
    }
  }

  async _flush(index, s, height) {
    this.open.delete(index);
    this.flushed.add(index);
    let canvas = s.canvas;
    if (height < this.rows) {
      const c = new OffscreenCanvas(this.width, height);
      c.getContext('2d', { alpha: false }).drawImage(s.canvas, 0, 0);
      canvas = c;
      s.canvas.width = s.canvas.height = 1; // release memory early
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    canvas.width = canvas.height = 1;
    const seg = { index, y: index * this.rows, height, blob };
    this.segments.push({ index, y: seg.y, height, size: blob.size });
    await this.onSegment(seg);
  }

  /** Finish the image at `totalHeight` rows. Returns segment descriptors. */
  async finish(totalHeight) {
    const lastIndex = Math.ceil(totalHeight / this.rows) - 1;
    for (const [index, s] of [...this.open.entries()].sort((a, b) => a[0] - b[0])) {
      if (index > lastIndex) { this.open.delete(index); continue; }
      const h = Math.min(this.rows, totalHeight - index * this.rows);
      await this._flush(index, s, h);
    }
    // Rows that were never drawn (should not happen) are reported
    for (let i = 0; i <= lastIndex; i++) {
      if (!this.flushed.has(i)) throw new Error(`Segment ${i} has no captured content`);
    }
    return this.segments.sort((a, b) => a.index - b.index);
  }

  abort() {
    for (const s of this.open.values()) { s.canvas.width = s.canvas.height = 1; }
    this.open.clear();
  }
}
