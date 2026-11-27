// Helpers shared by dashboard views.
import { h, icon, send, toast } from '../shared/ui.js';
import { restrictionReason } from '../screenshot/capture-controller.js';
import { getBlob } from '../storage/db.js';
import { formatBytes, formatDate, formatDuration } from '../shared/format.js';

export async function capturableTabs() {
  const tabs = await chrome.tabs.query({});
  const self = chrome.runtime.getURL('');
  return tabs.filter((t) => t.url && !t.url.startsWith(self));
}

export function tabSelect(tabs, selectedId) {
  const s = h('select', { class: 'grow', style: { maxWidth: '520px' } });
  if (!tabs.length) s.append(h('option', { value: '' }, 'No open tabs'));
  for (const t of tabs) {
    const bad = restrictionReason(t.url);
    s.append(h('option', { value: t.id, selected: t.id === selectedId, disabled: !!bad }, `${bad ? '⛔ ' : ''}${t.title || t.url}`.slice(0, 110)));
  }
  return s;
}

/** Ask for host permission (needed because the capture is started from the dashboard, not the popup). */
export async function ensureHostAccess(tab) {
  let origin;
  try { const u = new URL(tab.url); origin = u.protocol === 'file:' ? 'file:///*' : `${u.origin}/*`; } catch { return false; }
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  try {
    return await chrome.permissions.request({ origins: [origin] });
  } catch (e) {
    toast(e.message, 'error'); return false;
  }
}

export async function startTabCapture(tabId, mode) {
  const tab = await chrome.tabs.get(Number(tabId));
  const reason = restrictionReason(tab.url);
  if (reason && mode !== 'visible') throw new Error(reason);
  if (!(await ensureHostAccess(tab))) throw new Error('Site access is required to capture a tab from the dashboard. (Tip: clicking the toolbar icon on the page works without granting access.)');
  await send('capture:start', { mode, tabId: tab.id });
}

export function itemUrl(it) {
  return chrome.runtime.getURL(it.kind === 'video' ? `video-editor.html?id=${encodeURIComponent(it.id)}` : `screenshot.html?id=${encodeURIComponent(it.id)}`);
}

export function captureCard(it, actions = []) {
  const thumb = h('div', { class: 'thumb', title: 'Open' },
    h('span', { class: 'badge kind' }, it.kind === 'video' ? 'VIDEO' : (it.mode === 'visible' ? 'VISIBLE' : it.mode === 'recording-frame' ? 'FRAME' : 'FULL PAGE')),
    it.kind === 'video' ? h('span', { class: 'dur' }, formatDuration(it.duration)) : null);
  thumb.addEventListener('click', () => chrome.tabs.create({ url: itemUrl(it) }));
  if (it.thumbKey) getBlob(it.thumbKey).then((b) => { if (b) thumb.style.backgroundImage = `url(${URL.createObjectURL(b)})`; });
  const res = it.width ? `${it.width}×${it.height}` : '';
  const meta = [formatDate(it.createdAt), (it.format || '').toUpperCase(), formatBytes(it.size), res, it.kind === 'video' && it.fps ? `${it.fps} fps` : ''].filter(Boolean).join(' · ');
  const acts = h('div', { class: 'acts' });
  for (const a of actions) {
    const b = h('button', { class: `btn ghost ${a.cls || ''}`, title: a.title || a.label, html: `${icon(a.icon)}<span>${a.label}</span>` });
    b.addEventListener('click', () => a.run(it));
    acts.append(b);
  }
  return h('div', { class: 'cap-card', 'data-id': it.id }, thumb,
    h('div', { class: 'body' },
      h('div', { class: 'title', title: it.title }, it.title || 'Untitled'),
      it.url ? h('div', { class: 'url', title: it.url }, it.url) : null,
      h('div', { class: 'meta' }, meta),
      it.status && it.status !== 'complete' ? h('div', { class: 'meta', style: { color: 'var(--warn)' } }, it.status) : null),
    actions.length ? acts : null);
}
