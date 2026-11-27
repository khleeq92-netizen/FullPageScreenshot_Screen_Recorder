// Screenshot preview & editor page.
// The capture's lossless segments are displayed (scaled by the browser for viewing only).
// Edits are vector operations in an edit document, applied to a working copy at export time.
import { $, h, icon, toast, applyTheme, modal } from '../shared/ui.js';
import { getItem, getBlob, getProject, putProject, updateItem } from '../storage/db.js';
import { getSettings, saveSettings } from '../shared/settings.js';
import { formatBytes, formatDate } from '../shared/format.js';
import { expandPattern } from '../shared/filenames.js';
import { downloadBlob } from '../shared/downloads.js';
import { outputSize, SegmentSource, buildBlurPatches } from '../image-processing/renderer.js';

const params = new URLSearchParams(location.search);
const itemId = params.get('id');
const SVGNS = 'http://www.w3.org/2000/svg';

let item; let settings; let segments = [];
let doc = { annotations: [], crop: null, rotation: 0 };
const undoStack = []; const redoStack = [];
let tool = 'select'; let selectedId = null;
let style = { color: '#ef4444', width: 6, fontSize: 36, fill: false, blurMode: 'blur', strength: 14 };
let zoom = 1; let fitMode = true;
const blurUrls = new Map();
let svg; let stage;

const TOOLS = [
  ['select', 'select', 'Select / move (V)'], ['arrow', 'arrow', 'Arrow (A)'], ['rect', 'rect', 'Rectangle (R)'], ['ellipse', 'ellipse', 'Ellipse (E)'],
  ['highlight', 'highlight', 'Highlight area (H)'], ['text', 'text', 'Text (T)'], ['pen', 'pen', 'Freehand (P)'], ['blur', 'blur', 'Blur sensitive area (B)'], ['crop', 'crop', 'Crop (C)'],
];
const uid = () => Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------------ document / history
function snapshot() { return JSON.stringify(doc); }
function commit(mutator) {
  undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  mutator(doc);
  changed();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); doc = JSON.parse(undoStack.pop()); selectedId = null; changed(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); doc = JSON.parse(redoStack.pop()); selectedId = null; changed(); }

let saveTimer = 0;
function changed() {
  renderOverlay();
  updateInfo();
  updateToolbarState();
  refreshBlurPatches();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => putProject(itemId, doc).catch(() => {}), 400);
}

// ------------------------------------------------------------------ blur previews
let blurGen = 0;
async function refreshBlurPatches() {
  const gen = ++blurGen;
  const blurs = doc.annotations.filter((a) => a.type === 'blur');
  const keyOf = (a) => JSON.stringify([a.x1, a.y1, a.x2, a.y2, a.mode, a.strength, a.color]);
  for (const [id, v] of blurUrls) if (!blurs.some((b) => b.id === id && keyOf(b) === v.key)) { URL.revokeObjectURL(v.url); blurUrls.delete(id); }
  const todo = blurs.filter((b) => !blurUrls.has(b.id));
  if (!todo.length) return;
  const src = new SegmentSource(segments, item.width, { cacheSize: 2 });
  for (const a of todo) {
    const area = Math.abs((a.x2 - a.x1) * (a.y2 - a.y1));
    const scale = Math.min(1, Math.sqrt(4_000_000 / Math.max(1, area)));
    const patches = await buildBlurPatches(src, { annotations: [{ ...a, strength: a.strength }] }, { scale });
    const p = patches.get(a.id);
    if (gen !== blurGen) { src.close(); return; }
    if (!p) continue;
    const blob = p.canvas.convertToBlob ? await p.canvas.convertToBlob({ type: 'image/png' }) : await new Promise((r) => p.canvas.toBlob(r));
    blurUrls.set(a.id, { url: URL.createObjectURL(blob), key: keyOf(a), p: { x: p.x, y: p.y, w: p.w, h: p.h } });
  }
  src.close();
  renderOverlay();
}

// ------------------------------------------------------------------ overlay rendering (SVG in source pixel space)
function el(tag, attrs = {}) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; }

