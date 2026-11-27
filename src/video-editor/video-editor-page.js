// Video editor page.
// The original recording is never modified: every edit lives in a project (edit decision list +
// overlays) that is rendered live in the preview and re-rendered frame-by-frame on export.
import { $, h, icon, toast, applyTheme, promptText } from '../shared/ui.js';
import { getItem, getBlob, getProject, putProject, updateItem, putBlob, putItem, newId } from '../storage/db.js';
import { getSettings } from '../shared/settings.js';
import { formatBytes, formatDuration } from '../shared/format.js';
import { expandPattern } from '../shared/filenames.js';
import { downloadBlob } from '../shared/downloads.js';
import {
  newProject, rid, outputDuration, outToSrc, srcToOut, segmentOutRanges, splitAt, deleteSegment, trimStartAt, trimEndAt,
  scaledOutputSize, naturalOutputSize, isIdentity, gainAt,
} from './project.js';
import { renderFrame, overlayBounds, drawOverlay } from './render-frame.js';
import { makeThumbnails, computePeaks, probe } from '../timeline/media-analysis.js';

const params = new URLSearchParams(location.search);
const itemId = params.get('id');
const video = $('#src-video'); const camVideo = $('#cam-video');
const canvas = $('#preview'); const ctx = canvas.getContext('2d');
const scratch = document.createElement('canvas');

let item; let settings; let info; let project; let sourceBlob; let webcamBlob = null;
let srcW = 0; let srcH = 0;
const undoStack = []; const redoStack = [];
let tOut = 0; let playing = false; let previewRate = 1;
let selection = null; // {kind:'segment'|'overlay', id}
let tool = 'select'; let cropEditing = false;
let pxPerSec = 40; let thumbs = []; let peaks = null;
let audioCtx = null; let gainNode = null;
let style = { color: '#ef4444', width: 8, fontSize: 60 };

// ------------------------------------------------------------------ project state
const dur = () => outputDuration(project);
function snapshot() { return JSON.stringify(project); }
function commit(fn, { redraw = true } = {}) {
  undoStack.push(snapshot()); if (undoStack.length > 300) undoStack.shift(); redoStack.length = 0;
  fn(project);
  afterChange(redraw);
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); project = JSON.parse(undoStack.pop()); afterChange(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); project = JSON.parse(redoStack.pop()); afterChange(); }
let saveTimer = 0;
function afterChange(redraw = true) {
  tOut = Math.min(tOut, Math.max(0, dur() - 0.001));
  if (selection?.kind === 'segment' && !project.segments.some((s) => s.id === selection.id)) selection = null;
  if (selection?.kind === 'overlay' && !project.overlays.some((o) => o.id === selection.id)) selection = null;
  sizeCanvas(); renderTimeline(); renderPanes(); updateUndo();
  if (redraw) seek(tOut);
  clearTimeout(saveTimer); saveTimer = setTimeout(() => putProject(itemId, project).catch(() => {}), 500);
}
function updateUndo() { $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }

// ------------------------------------------------------------------ preview
function previewSize() {
  const n = naturalOutputSize(project, srcW, srcH);
  const max = settings.previewQuality === 'half' ? 640 : 1280;
  const k = Math.min(1, max / Math.max(n.width, n.height));
  return { w: Math.max(2, Math.round(n.width * k)), h: Math.max(2, Math.round(n.height * k)) };
}
function sizeCanvas() {
  if (cropEditing) {
    const k = Math.min(1, 1280 / Math.max(srcW, srcH));
    canvas.width = Math.round(srcW * k); canvas.height = Math.round(srcH * k);
  } else {
    const { w, h: hh } = previewSize();
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  }
}

function draw() {
  if (!srcW) return;
  if (cropEditing) { drawCropEditor(); return; }
  renderFrame(ctx, video.readyState >= 2 ? video : null, srcW, srcH, canvas.width, canvas.height, project, tOut, dur(), {
    webcamFrame: project.webcam?.visible && camVideo.readyState >= 2 ? camVideo : null, webcamW: camVideo.videoWidth, webcamH: camVideo.videoHeight,
    scratch, selectedId: selection?.kind === 'overlay' ? selection.id : null,
  });
  updateTime();
  if (gainNode) gainNode.gain.value = gainAt(project, tOut, dur());
}

function drawCropEditor() {
  const W = canvas.width; const H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(video, 0, 0, W, H);
  const c = cropDraft || project.crop || { x: 0, y: 0, w: 1, h: 1 };
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(c.x * W, c.y * H, c.w * W, c.h * H); ctx.fill('evenodd');
  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.strokeRect(c.x * W, c.y * H, c.w * W, c.h * H); ctx.setLineDash([]);
  ctx.fillStyle = '#fff'; ctx.font = '600 14px system-ui'; ctx.fillText(`Crop: ${Math.round(c.w * srcW)} × ${Math.round(c.h * srcH)} px — drag to select, then press “Apply crop”`, 12, 22);
}

function updateTime() {
  const el = $('#time'); if (el) el.textContent = `${formatDuration(tOut, true)} / ${formatDuration(dur(), true)}`;
  const ph = $('#playhead'); if (ph) ph.style.left = `${tOut * pxPerSec}px`;
  const pb = $('#play'); if (pb) pb.innerHTML = icon(playing ? 'pause' : 'play');
}

let seekToken = 0;
function seek(t) {
  tOut = Math.max(0, Math.min(t, Math.max(0, dur() - 1 / 120)));
  const { src } = outToSrc(project, tOut);
  const token = ++seekToken;
  const done = () => { if (token === seekToken) draw(); };
  if (Math.abs(video.currentTime - src) > 0.001) {
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = src;
  } else done();
  if (webcamBlob) { const ct = Math.max(0, src + (project.webcam?.offset || 0)); if (Math.abs(camVideo.currentTime - ct) > 0.04) camVideo.currentTime = ct; }
  updateTime();
}

function ensureAudioGraph() {
  if (audioCtx) return;
  try {
    audioCtx = new AudioContext();
    gainNode = audioCtx.createGain();
    audioCtx.createMediaElementSource(video).connect(gainNode).connect(audioCtx.destination);
  } catch { audioCtx = null; gainNode = null; }
}

