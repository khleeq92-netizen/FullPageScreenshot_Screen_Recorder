import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JpegStreamEncoder, STD_AC_LUM_BITS, STD_AC_LUM_VALS, STD_AC_CHR_BITS, STD_AC_CHR_VALS } from '../../src/image-processing/jpeg-encoder.js';
import { PdfBuilder } from '../../src/pdf/pdf-writer.js';
import { outputSize, outputRectToSource } from '../../src/image-processing/renderer.js';
import { segmentRowsFor } from '../../src/stitching/stitcher.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fphd-unit-'));
const py = (code, ...a) => execFileSync('python3', ['-I', '-c', code, ...a], { encoding: 'utf8' }).trim();

function testImage(W, H) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = (y * W + x) * 4; px[p] = (x * 255) / W; px[p + 1] = (y * 255) / H; px[p + 2] = ((x >> 4) + (y >> 4)) % 2 ? 230 : 25; px[p + 3] = 255; }
  return px;
}
function encode(px, W, H, opts, strip = 37) {
  const e = new JpegStreamEncoder({ width: W, height: H, ...opts }); const parts = [];
  for (let r = 0; r < H; r += strip) { const n = Math.min(strip, H - r); parts.push(e.addRows(px.subarray(r * W * 4, (r + n) * W * 4), n)); }
  parts.push(e.finish());
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}
const PSNR = `
import sys, numpy as np; from PIL import Image
W,H=int(sys.argv[3]),int(sys.argv[4]); src=np.fromfile(sys.argv[1],dtype=np.uint8).reshape(H,W,4)[:,:,:3].astype(float)
im=Image.open(sys.argv[2]); a=np.asarray(im.convert('RGB')).astype(float); print(round(10*np.log10(255**2/((a-src)**2).mean()),2), im.size[0], im.size[1])`;

export const tests = [
  ['standard Huffman tables are complete', () => {
    assert.equal(STD_AC_LUM_BITS.reduce((a, b) => a + b), STD_AC_LUM_VALS.length);
    assert.equal(STD_AC_CHR_BITS.reduce((a, b) => a + b), STD_AC_CHR_VALS.length);
  }],
  ['JPEG 4:4:4 q95 decodes with PIL at high fidelity (odd sizes, odd strips)', () => {
    const W = 1003; const H = 517; const px = testImage(W, H);
    fs.writeFileSync(path.join(tmp, 'src.raw'), Buffer.from(px.buffer));
    for (const [q, min] of [[90, 38], [95, 42], [100, 48]]) {
      fs.writeFileSync(path.join(tmp, `q${q}.jpg`), encode(px, W, H, { quality: q }));
      const [psnr, w, h] = py(PSNR, path.join(tmp, 'src.raw'), path.join(tmp, `q${q}.jpg`), String(W), String(H)).split(' ').map(Number);
      assert.equal(w, W); assert.equal(h, H); assert.ok(psnr > min, `q${q}: ${psnr} dB`);
    }
  }],
  ['JPEG 4:2:0 option and DPI metadata', () => {
    const W = 640; const H = 480; const px = testImage(W, H);
    fs.writeFileSync(path.join(tmp, 's420.jpg'), encode(px, W, H, { quality: 90, subsampling: '420', dpi: 192 }));
    const pix = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', path.join(tmp, 's420.jpg')], { encoding: 'utf8' }).trim();
    assert.equal(pix, 'yuvj420p');
    assert.equal(py('import sys; from PIL import Image; print(Image.open(sys.argv[1]).info["dpi"][0])', path.join(tmp, 's420.jpg')), '192');
  }],
  ['JPEG rejects sizes beyond the format limit', () => assert.throws(() => new JpegStreamEncoder({ width: 100, height: 70000 }))],
  ['JPEG beyond canvas limits: 40000 px tall single image', () => {
    const W = 64; const H = 40000; const px = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = (y * W + x) * 4; px[p] = y % 256; px[p + 1] = 128; px[p + 2] = (y >> 8) % 256; px[p + 3] = 255; }
    fs.writeFileSync(path.join(tmp, 'tall.raw'), Buffer.from(px.buffer));
    fs.writeFileSync(path.join(tmp, 'tall.jpg'), encode(px, W, H, { quality: 95 }, 1000));
    const [psnr, w, h] = py(PSNR, path.join(tmp, 'tall.raw'), path.join(tmp, 'tall.jpg'), String(W), String(H)).split(' ').map(Number);
    assert.equal(w, 64); assert.equal(h, 40000); assert.ok(psnr > 40, `${psnr}`);
  }],
  ['PDF: embedded JPEG unchanged, page geometry, multi-page, UserUnit for huge pages', () => {
    const W = 300; const H = 200; const jpg = encode(testImage(W, H), W, H, { quality: 95 });
    const pdf = new PdfBuilder({ title: 'Tést – Ünïcode ✓' });
    const img = pdf.addJpeg(new Blob([jpg]), W, H);
    pdf.addPage(595.276, 841.89, [{ image: img, x: 20, y: 20, w: 300, h: 200 }]);
    pdf.addPage(300, 40000, [{ image: img, x: 0, y: 0, w: 300, h: 40000 }]);
    return pdf.build().arrayBuffer().then((buf) => {
      const f = path.join(tmp, 't.pdf'); fs.writeFileSync(f, Buffer.from(buf));
      const info = execFileSync('pdfinfo', ['-f', '1', '-l', '2', f], { encoding: 'utf8' });
      assert.match(info, /Pages:\s+2/); assert.match(info, /Title:\s+Tést – Ünïcode ✓/);
      assert.match(info, /Page\s+1 size:\s+595\.2\d* x 841\.8\d*/);
      // Pages taller than the PDF limit (14400 units) use /UserUnit, keeping the true proportions.
      const m = info.match(/Page\s+2 size:\s+([\d.]+) x ([\d.]+)/);
      assert.ok(Math.abs(Number(m[2]) / Number(m[1]) - 40000 / 300) < 0.01, info);
      assert.ok(Number(m[2]) <= 14400);
      assert.ok(Buffer.from(buf).toString('latin1').includes('/UserUnit 2.778'));
      execFileSync('pdfimages', ['-j', f, path.join(tmp, 'x')]);
      const extracted = fs.readFileSync(path.join(tmp, 'x-000.jpg'));
      assert.ok(extracted.equals(jpg), 'JPEG stream embedded byte-for-byte');
      execFileSync('pdftoppm', ['-r', '20', '-f', '1', '-l', '1', '-png', f, path.join(tmp, 'r')]);
    });
  }],
  ['renderer geometry: crop + rotation output sizes and inverse mapping', () => {
    const doc = { crop: { x: 10, y: 20, w: 300, h: 100 }, rotation: 90 };
    assert.deepEqual(outputSize(doc, 1000, 1000), { width: 100, height: 300 });
    // output rect (0,0,100,10) after 90° rotation corresponds to the crop's left column strip
    assert.deepEqual(outputRectToSource(doc, 1000, 1000, 0, 0, 100, 10), { x: 10, y: 20, w: 10, h: 100 });
    assert.deepEqual(outputRectToSource({ rotation: 180 }, 100, 50, 0, 0, 10, 5), { x: 90, y: 45, w: 10, h: 5 });
  }],
  ['stitch segment rows respect the memory budget', () => {
    assert.equal(segmentRowsFor(2560), 4096); assert.ok(segmentRowsFor(16000) * 16000 <= 48_000_000);
  }],
];