function annToSvg(a) {
  const g = el('g', { 'data-id': a.id });
  const x = Math.min(a.x1, a.x2); const y = Math.min(a.y1, a.y2); const w = Math.abs(a.x2 - a.x1); const hh = Math.abs(a.y2 - a.y1);
  const common = { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (a.type === 'arrow') {
    const head = Math.max(10, a.width * 4); const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
    g.append(el('line', { ...common, x1: a.x1, y1: a.y1, x2: a.x2 - Math.cos(ang) * head * 0.6, y2: a.y2 - Math.sin(ang) * head * 0.6 }));
    const p1 = [a.x2 - head * Math.cos(ang - Math.PI / 7), a.y2 - head * Math.sin(ang - Math.PI / 7)];
    const p2 = [a.x2 - head * Math.cos(ang + Math.PI / 7), a.y2 - head * Math.sin(ang + Math.PI / 7)];
    g.append(el('polygon', { points: `${a.x2},${a.y2} ${p1} ${p2}`, fill: a.color }));
  } else if (a.type === 'rect') {
    if (a.fill) g.append(el('rect', { x, y, width: w, height: hh, fill: a.color, 'fill-opacity': 0.25 }));
    g.append(el('rect', { ...common, x, y, width: w, height: hh }));
  } else if (a.type === 'ellipse') {
    if (a.fill) g.append(el('ellipse', { cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2, fill: a.color, 'fill-opacity': 0.25 }));
    g.append(el('ellipse', { ...common, cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2 }));
  } else if (a.type === 'highlight') {
    g.append(el('rect', { x, y, width: w, height: hh, fill: a.color, 'fill-opacity': 0.35, style: 'mix-blend-mode:multiply' }));
  } else if (a.type === 'pen') {
    const pts = []; for (let i = 0; i < a.points.length; i += 2) pts.push(`${a.points[i]},${a.points[i + 1]}`);
    g.append(el('polyline', { ...common, points: pts.join(' ') }));
  } else if (a.type === 'text') {
    const t = el('text', { x: a.x1, y: a.y1, fill: a.color, 'font-size': a.fontSize, 'font-weight': 700, 'font-family': 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', 'dominant-baseline': 'hanging' });
    String(a.text).split('\n').forEach((line, i) => { const ts = el('tspan', { x: a.x1, dy: i ? a.fontSize * 1.25 : 0 }); ts.textContent = line || ' '; t.append(ts); });
    g.append(t);
  } else if (a.type === 'blur') {
    const b = blurUrls.get(a.id);
    const clipId = `clip-${a.id}`;
    const cp = el('clipPath', { id: clipId }); cp.append(el('rect', { x, y, width: w, height: hh })); g.append(cp);
    if (b) g.append(el('image', { href: b.url, x: b.p.x, y: b.p.y, width: b.p.w, height: b.p.h, preserveAspectRatio: 'none', 'clip-path': `url(#${clipId})` }));
    else g.append(el('rect', { x, y, width: w, height: hh, fill: '#888', 'fill-opacity': 0.6 }));
  }
  return g;
}

function bbox(a) {
  if (a.type === 'pen') {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < a.points.length; i += 2) { x0 = Math.min(x0, a.points[i]); x1 = Math.max(x1, a.points[i]); y0 = Math.min(y0, a.points[i + 1]); y1 = Math.max(y1, a.points[i + 1]); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (a.type === 'text') {
    const lines = String(a.text).split('\n');
    const w = Math.max(...lines.map((l) => l.length)) * a.fontSize * 0.58;
    return { x: a.x1, y: a.y1, w, h: lines.length * a.fontSize * 1.25 };
  }
  return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
}

function renderOverlay(preview = null) {
  if (!svg) return;
  svg.replaceChildren();
  for (const a of doc.annotations) svg.append(annToSvg(a));
  if (preview) svg.append(annToSvg(preview));
  // crop mask
  const c = preview?.type === 'crop-preview' ? preview.rect : doc.crop;
  if (c) {
    const mask = el('path', { d: `M0 0H${item.width}V${item.height}H0Z M${c.x} ${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z`, fill: 'rgba(0,0,0,.5)', 'fill-rule': 'evenodd' });
    svg.append(mask, el('rect', { x: c.x, y: c.y, width: c.w, height: c.h, class: 'sel' }));
  }
  const sel = doc.annotations.find((a) => a.id === selectedId);
  if (sel) {
    const b = bbox(sel); const pad = 6 / zoom;
    svg.append(el('rect', { x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, class: 'sel' }));
    if (['arrow', 'rect', 'ellipse', 'highlight', 'blur'].includes(sel.type)) {
      const r = 6 / zoom;
      svg.append(el('circle', { cx: sel.x1, cy: sel.y1, r, class: 'handle', 'data-handle': '1' }), el('circle', { cx: sel.x2, cy: sel.y2, r, class: 'handle', 'data-handle': '2' }));
    }
  }
}

// ------------------------------------------------------------------ interaction
function toSource(e) {
  const r = stage.getBoundingClientRect();
  return { x: Math.max(0, Math.min(item.width, (e.clientX - r.left) / zoom)), y: Math.max(0, Math.min(item.height, (e.clientY - r.top) / zoom)) };
}

function hitTest(p) {
  const tol = 8 / zoom;
  for (let i = doc.annotations.length - 1; i >= 0; i--) {
    const a = doc.annotations[i]; const b = bbox(a);
    if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return a;
  }
  return null;
}

function startTextEdit(p, existing = null) {
  const ta = h('textarea', { class: 'text-edit' });
  const fs = (existing?.fontSize || style.fontSize) * zoom;
  Object.assign(ta.style, { left: `${p.x * zoom}px`, top: `${p.y * zoom}px`, fontSize: `${fs}px`, color: existing?.color || style.color, width: `${Math.max(200, fs * 10)}px`, height: `${fs * 1.5}px` });
  ta.value = existing?.text || '';
  stage.append(ta);
  setTimeout(() => ta.focus(), 0);
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    const text = ta.value.replace(/\s+$/, ''); ta.remove();
    if (!save) return;
    if (existing) {
      if (!text) commit((d) => { d.annotations = d.annotations.filter((a) => a.id !== existing.id); });
      else commit((d) => { const a = d.annotations.find((x) => x.id === existing.id); if (a) a.text = text; });
    } else if (text) {
      const a = { id: uid(), type: 'text', x1: p.x, y1: p.y, x2: p.x, y2: p.y, text, color: style.color, fontSize: style.fontSize };
      commit((d) => d.annotations.push(a)); selectedId = a.id; renderOverlay();
    }
  };
  ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') finish(false); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); } });
  ta.addEventListener('blur', () => finish(true));
}

function attachInteraction() {
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = toSource(e);
    svg.setPointerCapture(e.pointerId);
    if (tool === 'select') {
      const handle = e.target.dataset?.handle;
      const sel = doc.annotations.find((a) => a.id === selectedId);
      if (handle && sel) { drag = { mode: 'handle', handle, id: sel.id, before: snapshot() }; return; }
      const hit = hitTest(p);
      selectedId = hit?.id || null; renderOverlay(); updateToolbarState();
      if (hit) drag = { mode: 'move', id: hit.id, start: p, orig: JSON.parse(JSON.stringify(hit)), before: snapshot() };
      return;
    }
    if (tool === 'text') { const hit = hitTest(p); if (hit?.type === 'text') startTextEdit({ x: hit.x1, y: hit.y1 }, hit); else startTextEdit(p); return; }
    if (tool === 'crop') { drag = { mode: 'crop', start: p }; return; }
    const a = { id: uid(), type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: tool === 'highlight' && style.color === '#ef4444' ? '#facc15' : style.color, width: style.width, fill: style.fill };
    if (tool === 'pen') a.points = [p.x, p.y];
    if (tool === 'blur') { a.mode = style.blurMode; a.strength = Math.round(style.strength * (item.scale || 1)); a.color = '#000'; }
    drag = { mode: 'create', a };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toSource(e);
    if (drag.mode === 'create') {
      const a = drag.a;
      if (a.type === 'pen') a.points.push(p.x, p.y); else { a.x2 = p.x; a.y2 = p.y; }
      if (e.shiftKey && (a.type === 'rect' || a.type === 'ellipse')) { const d = Math.max(Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1)); a.x2 = a.x1 + Math.sign(a.x2 - a.x1 || 1) * d; a.y2 = a.y1 + Math.sign(a.y2 - a.y1 || 1) * d; }
      renderOverlay(a);
    } else if (drag.mode === 'crop') {
      const rect = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
      drag.rect = rect; renderOverlay({ type: 'crop-preview', rect });
    } else if (drag.mode === 'move') {
      const a = doc.annotations.find((x) => x.id === drag.id); const dx = p.x - drag.start.x; const dy = p.y - drag.start.y; const o = drag.orig;
      a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy;
      if (o.points) a.points = o.points.map((v, i) => v + (i % 2 ? dy : dx));
      renderOverlay();
    } else if (drag.mode === 'handle') {
      const a = doc.annotations.find((x) => x.id === drag.id);
      if (drag.handle === '1') { a.x1 = p.x; a.y1 = p.y; } else { a.x2 = p.x; a.y2 = p.y; }
      renderOverlay();
    }
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'create') {
      const a = d.a; const b = bbox(a);
      if ((a.type === 'pen' && a.points.length >= 4) || b.w > 3 || b.h > 3 || (a.type === 'arrow' && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 4)) {
        commit((dd) => dd.annotations.push(a)); selectedId = a.id; renderOverlay();
      } else renderOverlay();
    } else if (d.mode === 'crop') {
      if (d.rect && d.rect.w > 8 && d.rect.h > 8) commit((dd) => { dd.crop = { x: Math.round(d.rect.x), y: Math.round(d.rect.y), w: Math.round(d.rect.w), h: Math.round(d.rect.h) }; });
      else renderOverlay();
    } else if (d.mode === 'move' || d.mode === 'handle') {
      const after = snapshot();
      if (after !== d.before) { undoStack.push(d.before); redoStack.length = 0; changed(); }
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', (e) => {
    const hit = hitTest(toSource(e));
    if (hit?.type === 'text') startTextEdit({ x: hit.x1, y: hit.y1 }, hit);
  });
}