async function play() {
  if (playing) return;
  ensureAudioGraph(); audioCtx?.resume();
  if (tOut >= dur() - 0.05) seek(0);
  const { seg, src } = outToSrc(project, tOut);
  if (Math.abs(video.currentTime - src) > 0.05) video.currentTime = src;
  video.playbackRate = Math.max(0.0625, Math.min(16, seg.speed * previewRate));
  playing = true;
  try { await video.play(); } catch (e) { playing = false; toast(`Playback failed: ${e.message}`, 'error'); return; }
  if (webcamBlob) camVideo.play().catch(() => {});
  loop();
}
function pause() {
  playing = false; video.pause(); camVideo.pause(); updateTime();
}
function loop() {
  if (!playing) return;
  const src = video.currentTime;
  const { index } = outToSrc(project, tOut);
  let seg = project.segments[index];
  // advance across cuts
  if (src >= seg.end - 0.012 || video.ended) {
    const next = project.segments[index + 1];
    if (!next) { tOut = dur(); pause(); draw(); return; }
    seg = next;
    video.currentTime = next.start;
    video.playbackRate = Math.max(0.0625, Math.min(16, next.speed * previewRate));
    tOut = segmentOutRanges(project)[index + 1].start;
  } else {
    const o = srcToOut(project, src);
    if (o != null) tOut = o;
  }
  if (webcamBlob) { const ct = video.currentTime + (project.webcam?.offset || 0); if (Math.abs(camVideo.currentTime - ct) > 0.15) camVideo.currentTime = Math.max(0, ct); camVideo.playbackRate = video.playbackRate; }
  draw();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ preview interaction (overlays & crop)
let drag = null; let cropDraft = null;
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
}
function visibleOverlays() { return project.overlays.filter((o) => tOut >= o.start && tOut <= o.end); }
function hitOverlay(p) {
  const W = canvas.width; const H = canvas.height;
  const list = visibleOverlays();
  for (let i = list.length - 1; i >= 0; i--) {
    const b = overlayBounds(list[i], W, H, ctx);
    const pad = 8;
    if (p.x * W >= b.x - pad && p.x * W <= b.x + b.w + pad && p.y * H >= b.y - pad && p.y * H <= b.y + b.h + pad) return list[i];
  }
  return null;
}

function newOverlay(type, p) {
  const len = Math.min(4, Math.max(0.5, dur() - tOut));
  const base = { id: rid(), type, start: tOut, end: Math.min(dur(), tOut + len), color: type === 'highlight' ? '#facc15' : style.color, width: style.width };
  if (type === 'arrow') return { ...base, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
  if (type === 'text') return { ...base, x: p.x, y: p.y, w: 0, h: 0, text: 'Text', fontSize: style.fontSize, color: '#ffffff' };
  if (type === 'blur') return { ...base, x: p.x, y: p.y, w: 0, h: 0, mode: 'blur', strength: 14, color: '#000000' };
  return { ...base, x: p.x, y: p.y, w: 0, h: 0, fill: false };
}

canvas.addEventListener('pointerdown', async (e) => {
  if (!srcW) return;
  const p = canvasPoint(e);
  canvas.setPointerCapture(e.pointerId);
  if (cropEditing) { drag = { mode: 'crop', start: p }; return; }
  if (tool === 'select') {
    const hit = hitOverlay(p);
    if (hit) {
      selection = { kind: 'overlay', id: hit.id };
      const b = overlayBounds(hit, canvas.width, canvas.height, ctx);
      const nearCorner = Math.abs(p.x * canvas.width - (b.x + b.w)) < 14 && Math.abs(p.y * canvas.height - (b.y + b.h)) < 14;
      drag = { mode: hit.type === 'arrow' ? (Math.hypot(p.x - hit.x2, p.y - hit.y2) < 0.02 ? 'arrowEnd' : 'move') : nearCorner && hit.type !== 'text' ? 'resize' : 'move', id: hit.id, start: p, orig: { ...hit }, before: snapshot() };
    } else selection = null;
    renderPanes(); renderTimeline(); draw();
    return;
  }
  if (tool === 'text') {
    const text = await promptText('Text overlay', '');
    if (text) { const o = { ...newOverlay('text', p), text }; commit((pr) => pr.overlays.push(o)); selection = { kind: 'overlay', id: o.id }; renderPanes(); }
    tool = 'select'; renderPanes();
    return;
  }
  const o = newOverlay(tool, p);
  drag = { mode: 'create', o };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (tool === 'select' && !cropEditing) { const hit = hitOverlay(canvasPoint(e)); canvas.style.cursor = hit ? 'move' : 'default'; } else canvas.style.cursor = 'crosshair';
    return;
  }
  const p = canvasPoint(e);
  if (drag.mode === 'crop') {
    cropDraft = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
    draw(); return;
  }
  if (drag.mode === 'create') {
    const o = drag.o;
    if (o.type === 'arrow') { o.x2 = p.x; o.y2 = p.y; } else { o.w = Math.abs(p.x - o.x); o.h = Math.abs(p.y - o.y); o._x = Math.min(p.x, drag.o.x); }
    draw();
    // draw the in-progress overlay on top
    const tmp = { ...o, x: o.type === 'arrow' ? o.x : Math.min(p.x, o.x), y: o.type === 'arrow' ? o.y : Math.min(p.y, o.y) };
    drawOverlay(ctx, tmp, canvas.width, canvas.height, scratch, true);
    return;
  }
  const o = project.overlays.find((x) => x.id === drag.id); if (!o) return;
  const dx = p.x - drag.start.x; const dy = p.y - drag.start.y; const orig = drag.orig;
  if (drag.mode === 'move') {
    if (o.type === 'arrow') { o.x1 = orig.x1 + dx; o.y1 = orig.y1 + dy; o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy; } else { o.x = orig.x + dx; o.y = orig.y + dy; }
  } else if (drag.mode === 'resize') { o.w = Math.max(0.01, orig.w + dx); o.h = Math.max(0.01, orig.h + dy); }
  else if (drag.mode === 'arrowEnd') { o.x2 = p.x; o.y2 = p.y; }
  draw();
});
const endDrag = (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.mode === 'crop') return;
  if (d.mode === 'create') {
    const o = d.o; const p = canvasPoint(e);
    if (o.type !== 'arrow') { const x0 = Math.min(o.x, p.x); const y0 = Math.min(o.y, p.y); o.w = Math.abs(p.x - o.x); o.h = Math.abs(p.y - o.y); o.x = x0; o.y = y0; delete o._x; }
    const big = o.type === 'arrow' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) > 0.01 : o.w > 0.01 && o.h > 0.01;
    if (big) { commit((pr) => pr.overlays.push(o)); selection = { kind: 'overlay', id: o.id }; renderPanes(); renderTimeline(); }
    else draw();
    return;
  }
  if (snapshot() !== d.before) { undoStack.push(d.before); redoStack.length = 0; afterChange(); }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', async (e) => {
  const hit = hitOverlay(canvasPoint(e));
  if (hit?.type === 'text') {
    const t = await promptText('Edit text', hit.text);
    if (t != null) commit((pr) => { pr.overlays.find((o) => o.id === hit.id).text = t; });
  }
});

