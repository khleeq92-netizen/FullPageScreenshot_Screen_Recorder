// Capture History: list, filter, preview/open, edit, export again, rename, delete, recover.
import { h, icon, toast, promptText, confirmDialog } from '../shared/ui.js';
import { listItems, updateItem, deleteItem, clearAll, listChunkSets, getChunks, deleteChunks, putBlob, putItem } from '../storage/db.js';
import { captureCard, itemUrl } from '../app/common.js';
import { formatBytes, formatDate } from '../shared/format.js';
import { fixWebmDuration } from '../screen-recorder/webm-duration.js';

function playableDuration(blob) {
  return new Promise((resolve) => {
    const v = document.createElement('video'); const url = URL.createObjectURL(blob);
    let t = setTimeout(() => finish(null), 8000);
    const finish = (r) => { clearTimeout(t); t = null; URL.revokeObjectURL(url); v.removeAttribute('src'); resolve(r); };
    v.muted = true; v.preload = 'metadata';
    v.onloadedmetadata = () => {
      if (v.duration !== Infinity) { finish({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); return; }
      v.currentTime = 1e9;
      v.ontimeupdate = () => { v.ontimeupdate = null; finish({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); };
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

export async function renderHistory({ view, head }) {
  let filter = 'all'; let query = ''; let sort = 'new';
  const list = h('div', {});
  const usage = h('span', { class: 'muted small', id: 'storage-usage' });
  const recovery = h('div', { id: 'recovery' });

  const actions = [
    { icon: 'open', label: 'Open', title: 'Preview / open', run: (i) => chrome.tabs.create({ url: itemUrl(i) }) },
    { icon: 'editor', label: 'Edit', run: (i) => chrome.tabs.create({ url: `${itemUrl(i)}&edit=1` }) },
    { icon: 'download', label: 'Export', title: 'Export again', run: (i) => chrome.tabs.create({ url: `${itemUrl(i)}&export=1` }) },
    {
      icon: 'rename', label: 'Rename', run: async (i) => {
        const t = await promptText('Rename capture', i.title);
        if (t != null && t.trim()) { await updateItem(i.id, { title: t.trim() }); refresh(); }
      },
    },
    {
      icon: 'trash', label: 'Delete', cls: 'danger', run: async (i) => {
        if (await confirmDialog('Delete capture?', `“${i.title}” and its media will be removed from this computer.`, 'Delete', true)) { await deleteItem(i.id); toast('Deleted'); refresh(); }
      },
    },
  ];

  async function refresh() {
    let items = await listItems();
    const total = items.length;
    if (filter !== 'all') items = items.filter((i) => i.kind === filter);
    if (query) { const q = query.toLowerCase(); items = items.filter((i) => `${i.title} ${i.url}`.toLowerCase().includes(q)); }
    if (sort === 'old') items.reverse();
    if (sort === 'size') items.sort((a, b) => (b.size || 0) - (a.size || 0));
    list.replaceChildren(items.length ? h('div', { class: 'cards' }, items.map((it) => captureCard(it, actions))) : h('div', { class: 'empty' }, total ? 'No captures match.' : 'Your captures will appear here.'));
    try {
      const est = await navigator.storage.estimate();
      usage.textContent = `${total} capture(s) · ${formatBytes(est.usage)} used locally`;
    } catch { usage.textContent = `${total} capture(s)`; }
    renderRecovery();
  }

  async function renderRecovery() {
    const { recState } = await chrome.storage.session.get('recState');
    const sets = await listChunkSets();
    const ids = Object.keys(sets).filter((id) => !id.endsWith('_cam') && !(recState?.active && recState.recId === id));
    if (!ids.length) { recovery.replaceChildren(); return; }
    recovery.replaceChildren(h('div', { class: 'notice warn col', style: { marginBottom: '16px' } },
      h('b', {}, 'Unfinished recordings found'),
      h('span', {}, 'A recording was interrupted (for example the browser closed). The data recorded so far can be recovered if it is playable.'),
      ...ids.map((id) => {
        const info = sets[id];
        const rec = h('button', { class: 'btn primary' }, 'Recover');
        const del = h('button', { class: 'btn danger' }, 'Discard');
        rec.addEventListener('click', async () => {
          rec.disabled = true; rec.textContent = 'Checking…';
          const chunks = await getChunks(id);
          let blob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
          const meta = await playableDuration(blob);
          if (!meta || !(meta.duration > 0) || !meta.width) {
            toast('This data is not playable and cannot be recovered.', 'error'); rec.textContent = 'Not recoverable'; return;
          }
          if (blob.type.includes('webm')) blob = await fixWebmDuration(blob, meta.duration * 1000);
          await putBlob(`${id}:video`, blob);
          const cam = await getChunks(`${id}_cam`);
          let webcamBlobKey = null;
          if (cam.length) { webcamBlobKey = `${id}:webcam`; await putBlob(webcamBlobKey, new Blob(cam, { type: 'video/webm' })); }
          await putItem({ id, kind: 'video', title: `Recovered recording (${formatDate(info.lastAt || Date.now())})`, url: '', createdAt: info.lastAt || Date.now(), duration: meta.duration, width: meta.width, height: meta.height, format: blob.type.includes('mp4') ? 'mp4' : 'webm', mimeType: blob.type, size: blob.size, blobKey: `${id}:video`, webcamBlobKey, thumbKey: null, status: 'recovered', warnings: ['Recovered after an interruption; the end of the recording may be missing.'] });
          await deleteChunks(id); await deleteChunks(`${id}_cam`);
          toast('Recording recovered', 'ok'); refresh();
        });
        del.addEventListener('click', async () => { await deleteChunks(id); await deleteChunks(`${id}_cam`); refresh(); });
        return h('div', { class: 'row' }, h('span', { class: 'grow' }, `${formatDate(info.lastAt)} · ${info.count} chunk(s) · ${formatBytes(info.bytes)}`), rec, del);
      })));
  }

  const seg = h('div', { class: 'seg', id: 'hist-filter' });
  for (const [v, l] of [['all', 'All'], ['screenshot', 'Screenshots'], ['video', 'Videos']]) {
    const b = h('button', { class: v === filter ? 'sel' : '' }, l);
    b.addEventListener('click', () => { filter = v; [...seg.children].forEach((c) => c.classList.toggle('sel', c === b)); refresh(); });
    seg.append(b);
  }
  const search = h('input', { type: 'text', placeholder: 'Search title or URL…', id: 'hist-search' });
  search.addEventListener('input', () => { query = search.value; refresh(); });
  const sortSel = h('select', {}, h('option', { value: 'new' }, 'Newest first'), h('option', { value: 'old' }, 'Oldest first'), h('option', { value: 'size' }, 'Largest first'));
  sortSel.addEventListener('change', () => { sort = sortSel.value; refresh(); });
  const clear = h('button', { class: 'btn danger', id: 'hist-clear', html: `${icon('trash')}<span>Clear history</span>` });
  clear.addEventListener('click', async () => {
    if (await confirmDialog('Clear capture history?', 'All screenshots, recordings and edits stored by the extension will be permanently deleted from this computer.', 'Delete everything', true)) {
      await clearAll(); toast('History cleared'); refresh();
    }
  });
  view.replaceChildren(head('Capture History', 'Everything is stored locally in this browser profile (IndexedDB). Nothing is uploaded.', clear),
    recovery, h('div', { class: 'row wrap', style: { marginBottom: '14px' } }, seg, search, sortSel, h('span', { class: 'grow' }), usage), list);
  await refresh();
}