// ------------------------------------------------------------------ zoom
function applyZoom() {
  const wrap = $('#wrap');
  if (fitMode) zoom = Math.min(1, (wrap.clientWidth - 40) / item.width);
  stage.style.width = `${Math.round(item.width * zoom)}px`;
  stage.classList.toggle('pixelated', zoom >= 2);
  $('#zoom-ind').textContent = `${Math.round(zoom * 100)}%`;
  renderOverlay();
}
function setZoom(z, anchor) {
  const wrap = $('#wrap');
  const old = zoom; fitMode = false;
  zoom = Math.max(0.05, Math.min(8, z));
  const ax = anchor ? anchor.x : wrap.clientWidth / 2; const ay = anchor ? anchor.y : wrap.clientHeight / 2;
  const sx = (wrap.scrollLeft + ax) / old; const sy = (wrap.scrollTop + ay - 20) / old;
  applyZoom();
  wrap.scrollLeft = sx * zoom - ax; wrap.scrollTop = sy * zoom - ay + 20;
}

// ------------------------------------------------------------------ toolbar
function updateToolbarState() {
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === tool);
  $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length;
  $('#del').disabled = !selectedId;
  $('#clear-crop').style.display = doc.crop ? '' : 'none';
  $('#rot-ind').textContent = doc.rotation ? `Output rotated ${doc.rotation}°` : '';
  svg.style.cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';
}