// ------------------------------------------------------------------ timeline
function renderTimeline() {
  const inner = $('#tl-inner'); const labels = $('#tl-labels');
  const D = dur(); const width = Math.max($('#tl-scroll').clientWidth - 20, D * pxPerSec + 40);
  inner.style.width = `${width}px`;
  const ruler = h('div', { class: 'ruler', id: 'ruler' });
  const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pxPerSec >= 70) || 1200;
  for (let t = 0; t <= D + 1e-6; t += step) {
    ruler.append(h('i', { style: { left: `${t * pxPerSec}px` } }), h('span', { style: { left: `${t * pxPerSec}px` } }, formatDuration(t, step < 1)));
  }
  const vTrack = h('div', { class: 'track', id: 'track-video' });
  const aTrack = h('div', { class: 'track', id: 'track-audio' });
  const wTrack = webcamBlob ? h('div', { class: 'track', id: 'track-webcam' }) : null;
  const oTrack = h('div', { class: 'track', id: 'track-overlays' });
  for (const r of segmentOutRanges(project)) {
    const s = r.seg; const left = r.start * pxPerSec; const w = Math.max(3, (r.end - r.start) * pxPerSec);
    const sel = selection?.kind === 'segment' && selection.id === s.id;
    const clip = h('div', { class: `clip video${sel ? ' sel' : ''}`, 'data-seg': s.id, style: { left: `${left}px`, width: `${w}px` }, title: `Source ${formatDuration(s.start, true)} – ${formatDuration(s.end, true)}${s.speed !== 1 ? ` · ${s.speed}×` : ''}` });
    for (const th of thumbs) {
      if (th.t < s.start || th.t > s.end) continue;
      const x = ((th.t - s.start) / s.speed) * pxPerSec - th.w / 2;
      clip.append(h('img', { src: th.url, style: { position: 'absolute', left: `${x}px`, top: '0', height: '100%', opacity: 0.85, pointerEvents: 'none' } }));
    }
    clip.append(h('span', { class: 'lbl' }, `${formatDuration((r.end - r.start), true)}${s.speed !== 1 ? ` · ${s.speed}×` : ''}`));
    clip.addEventListener('pointerdown', (e) => { e.stopPropagation(); selection = { kind: 'segment', id: s.id }; seekFromEvent(e); renderTimeline(); renderPanes(); });
    vTrack.append(clip);
    const ac = h('div', { class: `clip audio${sel ? ' sel' : ''}`, style: { left: `${left}px`, width: `${w}px`, opacity: project.muted ? 0.35 : 1 } });
    if (peaks && info.audioCodec) {
      const cv = h('canvas', { width: Math.min(8000, Math.round(w)), height: 32 });
      const c2 = cv.getContext('2d'); c2.fillStyle = '#5eead4';
      const n = cv.width;
      for (let x = 0; x < n; x++) {
        const src = s.start + ((x / n) * (s.end - s.start));
        const v = peaks.peaks[Math.floor(src / peaks.bucket)] || 0;
        const hh = Math.max(1, Math.min(1, v * project.volume) * 30);
        c2.fillRect(x, 16 - hh / 2, 1, hh);
      }
      ac.append(cv);
    } else ac.append(h('span', { class: 'lbl' }, info.audioCodec ? 'Analysing audio…' : 'No audio'));
    ac.addEventListener('pointerdown', (e) => { e.stopPropagation(); seekFromEvent(e); });
    aTrack.append(ac);
  }
  if (wTrack) {
    const c = h('div', { class: 'clip cam', style: { left: '0px', width: `${D * pxPerSec}px`, opacity: project.webcam?.visible ? 1 : 0.35 } }, h('span', { class: 'lbl' }, project.webcam?.visible ? 'Webcam (separate track)' : 'Webcam hidden'));
    c.addEventListener('pointerdown', (e) => { e.stopPropagation(); seekFromEvent(e); setPane('edit'); });
    wTrack.append(c);
  }
  for (const o of project.overlays) {
    const sel = selection?.kind === 'overlay' && selection.id === o.id;
    const bar = h('div', { class: `ov${sel ? ' sel' : ''}`, 'data-ov': o.id, style: { left: `${o.start * pxPerSec}px`, width: `${Math.max(8, (o.end - o.start) * pxPerSec)}px`, background: o.type === 'blur' ? '#475569' : o.type === 'text' ? '#7c3aed' : '#b45309' } },
      h('span', { class: 'hl' }), `${o.type === 'text' ? `“${o.text}”` : o.type}`, h('span', { class: 'hr' }));
    bar.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      selection = { kind: 'overlay', id: o.id }; setPane('overlay');
      const mode = e.target.classList.contains('hl') ? 'l' : e.target.classList.contains('hr') ? 'r' : 'm';
      const startX = e.clientX; const orig = { start: o.start, end: o.end }; const before = snapshot();
      bar.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const dt = (ev.clientX - startX) / pxPerSec; const D2 = dur();
        const ov = project.overlays.find((x) => x.id === o.id);
        if (mode === 'm') { const len = orig.end - orig.start; ov.start = Math.max(0, Math.min(D2 - len, orig.start + dt)); ov.end = ov.start + len; }
        else if (mode === 'l') ov.start = Math.max(0, Math.min(ov.end - 0.1, orig.start + dt));
        else ov.end = Math.min(D2, Math.max(ov.start + 0.1, orig.end + dt));
        bar.style.left = `${ov.start * pxPerSec}px`; bar.style.width = `${Math.max(8, (ov.end - ov.start) * pxPerSec)}px`;
      };
      const up = () => {
        bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up);
        if (snapshot() !== before) { undoStack.push(before); redoStack.length = 0; afterChange(); } else { renderTimeline(); renderPanes(); draw(); }
      };
      bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up);
    });
    oTrack.append(bar);
  }
  const playhead = h('div', { class: 'playhead', id: 'playhead', style: { left: `${tOut * pxPerSec}px` } });
  inner.replaceChildren(ruler, vTrack, aTrack, ...(wTrack ? [wTrack] : []), oTrack, playhead);
  labels.replaceChildren(
    h('div', { html: `${icon('video')} Video` }), h('div', { html: `${icon('volume')} Audio` }),
    ...(wTrack ? [h('div', { html: `${icon('webcam')} Webcam` })] : []), h('div', { html: `${icon('layers')} Annotations` }));
  const seekDrag = (e) => {
    seekFromEvent(e);
    const mv = (ev) => seekFromEvent(ev);
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  ruler.addEventListener('pointerdown', seekDrag);
  oTrack.addEventListener('pointerdown', (e) => { if (e.target === oTrack) { selection = null; seekDrag(e); renderTimeline(); renderPanes(); } });
}
function seekFromEvent(e) {
  const r = $('#tl-inner').getBoundingClientRect();
  if (playing) pause();
  seek((e.clientX - r.left) / pxPerSec);
}

