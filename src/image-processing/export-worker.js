// Export worker – renders the edited screenshot strip-by-strip at full resolution and encodes
// JPG / PNG / PDF without blocking the UI. Runs in a dedicated Web Worker.
import { SegmentSource, renderRegion, outputSize, buildBlurPatches, findQuietRow } from './renderer.js';
import { JpegStreamEncoder, JPEG_MAX_DIM } from './jpeg-encoder.js';
import { PdfBuilder, PAPER_SIZES_PT, MM_TO_PT } from '../pdf/pdf-writer.js';

const PNG_MAX_DIM = 32767;
const PNG_MAX_AREA = 268_000_000;

function stripRowsFor(width) {
  return Math.max(16, Math.floor(16_000_000 / width / 16) * 16);
}

function ctxFor(w, h) {
  const c = new OffscreenCanvas(w, h);
  return c.getContext('2d', { willReadFrequently: true, alpha: false });
}

/** Encode an output region (full width) to JPEG using the streaming encoder. */
async function encodeRegionJpeg(src, doc, patches, outW, y0, h, opts, onRows) {
  const enc = new JpegStreamEncoder({ width: outW, height: h, quality: opts.quality, subsampling: opts.subsampling, dpi: opts.dpi });
  const parts = [];
  const rows = stripRowsFor(outW);
  let ctx = null;
  for (let y = 0; y < h; y += rows) {
    const n = Math.min(rows, h - y);
    if (!ctx || ctx.canvas.height !== n) ctx = ctxFor(outW, n);
    await renderRegion(ctx, src, doc, { x: 0, y: y0 + y, w: outW, h: n }, { patches });
    const img = ctx.getImageData(0, 0, outW, n);
    parts.push(enc.addRows(img.data, n));
    onRows?.(n);
  }
  parts.push(enc.finish());
  return new Blob(parts, { type: 'image/jpeg' });
}

function splitEven(total, max) {
  const n = Math.ceil(total / max);
  const base = Math.ceil(total / n / 16) * 16;
  const out = []; let y = 0;
  while (y < total) { const h = Math.min(base, total - y); out.push({ y, h }); y += h; }
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
    files.push(await encodeRegionJpeg(src, job.doc, patches, outW, p.y, p.h, job, (n) => { done += n; progress(done / outH); }));
  }
  src.close();
  return { files, width: outW, height: outH, parts: parts.map((p) => ({ width: outW, height: p.h })) };
}

async function exportPng(job, progress) {
  const { width: outW, height: outH } = outputSize(job.doc, job.width, job.height);
  if (outW > PNG_MAX_DIM) throw new Error('The image is too wide for PNG export in the browser. Use JPG or PDF.');
  const src = new SegmentSource(job.segments, job.width);
  const patches = await buildBlurPatches(src, job.doc);
  const maxRows = Math.min(PNG_MAX_DIM, Math.floor(PNG_MAX_AREA / outW / 4)); // keep a single canvas <= ~67 MP
  const parts = splitEven(outH, Math.max(16, maxRows));
  const files = [];
  let done = 0;
  for (const p of parts) {
    const c = new OffscreenCanvas(outW, p.h);
    const ctx = c.getContext('2d');
    await renderRegion(ctx, src, job.doc, { x: 0, y: p.y, w: outW, h: p.h }, { patches });
    files.push(await c.convertToBlob({ type: 'image/png' }));
    c.width = c.height = 1;
    done += p.h; progress(done / outH);
  }
  src.close();
  return { files, width: outW, height: outH, parts: parts.map((p) => ({ width: outW, height: p.h })) };
}