function buildToolbar() {
  const bar = $('#tools');
  for (const [id, ic, title] of TOOLS) {
    const b = h('button', { class: 'btn icon', 'data-tool': id, title, html: icon(ic) });
    b.addEventListener('click', () => { tool = id; updateToolbarState(); });
    bar.append(b);
  }
  bar.append(h('span', { class: 'sep' }));
  const color = h('input', { type: 'color', value: style.color, title: 'Colour', id: 'color' });
  color.addEventListener('input', () => { style.color = color.value; if (selectedId) commit((d) => { const a = d.annotations.find((x) => x.id === selectedId); if (a && a.type !== 'blur') a.color = color.value; }); });
  const width = h('input', { type: 'range', min: 1, max: 40, value: style.width, title: 'Line width', style: { width: '80px' } });
  width.addEventListener('change', () => { style.width = Number(width.value); if (selectedId) commit((d) => { const a = d.annotations.find((x) => x.id === selectedId); if (a) a.width = style.width; }); });
  const font = h('select', { title: 'Text size' }); for (const s of [16, 20, 24, 32, 36, 48, 64, 96, 128]) font.append(h('option', { value: s, selected: s === style.fontSize }, `${s}px`));
  font.addEventListener('change', () => { style.fontSize = Number(font.value); if (selectedId) commit((d) => { const a = d.annotations.find((x) => x.id === selectedId); if (a?.type === 'text') a.fontSize = style.fontSize; }); });
  const fill = h('input', { type: 'checkbox' }); fill.addEventListener('change', () => { style.fill = fill.checked; });
  const blurMode = h('select', { title: 'Blur style' }, h('option', { value: 'blur' }, 'Blur'), h('option', { value: 'pixelate' }, 'Pixelate'), h('option', { value: 'solid' }, 'Solid box'));
  blurMode.addEventListener('change', () => { style.blurMode = blurMode.value; });
  bar.append(color, h('label', {}, 'Width', width), h('label', {}, 'Text', font), h('label', {}, fill, 'Fill'), h('label', {}, 'Redact', blurMode), h('span', { class: 'sep' }));
  const btn = (id, ic, title, fn) => { const b = h('button', { class: 'btn icon', id, title, html: icon(ic) }); b.addEventListener('click', fn); return b; };
  bar.append(btn('undo', 'undo', 'Undo (Ctrl+Z)', undo), btn('redo', 'redo', 'Redo (Ctrl+Y)', redo),
    btn('del', 'trash', 'Delete selected (Del)', () => { if (selectedId) { commit((d) => { d.annotations = d.annotations.filter((a) => a.id !== selectedId); }); selectedId = null; renderOverlay(); updateToolbarState(); } }),
    h('span', { class: 'sep' }),
    btn('rot-l', 'rotateL', 'Rotate left', () => commit((d) => { d.rotation = ((d.rotation || 0) + 270) % 360; })),
    btn('rot-r', 'rotate', 'Rotate right', () => commit((d) => { d.rotation = ((d.rotation || 0) + 90) % 360; })),
    h('button', { class: 'btn', id: 'clear-crop', style: { display: 'none' }, onclick: () => commit((d) => { d.crop = null; }) }, 'Remove crop'),
    h('span', { class: 'small muted', id: 'rot-ind' }),
    h('span', { class: 'grow' }),
    btn('zoom-out', 'zoomOut', 'Zoom out', () => setZoom(zoom / 1.25)), h('span', { class: 'zoom-ind', id: 'zoom-ind' }), btn('zoom-in', 'zoomIn', 'Zoom in', () => setZoom(zoom * 1.25)),
    h('button', { class: 'btn', onclick: () => { fitMode = true; applyZoom(); } }, 'Fit'), h('button', { class: 'btn', onclick: () => setZoom(1) }, '100%'),
    h('button', { class: 'btn', id: 'preview-result', html: `${icon('image')}<span>Preview result</span>`, onclick: previewResult }));
}