// ------------------------------------------------------------------ side panes
let pane = 'edit';
function setPane(p) { pane = p; for (const el of document.querySelectorAll('.pane')) el.classList.toggle('show', el.dataset.pane === p); for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('sel', b.dataset.p === p); renderPanes(); }

const fld = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
const btn = (id, ic, label, fn, cls = '') => { const b = h('button', { class: `btn ${cls}`, id, html: `${icon(ic)}<span>${label}</span>` }); b.addEventListener('click', fn); return b; };

function renderPanes() {
  renderEditPane(); renderOverlayPane(); renderAudioPane();
  if (pane === 'export') renderExportPane();
}

function renderEditPane() {
  const el = $('#pane-edit');
  const selSeg = selection?.kind === 'segment' ? project.segments.find((s) => s.id === selection.id) : null;
  const speed = h('select', { id: 'seg-speed', disabled: !selSeg });
  for (const v of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]) speed.append(h('option', { value: v, selected: (selSeg?.speed || 1) === v }, `${v}×`));
  speed.addEventListener('change', () => { if (selSeg) commit((p) => { p.segments.find((s) => s.id === selSeg.id).speed = Number(speed.value); }); });
  const n = naturalOutputSize(project, srcW, srcH);
  const nodes = [
    h('h3', {}, 'Cut'),
    h('div', { class: 'tool-grid' },
      btn('trim-start', 'scissors', 'Trim start', () => { if (tOut > 0.05) commit((p) => trimStartAt(p, tOut)); seek(0); }),
      btn('trim-end', 'scissors', 'Trim end', () => { if (tOut < dur() - 0.05) commit((p) => trimEndAt(p, tOut)); }),
      btn('split', 'split', 'Split', () => { const pr = JSON.parse(snapshot()); if (splitAt(pr, tOut)) commit((p) => splitAt(p, tOut)); else toast('Move the playhead inside a clip to split it.'); }),
      btn('delete-seg', 'trash', 'Delete clip', () => { if (!selSeg) return toast('Select a clip on the timeline first.'); if (project.segments.length < 2) return toast('Split the video first – the last clip cannot be deleted.'); commit((p) => deleteSegment(p, selSeg.id)); }, 'danger')),
    h('div', { class: 'small muted' }, 'Trim and split act at the playhead (red line). Select a clip to delete it or change its speed.'),
    fld(selSeg ? 'Speed of selected clip' : 'Speed (select a clip)', speed),
    h('hr'),
    h('h3', {}, 'Frame'),
    h('div', { class: 'tool-grid' },
      btn('crop', 'crop', cropEditing ? 'Editing…' : 'Crop', () => startCrop(), cropEditing ? 'on' : ''),
      btn('rot-l', 'rotateL', 'Rotate left', () => commit((p) => { p.rotation = ((p.rotation || 0) + 270) % 360; })),
      btn('rot-r', 'rotate', 'Rotate right', () => commit((p) => { p.rotation = ((p.rotation || 0) + 90) % 360; })),
      btn('crop-reset', 'x', 'Reset frame', () => commit((p) => { p.crop = null; p.rotation = 0; }))),
    cropEditing ? h('div', { class: 'row' }, btn('crop-apply', 'check', 'Apply crop', applyCrop, 'primary'), btn('crop-cancel', 'x', 'Cancel', () => { cropEditing = false; cropDraft = null; sizeCanvas(); renderPanes(); draw(); })) : null,
    h('div', { class: 'small muted' }, `Output frame: ${n.width} × ${n.height} px${project.rotation ? ` · rotated ${project.rotation}°` : ''}${project.crop ? ' · cropped' : ''}. The output resolution is chosen in Export.`),
  ];
  if (webcamBlob && project.webcam) {
    const w = project.webcam;
    const vis = h('input', { type: 'checkbox', checked: w.visible, id: 'cam-visible' }); vis.addEventListener('change', () => commit((p) => { p.webcam.visible = vis.checked; }));
    const pos = h('select', { id: 'cam-pos' }); for (const [v, l] of [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']]) pos.append(h('option', { value: v, selected: w.position === v }, l));
    pos.addEventListener('change', () => commit((p) => { p.webcam.position = pos.value; }));
    const shape = h('select', {}, h('option', { value: 'circle', selected: w.shape === 'circle' }, 'Circle'), h('option', { value: 'rect', selected: w.shape === 'rect' }, 'Rectangle'));
    shape.addEventListener('change', () => commit((p) => { p.webcam.shape = shape.value; }));
    const size = h('input', { type: 'range', min: 8, max: 45, value: w.size }); size.addEventListener('change', () => commit((p) => { p.webcam.size = Number(size.value); }));
    const op = h('input', { type: 'range', min: 20, max: 100, value: w.opacity }); op.addEventListener('change', () => commit((p) => { p.webcam.opacity = Number(op.value); }));
    nodes.push(h('hr'), h('h3', {}, 'Webcam overlay'), h('label', { class: 'check' }, vis, 'Show webcam'), h('div', { class: 'rangepair' }, fld('Position', pos), fld('Shape', shape)), h('div', { class: 'rangepair' }, fld('Size', size), fld('Opacity', op)));
  }
  el.replaceChildren(...nodes.filter(Boolean));
}

function startCrop() {
  if (playing) pause();
  cropEditing = true; cropDraft = project.crop ? { ...project.crop } : null;
  sizeCanvas(); renderPanes(); seek(tOut);
}
function applyCrop() {
  const c = cropDraft;
  cropEditing = false; cropDraft = null;
  if (c && c.w > 0.02 && c.h > 0.02) commit((p) => { p.crop = { x: c.x, y: c.y, w: c.w, h: c.h }; });
  else { sizeCanvas(); renderPanes(); draw(); }
}

function renderOverlayPane() {
  const el = $('#pane-overlay');
  const toolBtn = (t, ic, label) => {
    const b = h('button', { class: `btn${tool === t ? ' on' : ''}`, 'data-tool': t, html: `${icon(ic)}<span>${label}</span>` });
    b.addEventListener('click', () => { tool = tool === t ? 'select' : t; renderOverlayPane(); });
    return b;
  };
  const o = selection?.kind === 'overlay' ? project.overlays.find((x) => x.id === selection.id) : null;
  const nodes = [
    h('h3', {}, 'Add to video'),
    h('div', { class: 'tool-grid' }, toolBtn('select', 'select', 'Select'), toolBtn('text', 'text', 'Text'), toolBtn('arrow', 'arrow', 'Arrow'), toolBtn('rect', 'rect', 'Box'),
      toolBtn('ellipse', 'ellipse', 'Circle'), toolBtn('highlight', 'highlight', 'Highlight'), toolBtn('spotlight', 'visible', 'Spotlight'), toolBtn('blur', 'blur', 'Blur')),
    h('div', { class: 'small muted' }, tool === 'select' ? 'Click an item in the preview to select and drag it. Drag the bottom-right corner to resize.' : 'Drag on the preview to place it. It starts at the playhead and lasts 4 s — adjust on the Annotations track.'),
    h('div', { class: 'row' }, fld('Colour', (() => { const c = h('input', { type: 'color', value: style.color }); c.addEventListener('input', () => { style.color = c.value; }); return c; })()),
      fld('Line width', (() => { const r = h('input', { type: 'range', min: 2, max: 30, value: style.width }); r.addEventListener('change', () => { style.width = Number(r.value); }); return r; })())),
  ];
  if (o) {
    const num = (k, step = 0.1) => { const i = h('input', { type: 'number', step, value: Number(o[k]).toFixed(2), style: { width: '100%' } }); i.addEventListener('change', () => commit((p) => { const x = p.overlays.find((v) => v.id === o.id); x[k] = Math.max(0, Math.min(dur(), Number(i.value))); if (x.end <= x.start) x.end = Math.min(dur(), x.start + 0.1); })); return i; };
    const color = h('input', { type: 'color', value: o.color || '#ffffff', id: 'ov-color' }); color.addEventListener('change', () => commit((p) => { p.overlays.find((v) => v.id === o.id).color = color.value; }));
    const width = h('input', { type: 'range', min: 1, max: 40, value: o.width || 6 }); width.addEventListener('change', () => commit((p) => { p.overlays.find((v) => v.id === o.id).width = Number(width.value); }));
    nodes.push(h('hr'), h('h3', {}, `Selected: ${o.type}`),
      h('div', { class: 'rangepair' }, fld('Start (s)', num('start')), fld('End (s)', num('end'))),
      h('div', { class: 'row' }, btn('ov-start-here', 'play', 'Start here', () => commit((p) => { const x = p.overlays.find((v) => v.id === o.id); const len = x.end - x.start; x.start = tOut; x.end = Math.min(dur(), tOut + len); })),
        btn('ov-end-here', 'stop', 'End here', () => commit((p) => { const x = p.overlays.find((v) => v.id === o.id); if (tOut > x.start) x.end = tOut; }))),
      h('div', { class: 'row' }, fld('Colour', color), o.type !== 'text' && o.type !== 'blur' ? fld('Line width', width) : null));
    if (o.type === 'text') {
      const ta = h('textarea', { rows: 3, id: 'ov-text' }); ta.value = o.text;
      ta.addEventListener('change', () => commit((p) => { p.overlays.find((v) => v.id === o.id).text = ta.value; }));
      const fs = h('input', { type: 'range', min: 20, max: 200, value: o.fontSize }); fs.addEventListener('change', () => commit((p) => { p.overlays.find((v) => v.id === o.id).fontSize = Number(fs.value); }));
      const bg = h('input', { type: 'checkbox', checked: !!o.background }); bg.addEventListener('change', () => commit((p) => { p.overlays.find((v) => v.id === o.id).background = bg.checked ? 'rgba(0,0,0,0.6)' : null; }));
      nodes.push(fld('Text', ta), fld('Size', fs), h('label', { class: 'check' }, bg, 'Dark background box'));
    }
    if (o.type === 'rect' || o.type === 'ellipse') {
      const f = h('input', { type: 'checkbox', checked: !!o.fill }); f.addEventListener('change', () => commit((p) => { p.overlays.find((v) => v.id === o.id).fill = f.checked; }));
      nodes.push(h('label', { class: 'check' }, f, 'Fill'));
    }
    if (o.type === 'blur') {
      const m = h('select', {}, ...[['blur', 'Blur'], ['pixelate', 'Pixelate'], ['solid', 'Solid box']].map(([v, l]) => h('option', { value: v, selected: o.mode === v }, l)));
      m.addEventListener('change', () => commit((p) => { p.overlays.find((v) => v.id === o.id).mode = m.value; }));
      const s = h('input', { type: 'range', min: 4, max: 60, value: o.strength }); s.addEventListener('change', () => commit((p) => { p.overlays.find((v) => v.id === o.id).strength = Number(s.value); }));
      nodes.push(h('div', { class: 'rangepair' }, fld('Style', m), fld('Strength', s)));
    }
    nodes.push(h('div', { class: 'row' },
      btn('ov-dup', 'layers', 'Duplicate', () => { const c = { ...JSON.parse(JSON.stringify(o)), id: rid() }; commit((p) => p.overlays.push(c)); selection = { kind: 'overlay', id: c.id }; renderPanes(); }),
      btn('ov-del', 'trash', 'Delete', () => { commit((p) => { p.overlays = p.overlays.filter((v) => v.id !== o.id); }); selection = null; renderPanes(); }, 'danger')));
  }
  el.replaceChildren(...nodes.filter(Boolean));
}

function renderAudioPane() {
  const el = $('#pane-audio');
  const mute = h('input', { type: 'checkbox', checked: project.muted, id: 'aud-mute' }); mute.addEventListener('change', () => commit((p) => { p.muted = mute.checked; }));
  const vol = h('input', { type: 'range', min: 0, max: 200, value: Math.round(project.volume * 100), id: 'aud-vol' });
  const volLbl = h('b', {}, `${Math.round(project.volume * 100)}%`);
  vol.addEventListener('input', () => { volLbl.textContent = `${vol.value}%`; });
  vol.addEventListener('change', () => commit((p) => { p.volume = Number(vol.value) / 100; }));
  const fi = h('input', { type: 'number', min: 0, max: 10, step: 0.25, value: project.fadeIn, id: 'fade-in' }); fi.addEventListener('change', () => commit((p) => { p.fadeIn = Math.max(0, Math.min(dur() / 2, Number(fi.value))); }));
  const fo = h('input', { type: 'number', min: 0, max: 10, step: 0.25, value: project.fadeOut, id: 'fade-out' }); fo.addEventListener('change', () => commit((p) => { p.fadeOut = Math.max(0, Math.min(dur() / 2, Number(fo.value))); }));
  el.replaceChildren(
    h('h3', {}, 'Audio'),
    info.audioCodec ? null : h('div', { class: 'notice small' }, 'This recording has no audio track.'),
    h('label', { class: 'check' }, mute, 'Mute audio'),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Volume'), volLbl), vol,
    h('hr'), h('h3', {}, 'Fades (picture + sound)'),
    h('div', { class: 'rangepair' }, fld('Fade in (s)', fi), fld('Fade out (s)', fo)),
    h('div', { class: 'small muted' }, 'Clip speed changes resample the audio (pitch changes with speed).'));
}

// ------------------------------------------------------------------ export
const BPP = { standard: 0.06, high: 0.12, max: 0.25 };
let exportWorker = null;
function sourceFps() { return Math.max(1, Math.round(item.targetFps || item.fps || info.fps || 30)); }

function exportPlan(opts) {
  const size = scaledOutputSize(project, srcW, srcH, opts.resolution);
  const sfps = sourceFps();
  const fps = opts.fps === 'source' ? Math.min(60, sfps) : Math.min(Number(opts.fps), Math.max(sfps, 1));
  const vbr = Math.round(Math.min(80e6, Math.max(0.8e6, size.width * size.height * fps * (BPP[opts.quality] || BPP.high))));
  const abr = opts.quality === 'max' ? 192000 : 128000;
  const hasAudio = opts.audio && !!info.audioCodec && !project.muted;
  const est = ((vbr + (hasAudio ? abr : 0)) * dur()) / 8;
  return { ...size, fps, vbr, abr, hasAudio, est };
}

function renderExportPane() {
  const el = $('#pane-export');
  if (el.dataset.busy === '1') return;
  const opts = { format: settings.exportFormat, resolution: settings.exportResolution, fps: settings.exportFps, quality: settings.exportQuality, audio: true };
  const n = naturalOutputSize(project, srcW, srcH);
  const short = Math.min(n.width, n.height);
  const sel = (id, list, v) => { const s = h('select', { id }); for (const [val, l] of list) s.append(h('option', { value: val, selected: String(val) === String(v) }, l)); return s; };
  const format = sel('exp-format', [['webm', 'WebM (VP9 + Opus)'], ['mp4', 'MP4 (H.264 + AAC)']], opts.format);
  const res = sel('exp-res', [['source', `Same as source (${n.width}×${n.height})`], ...[2160, 1440, 1080, 720, 480].filter((r) => r < short).map((r) => [r, `${r}p`])], opts.resolution);
  const sfps = sourceFps();
  const fps = sel('exp-fps', [['source', `Source (${sfps} fps)`], ...[60, 30, 24].filter((f) => f < sfps).map((f) => [f, `${f} fps`])], opts.fps);
  const quality = sel('exp-quality', [['standard', 'Standard'], ['high', 'High'], ['max', 'Maximum']], opts.quality);
  const audio = h('input', { type: 'checkbox', id: 'exp-audio', checked: !!info.audioCodec && !project.muted, disabled: !info.audioCodec });
  const name = h('input', { type: 'text', id: 'exp-name', value: expandPattern(settings.videoPattern, { url: item.url, title: item.title, date: item.createdAt }) });
  const summary = h('div', { class: 'notice small', id: 'exp-summary' });
  const ident = isIdentity(project);
  const upd = () => {
    const o = { format: format.value, resolution: res.value, fps: fps.value, quality: quality.value, audio: audio.checked };
    const pl = exportPlan(o);
    const copy = ident && o.resolution === 'source' && o.fps === 'source' && o.format === item.format;
    summary.textContent = copy
      ? `No edits: the original ${item.format.toUpperCase()} file (${formatBytes(item.size)}) is saved unchanged — no re-encoding, no quality loss.`
      : `${pl.width}×${pl.height} · ${pl.fps} fps · ${(pl.vbr / 1e6).toFixed(1)} Mbps video${pl.hasAudio ? ` + ${pl.abr / 1000} kbps audio` : ' · no audio'} · ${formatDuration(dur())} · estimated ${formatBytes(pl.est)}`;
  };
  for (const c of [format, res, fps, quality, audio]) c.addEventListener('change', upd);
  upd();
  const prog = h('div', { class: 'col', id: 'exp-progress', style: { display: 'none' } }, h('div', { class: 'progress' }, h('i')), h('span', { class: 'small', id: 'exp-status' }));
  const go = btn('exp-go', 'download', 'Export video', () => runExport({ format: format.value, resolution: res.value, fps: fps.value, quality: quality.value, audio: audio.checked, name: name.value }), 'primary');
  const cancel = btn('exp-cancel', 'x', 'Cancel', () => { exportWorker?.postMessage({ type: 'cancel' }); }, 'danger');
  cancel.style.display = 'none';
  el.replaceChildren(h('h3', {}, 'Export'),
    fld('Format', format), fld('Resolution', res), fld('Frame rate', fps), fld('Quality', quality),
    h('label', { class: 'check' }, audio, 'Include audio'), fld('File name', name), summary,
    h('div', { class: 'row' }, go, cancel), prog,
    h('div', { class: 'small muted' }, 'Video is re-encoded locally with the browser’s WebCodecs encoders. MP4 is a real H.264 encode, not a renamed WebM. Output is never upscaled beyond the source resolution or frame rate.'),
    h('hr'), btn('dl-original', 'download', `Download original (${item.format.toUpperCase()}, ${formatBytes(item.size)})`, () => downloadBlob(sourceBlob, expandPattern(settings.videoPattern, { url: item.url, title: item.title, date: item.createdAt }), item.format, settings).catch((e) => toast(e.message, 'error'))));
}

async function runExport(o) {
  const el = $('#pane-export'); const prog = $('#exp-progress'); const bar = prog.querySelector('i'); const status = $('#exp-status');
  const plan = exportPlan(o);
  const name = o.name.trim() || expandPattern(settings.videoPattern, { url: item.url, title: item.title, date: item.createdAt });
  if (isIdentity(project) && o.resolution === 'source' && o.fps === 'source' && o.format === item.format) {
    await downloadBlob(sourceBlob, name, item.format, settings).catch((e) => toast(e.message, 'error'));
    window.__lastVideoExport = { copied: true, size: sourceBlob.size };
    return;
  }
  if (playing) pause();
  el.dataset.busy = '1'; prog.style.display = ''; $('#exp-go').disabled = true; $('#exp-cancel').style.display = '';
  status.textContent = 'Preparing…'; bar.style.width = '0%';
  const t0 = performance.now();
  exportWorker = new Worker('video-export-worker.js', { type: 'module' });
  const result = await new Promise((resolve) => {
    exportWorker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        bar.style.width = `${Math.round(m.progress * 100)}%`;
        const el2 = (performance.now() - t0) / 1000; const eta = m.progress > 0.02 ? el2 / m.progress - el2 : null;
        status.textContent = `Encoding ${Math.round(m.progress * 100)}%${eta != null ? ` · about ${formatDuration(eta)} left` : ''}`;
      } else resolve(m);
    };
    exportWorker.onerror = (e) => resolve({ type: 'error', message: e.message || 'Export worker crashed' });
    exportWorker.postMessage({
      type: 'export', project: JSON.parse(snapshot()), source: sourceBlob, webcam: webcamBlob,
      opts: { format: o.format, width: plan.width, height: plan.height, fps: plan.fps, videoBitrate: plan.vbr, audioBitrate: plan.abr, audio: plan.hasAudio },
    });
  });
  exportWorker.terminate(); exportWorker = null;
  el.dataset.busy = '0'; $('#exp-cancel').style.display = 'none'; $('#exp-go').disabled = false;
  if (result.type === 'error') {
    status.textContent = result.message; toast(result.message, 'error', 7000);
    window.__lastVideoExport = { error: result.message };
    return;
  }
  bar.style.width = '100%';
  const file = result.file;
  const ext = o.format === 'mp4' ? 'mp4' : 'webm';
  // Save the edited result as a new history item (the original stays untouched)
  const id = newId('edit');
  const blob = new Blob([file], { type: result.mimeType });
  await putBlob(`${id}:video`, blob);
  const tc = document.createElement('canvas'); tc.width = 320; tc.height = Math.max(1, Math.round(320 * canvas.height / canvas.width));
  tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
  const thumb = await new Promise((r) => tc.toBlob(r, 'image/jpeg', 0.8));
  await putBlob(`${id}:thumb`, thumb);
  await putItem({ id, kind: 'video', title: `${item.title} (edited)`, url: item.url, createdAt: Date.now(), duration: result.duration, width: result.width, height: result.height, fps: result.fps, targetFps: result.fps, format: ext, mimeType: result.mimeType, size: blob.size, blobKey: `${id}:video`, thumbKey: `${id}:thumb`, parentId: item.id, source: 'edit', status: 'complete', warnings: result.warnings || [] });
  try { const root = await navigator.storage.getDirectory(); await root.removeEntry(result.tmpName); } catch { /* ignore */ }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  status.textContent = `Done in ${secs} s · ${result.width}×${result.height} · ${result.fps} fps · ${result.vCodec.toUpperCase()}${result.aCodec ? ` + ${result.aCodec.toUpperCase()}` : ''} · ${formatBytes(blob.size)}. Saved to Capture History.`;
  for (const w of result.warnings || []) toast(w, '', 8000);
  window.__lastVideoExport = { ...result, file: undefined, size: blob.size, itemId: id };
  try { await downloadBlob(blob, name, ext, settings); } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ chrome