async function exportPdf(job, progress) {
  const { width: outW, height: outH } = outputSize(job.doc, job.width, job.height);
  const src = new SegmentSource(job.segments, job.width);
  const patches = await buildBlurPatches(src, job.doc);
  const pdf = new PdfBuilder({ title: job.title || 'Capture' });
  const ptPerPx = 0.75 / (job.scale || 1); // CSS px -> pt (96 dpi), device px -> CSS px
  const jpegOpts = { quality: job.quality, subsampling: job.subsampling, dpi: job.dpi };
  let done = 0;

  if (job.pdfLayout !== 'paged') {
    // One long page; the image is split into stacked JPEG strips (each overlaps the next by one row
    // so viewers never show hairline seams). All pixels are kept at full resolution.
    const CHUNK = 8192;
    const draws = [];
    for (let y = 0; y < outH; y += CHUNK) {
      const h = Math.min(CHUNK, outH - y);
      const hDraw = Math.min(h + 1, outH - y); // one-row overlap
      const blob = await encodeRegionJpeg(src, job.doc, patches, outW, y, hDraw, jpegOpts, (n) => { done += n; progress(Math.min(0.99, done / outH)); });
      const img = pdf.addJpeg(blob, outW, hDraw);
      draws.push({ image: img, x: 0, y: y * ptPerPx, w: outW * ptPerPx, h: hDraw * ptPerPx });
    }
    pdf.addPage(outW * ptPerPx, outH * ptPerPx, draws);
  } else {
    const paper = PAPER_SIZES_PT[job.pdfPaper] || PAPER_SIZES_PT.a4;
    const landscape = job.pdfOrientation === 'landscape';
    const pw = landscape ? paper.h : paper.w; const ph = landscape ? paper.w : paper.h;
    const m = Math.max(0, Math.min(50, Number(job.pdfMarginMm) || 0)) * MM_TO_PT;
    const cw = pw - 2 * m; const ch = ph - 2 * m;
    // Fit image width to the printable width. Never upscale beyond the 96-dpi physical size.
    const k = Math.min(cw / outW, ptPerPx * 4); // pt per px
    const rowsPerPage = Math.max(16, Math.floor(ch / k));
    let y = 0;
    while (y < outH) {
      let h = Math.min(rowsPerPage, outH - y);
      if (job.pdfSmartBreaks && y + h < outH) {
        // Look back up to 15% of a page for a uniform row so text lines are not cut in half.
        const look = Math.min(h - 16, Math.floor(rowsPerPage * 0.15));
        if (look > 8) {
          const ctx = ctxFor(outW, look);
          await renderRegion(ctx, src, job.doc, { x: 0, y: y + h - look, w: outW, h: look }, { patches });
          const r = findQuietRow(ctx.getImageData(0, 0, outW, look), 0, look - 1);
          if (r > 0) h = h - look + r + 1;
        }
      }
      const blob = await encodeRegionJpeg(src, job.doc, patches, outW, y, h, jpegOpts, (n) => { done += n; progress(Math.min(0.99, done / outH)); });
      const img = pdf.addJpeg(blob, outW, h);
      const drawW = outW * k; const x = m + (cw - drawW) / 2;
      pdf.addPage(pw, ph, [{ image: img, x, y: m, w: drawW, h: h * k }]);
      y += h;
    }
  }
  src.close();
  const blob = pdf.build();
  return { files: [blob], width: outW, height: outH, pages: pdf.pages.length };
}

/** Low resolution render of the full output (for the "result preview"). */
async function exportPreview(job) {
  const { width: outW, height: outH } = outputSize(job.doc, job.width, job.height);
  const scale = Math.min(1, job.maxWidth / outW, 16000 / outH);
  const w = Math.max(1, Math.round(outW * scale)); const h = Math.max(1, Math.round(outH * scale));
  const src = new SegmentSource(job.segments, job.width);
  const patches = await buildBlurPatches(src, job.doc, { scale: 1 });
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  await renderRegion(ctx, src, job.doc, { x: 0, y: 0, w: outW, h: outH }, { scale, patches });
  src.close();
  return { files: [await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], width: outW, height: outH };
}

self.onmessage = async (e) => {
  const job = e.data;
  const progress = (p) => self.postMessage({ type: 'progress', id: job.id, progress: p });
  try {
    let res;
    if (job.cmd === 'jpeg') res = await exportJpeg(job, progress);
    else if (job.cmd === 'png') res = await exportPng(job, progress);
    else if (job.cmd === 'pdf') res = await exportPdf(job, progress);
    else if (job.cmd === 'preview') res = await exportPreview(job);
    else throw new Error(`Unknown command ${job.cmd}`);
    self.postMessage({ type: 'done', id: job.id, ...res });
  } catch (err) {
    self.postMessage({ type: 'error', id: job.id, message: String(err?.message || err) });
  }
};