// ------------------------------------------------------------------ export
function runWorker(job, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker('export-worker.js', { type: 'module' });
    const id = uid();
    w.onmessage = (e) => {
      const m = e.data; if (m.id !== id) return;
      if (m.type === 'progress') onProgress?.(m.progress);
      else if (m.type === 'done') { w.terminate(); resolve(m); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Export worker failed')); };
    job.cancel = () => { w.terminate(); reject(new Error('Export cancelled')); };
    w.postMessage({ ...job, id, cancel: undefined });
  });
}

function baseJob() {
  return {
    segments: segments.map((s) => ({ blob: s.blob, y: s.y, height: s.height })),
    width: item.width, height: item.height, doc: JSON.parse(JSON.stringify(doc)), scale: item.scale || 1, title: item.title,
    quality: Number(settings.jpgQuality) || 95, subsampling: settings.chromaSubsampling || '444', dpi: Math.round(96 * (item.scale || 1)),
  };
}

let exporting = null;
async function doExport(kind) {
  if (exporting) return;
  const prog = $('#exp-progress'); const bar = prog.querySelector('i'); const label = $('#exp-label');
  const baseName = $('#exp-name').value.trim() || expandPattern(settings.screenshotPattern, { url: item.url, title: item.title, date: item.createdAt });
  const job = { ...baseJob(), cmd: kind, pdfLayout: $('#pdf-layout').value, pdfPaper: $('#pdf-paper').value, pdfOrientation: $('#pdf-orient').value, pdfMarginMm: Number($('#pdf-margin').value), pdfSmartBreaks: $('#pdf-smart').checked };
  if (kind === 'jpeg') job.quality = Number($('#jpg-q').value);
  prog.style.display = ''; label.textContent = `Exporting ${kind === 'jpeg' ? 'JPG' : kind.toUpperCase()}…`; bar.style.width = '0%';
  const cancelBtn = $('#exp-cancel'); cancelBtn.style.display = '';
  exporting = job;
  const t0 = performance.now();
  try {
    const res = await runWorker(job, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
    const ext = kind === 'jpeg' ? 'jpg' : kind;
    const files = res.files;
    for (let i = 0; i < files.length; i++) {
      const name = files.length > 1 ? `${baseName}_part${i + 1}of${files.length}` : baseName;
      await downloadBlob(files[i], name, ext, settings);
    }
    const total = files.reduce((a, f) => a + f.size, 0);
    label.textContent = `Saved ${files.length > 1 ? `${files.length} files` : `${ext.toUpperCase()}`} · ${res.width}×${res.height}px${res.pages ? ` · ${res.pages} page(s)` : ''} · ${formatBytes(total)} · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    bar.style.width = '100%';
    if (files.length > 1) toast(`The image exceeds the ${kind === 'jpeg' ? 'JPEG format' : 'browser'} size limit, so it was saved as ${files.length} full-resolution parts.`, '', 7000);
    else toast('Export complete', 'ok');
    window.__lastExport = { kind, width: res.width, height: res.height, sizes: files.map((f) => f.size), pages: res.pages };
  } catch (e) {
    label.textContent = e.message; toast(e.message, 'error', 6000);
    window.__lastExport = { error: e.message };
  } finally {
    exporting = null; cancelBtn.style.display = 'none';
  }
}

async function previewResult() {
  const t = toast('Rendering preview…');
  try {
    const res = await runWorker({ ...baseJob(), cmd: 'preview', maxWidth: 1400 });
    t.remove();
    const url = URL.createObjectURL(res.files[0]);
    modal(h('div', { class: 'col' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Result preview'), h('span', { class: 'muted' }, `${res.width} × ${res.height} px (full-resolution export)`)),
      h('img', { src: url, style: { maxWidth: '100%', border: '1px solid var(--border)' } })), { wide: true, onClose: () => URL.revokeObjectURL(url) });
  } catch (e) { t.remove(); toast(e.message, 'error'); }
}

function updateInfo() {
  const out = outputSize(doc, item.width, item.height);
  const info = $('#out-size'); if (info) info.textContent = `${out.width.toLocaleString()} × ${out.height.toLocaleString()} px`;
  const warn = $('#jpg-warn');
  if (warn) warn.textContent = out.height > 65535 ? `Taller than the JPEG limit (65,535 px): JPG export creates ${Math.ceil(out.height / 65535)} full-resolution parts. PDF keeps it in one file.` : '';
}

function buildSide() {
  const side = $('#side');
  const out = outputSize(doc, item.width, item.height);
  const sel = (id, opts, v) => { const s = h('select', { id }); for (const [val, l] of opts) s.append(h('option', { value: val, selected: String(val) === String(v) }, l)); return s; };
  const name = h('input', { type: 'text', id: 'exp-name', value: expandPattern(settings.screenshotPattern, { url: item.url, title: item.title, date: item.createdAt }) });
  const smart = h('input', { type: 'checkbox', id: 'pdf-smart', checked: settings.pdfSmartBreaks });
  const jpgQ = sel('jpg-q', [[90, '90%'], [95, '95%'], [100, '100% (maximum)']], settings.jpgQuality);
  jpgQ.addEventListener('change', () => saveSettings({ jpgQuality: Number(jpgQ.value) }).then((s) => { settings = s; }));
  const pdfLayout = sel('pdf-layout', [['single', 'Single long page'], ['paged', 'Standard pages (A4 / Letter)']], settings.pdfLayout);
  const pagedOpts = h('div', { class: 'col', id: 'paged-opts' },
    h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', {}, 'Paper'), sel('pdf-paper', [['a4', 'A4'], ['letter', 'Letter']], settings.pdfPaper)),
      h('label', { class: 'field grow' }, h('span', {}, 'Orientation'), sel('pdf-orient', [['portrait', 'Portrait'], ['landscape', 'Landscape']], settings.pdfOrientation))),
    h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', {}, 'Margins (mm)'), h('input', { type: 'number', id: 'pdf-margin', min: 0, max: 50, value: settings.pdfMarginMm })),
      h('label', { class: 'check', style: { marginTop: '16px' } }, smart, 'Smart page breaks')));
  const updPaged = () => { pagedOpts.style.display = pdfLayout.value === 'paged' ? '' : 'none'; };
  pdfLayout.addEventListener('change', updPaged);
  const status = item.status === 'truncated' ? h('div', { class: 'notice warn small' }, 'This capture was limited by the maximum capture height.') : null;
  side.replaceChildren(
    h('div', { class: 'col' }, h('h3', {}, 'Capture'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Captured'), h('dd', {}, formatDate(item.createdAt)),
        h('dt', {}, 'Dimensions'), h('dd', { id: 'src-size' }, `${item.width.toLocaleString()} × ${item.height.toLocaleString()} px`),
        h('dt', {}, 'Page size'), h('dd', {}, `${item.cssWidth?.toLocaleString()} × ${item.cssHeight?.toLocaleString()} CSS px @ ${(+item.scale || 1).toFixed(2)}×`),
        h('dt', {}, 'Stored'), h('dd', {}, `${formatBytes(item.size)} lossless PNG`),
        h('dt', {}, 'Sections'), h('dd', {}, `${item.frames} screenshot(s) · ${item.segments.length} segment(s)`),
        h('dt', {}, 'Status'), h('dd', {}, item.status === 'complete' ? '✓ Complete' : item.status)),
      status, ...(item.warnings || []).map((w) => h('div', { class: 'notice warn small' }, w))),
    h('hr'),
    h('div', { class: 'col', id: 'export-panel' }, h('h3', {}, 'Export'),
      h('div', { class: 'small muted' }, 'Output: ', h('b', { id: 'out-size' }, `${out.width} × ${out.height} px`), ' – full captured resolution'),
      h('label', { class: 'field' }, h('span', {}, 'File name'), name),
      h('label', { class: 'field' }, h('span', {}, 'JPG quality'), jpgQ),
      h('button', { class: 'btn primary', id: 'export-jpg', html: `${icon('download')}<span>Download JPG</span>`, onclick: () => doExport('jpeg') }),
      h('div', { class: 'small muted' }, 'JPG is a lossy format: even at 100% some detail is approximated. Use PNG for pixel-exact copies.'),
      h('div', { class: 'small', id: 'jpg-warn', style: { color: 'var(--warn)' } }),
      h('label', { class: 'field' }, h('span', {}, 'PDF layout'), pdfLayout), pagedOpts,
      h('button', { class: 'btn primary', id: 'export-pdf', html: `${icon('download')}<span>Download PDF</span>`, onclick: () => doExport('pdf') }),
      h('button', { class: 'btn', id: 'export-png', html: `${icon('download')}<span>Download PNG (lossless)</span>`, onclick: () => doExport('png') }),
      h('div', { id: 'exp-progress', class: 'col', style: { display: 'none' } }, h('div', { class: 'progress' }, h('i')), h('div', { class: 'row' }, h('span', { class: 'small grow', id: 'exp-label' }), h('button', { class: 'btn danger', id: 'exp-cancel', style: { display: 'none' }, onclick: () => exporting?.cancel?.() }, 'Cancel')))),
    h('hr'),
    h('div', { class: 'small muted' }, 'Edits are applied to a working copy; the original capture is kept unchanged. ', h('a', { href: '#', onclick: async (e) => { e.preventDefault(); commit((d) => { d.annotations = []; d.crop = null; d.rotation = 0; }); } }, 'Reset all edits')),
  );
  updPaged();
  updateInfo();
}

// ------------------------------------------------------------------ init
async function init() {
  await applyTheme();
  settings = await getSettings();
  item = await getItem(itemId);
  stage = $('#stage');
  if (!item || item.kind !== 'screenshot') { stage.replaceChildren(h('div', { class: 'loading' }, 'This capture was not found. It may have been deleted.')); $('#title').textContent = 'Not found'; return; }
  document.title = `${item.title} – FullPage HD Capture`;
  $('#title').textContent = item.title; const u = $('#url'); u.textContent = item.url; u.href = item.url || '#';
  $('#status').textContent = `${item.width}×${item.height}`;
  segments = [];
  for (const s of item.segments) {
    const blob = await getBlob(s.key);
    if (!blob) { stage.replaceChildren(h('div', { class: 'loading' }, 'Part of this capture is missing from storage.')); return; }
    segments.push({ ...s, blob });
  }
  doc = (await getProject(itemId)) || doc;
  doc.annotations ||= [];
  stage.replaceChildren();
  for (const s of segments) {
    const img = h('img', { src: URL.createObjectURL(s.blob), loading: 'lazy', decoding: 'async', alt: '', draggable: 'false', width: item.width, height: s.height });
    stage.append(img);
  }
  svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'overlay'); svg.setAttribute('viewBox', `0 0 ${item.width} ${item.height}`); svg.setAttribute('preserveAspectRatio', 'none');
  stage.append(svg);
  buildToolbar(); buildSide(); attachInteraction();
  applyZoom(); updateToolbarState(); refreshBlurPatches();
  addEventListener('resize', () => { if (fitMode) applyZoom(); });
  $('#wrap').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault();
    const r = $('#wrap').getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (k === 'delete' || k === 'backspace') { if (selectedId) { commit((d) => { d.annotations = d.annotations.filter((a) => a.id !== selectedId); }); selectedId = null; renderOverlay(); updateToolbarState(); } return; }
    if (k === 'escape') { selectedId = null; tool = 'select'; renderOverlay(); updateToolbarState(); return; }
    const map = { v: 'select', a: 'arrow', r: 'rect', e: 'ellipse', h: 'highlight', t: 'text', p: 'pen', b: 'blur', c: 'crop' };
    if (map[k] && !e.ctrlKey && !e.metaKey) { tool = map[k]; updateToolbarState(); }
  });
  if (params.get('edit')) { tool = 'arrow'; updateToolbarState(); }
  if (params.get('export')) $('#export-panel').scrollIntoView();
  // Allow renaming from the header
  $('#title').title = 'Double-click to rename';
  $('#title').addEventListener('dblclick', async () => {
    const t = prompt('Rename capture', item.title);
    if (t && t.trim()) { item = await updateItem(item.id, { title: t.trim() }); $('#title').textContent = item.title; }
  });
  window.__ready = true;
}

init().catch((e) => { console.error(e); toast(e.message, 'error'); });