function buildChrome() {
  $('#undo').innerHTML = icon('undo'); $('#redo').innerHTML = icon('redo');
  $('#undo').addEventListener('click', undo); $('#redo').addEventListener('click', redo);
  $('#open-export').addEventListener('click', () => setPane('export'));
  const tabs = $('#tabs');
  for (const [p, l] of [['edit', 'Edit'], ['overlay', 'Annotate'], ['audio', 'Audio'], ['export', 'Export']]) {
    const b = h('button', { 'data-p': p }, l); b.addEventListener('click', () => setPane(p)); tabs.append(b);
  }
  const tr = $('#transport');
  const speed = h('select', { id: 'preview-speed', title: 'Preview playback speed' }); for (const v of [0.5, 1, 1.5, 2]) speed.append(h('option', { value: v, selected: v === 1 }, `${v}×`));
  speed.addEventListener('change', () => { previewRate = Number(speed.value); if (playing) { const { seg } = outToSrc(project, tOut); video.playbackRate = seg.speed * previewRate; } });
  tr.append(
    btn('play', 'play', '', () => (playing ? pause() : play())),
    btn('back5', 'rotateL', '5 s', () => seek(tOut - 5)), btn('fwd5', 'rotate', '5 s', () => seek(tOut + 5)),
    btn('frame-back', 'undo', 'Frame', () => { pause(); seek(tOut - 1 / sourceFps()); }), btn('frame-fwd', 'redo', 'Frame', () => { pause(); seek(tOut + 1 / sourceFps()); }),
    h('span', { class: 'time', id: 'time' }), h('span', { class: 'grow' }), h('label', { class: 'small muted row' }, 'Speed', speed),
    btn('fullscreen', 'fullscreen', 'Fullscreen', () => $('#preview-area').requestFullscreen?.()));
  const bar = $('#tl-bar');
  const zoom = h('input', { type: 'range', min: 2, max: 400, value: pxPerSec, id: 'tl-zoom' });
  zoom.addEventListener('input', () => { pxPerSec = Number(zoom.value); renderTimeline(); });
  bar.append(btn('tl-split', 'split', 'Split at playhead', () => $('#split').click()), btn('tl-del', 'trash', 'Delete clip', () => $('#delete-seg').click()),
    h('span', { class: 'grow' }), h('span', { class: 'small muted' }, 'Zoom'), zoom);
  addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); playing ? pause() : play(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (k === 'ArrowLeft') seek(tOut - (e.shiftKey ? 1 : 1 / sourceFps()));
    else if (k === 'ArrowRight') seek(tOut + (e.shiftKey ? 1 : 1 / sourceFps()));
    else if (k === 's' || k === 'S') $('#split').click();
    else if (k === 'Delete' || k === 'Backspace') {
      if (selection?.kind === 'overlay') { commit((p) => { p.overlays = p.overlays.filter((o) => o.id !== selection.id); }); selection = null; renderPanes(); }
      else if (selection?.kind === 'segment') $('#delete-seg').click();
    } else if (k === 'Escape') { tool = 'select'; selection = null; if (cropEditing) { cropEditing = false; cropDraft = null; sizeCanvas(); } renderPanes(); renderTimeline(); draw(); }
  });
  $('#title').addEventListener('dblclick', async () => {
    const t = await promptText('Rename recording', item.title);
    if (t && t.trim()) { item = await updateItem(item.id, { title: t.trim() }); $('#title').textContent = item.title; }
  });
  addEventListener('resize', () => renderTimeline());
}

