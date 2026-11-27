// Minimal, dependency-free PDF writer.
// Images are embedded as DCTDecode streams: the JPEG bytes go into the PDF unchanged, so the
// PDF holds exactly the pixels of the JPEG (no re-rasterisation, no hidden downscaling).
// The file is assembled as a Blob of parts, so large images never need to be copied in memory.

const enc = new TextEncoder();
const MAX_PAGE_UNITS = 14400; // PDF implementation limit (200 in) per page dimension without UserUnit

function pdfString(s) {
  // UTF-16BE hex string with BOM – safe for any characters
  const str = String(s ?? '');
  let hex = 'FEFF';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += cp.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

function pdfDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  return `(D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(tz) / 60))}'${p(Math.abs(tz) % 60)}')`;
}

const num = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : r.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
};

export class PdfBuilder {
  constructor({ title = '', author = 'FullPage HD Capture' } = {}) {
    this.objects = []; // index = id-1 : array of parts
    this.pages = [];
    this.title = title; this.author = author;
    this.catalogId = this._reserve();
    this.pagesId = this._reserve();
    this.imageCount = 0;
  }

  _reserve() { this.objects.push(null); return this.objects.length; }
  _set(id, parts) { this.objects[id - 1] = parts; }
  _add(parts) { const id = this._reserve(); this._set(id, parts); return id; }

  /** Add a JPEG image. Returns a handle used by addPage(). */
  addJpeg(jpegBlob, width, height) {
    const name = `Im${++this.imageCount}`;
    const id = this._add([
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBlob.size} >>\nstream\n`,
      jpegBlob,
      '\nendstream',
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
    if (maxDim > MAX_PAGE_UNITS) unit = Math.ceil((maxDim / MAX_PAGE_UNITS) * 1000) / 1000;
    const W = widthPt / unit; const H = heightPt / unit;
    let content = '';
    const xobj = [];
    for (const d of draws) {
      const w = d.w / unit; const h = d.h / unit; const x = d.x / unit; const yTop = d.y / unit;
      content += `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(H - yTop - h)} cm /${d.image.name} Do Q\n`;
      if (!xobj.some((o) => o.name === d.image.name)) xobj.push(d.image);
    }
    const contentBytes = enc.encode(content);
    const contentId = this._add([`<< /Length ${contentBytes.length} >>\nstream\n`, contentBytes, '\nendstream']);
    const res = `<< /XObject << ${xobj.map((o) => `/${o.name} ${o.id} 0 R`).join(' ')} >> /ProcSet [/PDF /ImageC] >>`;
    const pageId = this._add([
      `<< /Type /Page /Parent ${this.pagesId} 0 R /MediaBox [0 0 ${num(W)} ${num(H)}]${unit !== 1 ? ` /UserUnit ${num(unit)}` : ''} /Resources ${res} /Contents ${contentId} 0 R >>`,
    ]);
    this.pages.push(pageId);
    return pageId;
  }

  build() {
    this._set(this.pagesId, [`<< /Type /Pages /Kids [${this.pages.map((p) => `${p} 0 R`).join(' ')}] /Count ${this.pages.length} >>`]);
    this._set(this.catalogId, [`<< /Type /Catalog /Pages ${this.pagesId} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`]);
    const infoId = this._add([`<< /Title ${pdfString(this.title)} /Producer ${pdfString('FullPage HD Capture')} /Creator ${pdfString(this.author)} /CreationDate ${pdfDate()} >>`]);

    const parts = [];
    let offset = 0;
    const push = (p) => {
      const part = typeof p === 'string' ? enc.encode(p) : p;
      parts.push(part);
      offset += part instanceof Blob ? part.size : part.byteLength;
    };
    push('%PDF-1.6\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment
    const offsets = [];
    this.objects.forEach((obj, i) => {
      if (!obj) throw new Error(`PDF object ${i + 1} missing`);
      offsets.push(offset);
      push(`${i + 1} 0 obj\n`);
      for (const p of obj) push(p);
      push('\nendobj\n');
    });
    const xrefAt = offset;
    let xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${this.objects.length + 1} /Root ${this.catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
}

export const PAPER_SIZES_PT = {
  a4: { w: 595.276, h: 841.89 },
  letter: { w: 612, h: 792 },
};
export const MM_TO_PT = 72 / 25.4;