function waitMeta(v) {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 1) { resolve(); return; }
    v.addEventListener('loadedmetadata', () => resolve(), { once: true });
    v.addEventListener('error', () => reject(new Error(v.error?.message || 'The video could not be loaded')), { once: true });
  });
}

async function init() {
  await applyTheme();
  settings = await getSettings();
  buildChrome();
  item = await getItem(itemId);
  if (!item || item.kind !== 'video') { $('#loading').textContent = 'Recording not found. It may have been deleted.'; return; }
  document.title = `${item.title} – Video Editor`;
  $('#title').textContent = item.title;
  sourceBlob = await getBlob(item.blobKey);
  if (!sourceBlob) { $('#loading').textContent = 'The video data is missing from storage.'; return; }
  if (item.webcamBlobKey) webcamBlob = await getBlob(item.webcamBlobKey);
  try { info = await probe(sourceBlob); } catch (e) { info = { duration: item.duration, audioCodec: item.audio?.mic || item.audio?.source ? 'opus' : null, width: item.width, height: item.height }; console.warn(e); }
  if (info.canDecode === false) toast('This browser cannot decode the video codec; preview may work but export will fail.', 'error', 8000);
  video.src = URL.createObjectURL(sourceBlob);
  await waitMeta(video);
  srcW = video.videoWidth || info.width; srcH = video.videoHeight || info.height;
  const duration = Number.isFinite(info.duration) && info.duration > 0 ? info.duration : (Number.isFinite(video.duration) ? video.duration : item.duration);
  if (webcamBlob) { camVideo.src = URL.createObjectURL(webcamBlob); await waitMeta(camVideo).catch(() => { webcamBlob = null; }); }
  project = (await getProject(itemId)) || newProject(duration, item);
  if (!project.webcam && webcamBlob) project.webcam = newProject(duration, item).webcam;
  $('#src-info').textContent = `${srcW}×${srcH} · ${formatDuration(duration)} · ${(item.format || '').toUpperCase()} ${info.videoCodec ? `(${info.videoCodec}${info.audioCodec ? ` + ${info.audioCodec}` : ''})` : ''} · ${formatBytes(item.size)}`;
  $('#loading').remove();
  setPane(params.get('export') ? 'export' : 'edit');
  afterChange();
  undoStack.length = 0; updateUndo();
  video.addEventListener('seeked', () => { if (!playing) draw(); });
  video.addEventListener('loadeddata', () => draw(), { once: true });
  window.__editorReady = true;
  // Background analysis for the timeline
  makeThumbnails(sourceBlob, duration).then((t) => { thumbs = t; renderTimeline(); }).catch(() => {});
  if (info.audioCodec) computePeaks(sourceBlob, duration, 0.05, (pk) => { peaks = { peaks: pk, bucket: 0.05 }; }).then((pk) => { peaks = pk; renderTimeline(); }).catch(() => {});
}

// test hooks (used by automated tests; harmless for users)
window.__editor = {
  get project() { return project; }, set project(p) { project = p; afterChange(); },
  commit, seek, play, pause, runExport, get tOut() { return tOut; }, splitAt: (t) => commit((p) => splitAt(p, t)),
};

init().catch((e) => { console.error(e); const l = $('#loading'); if (l) l.textContent = `Could not open the recording: ${e.message}`; toast(e.message, 'error'); });
