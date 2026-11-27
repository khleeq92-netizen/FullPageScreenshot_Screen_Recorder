// IndexedDB storage layer. Usable from the service worker, offscreen document, pages and workers.
// Large media is stored as Blobs (Chrome keeps large IDB blobs as separate files on disk, not in memory).
//
// Stores:
//   items    – capture history metadata ({id, kind:'screenshot'|'video', ...})
//   blobs    – binary media keyed by string ({key, blob})
//   chunks   – in-progress recording chunks ({recId, seq, blob}) – crash-safe, assembled on stop
//   projects – editor documents (screenshot edits / video edit decision lists) keyed by itemId

const DB_NAME = 'fullpage-hd-capture';
const DB_VERSION = 1;
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('chunks')) {
        const c = db.createObjectStore('chunks', { keyPath: ['recId', 'seq'] });
        c.createIndex('recId', 'recId');
      }
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'itemId' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export function newId(prefix = 'c') {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${rnd[0].toString(36)}${rnd[1].toString(36)}`;
}

// ---- items ----
export const putItem = (item) => tx(['items'], 'readwrite', (t) => promisify(t.objectStore('items').put(item)));
export const getItem = (id) => tx(['items'], 'readonly', (t) => promisify(t.objectStore('items').get(id)));
export async function listItems() {
  const all = await tx(['items'], 'readonly', (t) => promisify(t.objectStore('items').getAll()));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function updateItem(id, patch) {
  return tx(['items'], 'readwrite', async (t) => {
    const s = t.objectStore('items');
    const cur = await promisify(s.get(id));
    if (!cur) throw new Error('Item not found');
    const next = { ...cur, ...patch };
    await promisify(s.put(next));
    return next;
  });
}

/** Delete an item and every blob/project it references. */
export async function deleteItem(id) {
  const item = await getItem(id);
  if (!item) return;
  const keys = blobKeysOf(item);
  await tx(['items', 'blobs', 'projects'], 'readwrite', (t) => {
    t.objectStore('items').delete(id);
    t.objectStore('projects').delete(id);
    for (const k of keys) t.objectStore('blobs').delete(k);
  });
}

export function blobKeysOf(item) {
  const keys = [];
  if (item.blobKey) keys.push(item.blobKey);
  if (item.thumbKey) keys.push(item.thumbKey);
  if (item.webcamBlobKey) keys.push(item.webcamBlobKey);
  for (const s of item.segments || []) if (s.key) keys.push(s.key);
  return keys;
}

// ---- blobs ----
export const putBlob = (key, blob) => tx(['blobs'], 'readwrite', (t) => promisify(t.objectStore('blobs').put({ key, blob })));
export async function getBlob(key) {
  const r = await tx(['blobs'], 'readonly', (t) => promisify(t.objectStore('blobs').get(key)));
  return r ? r.blob : null;
}
export const deleteBlob = (key) => tx(['blobs'], 'readwrite', (t) => promisify(t.objectStore('blobs').delete(key)));

// ---- recording chunks ----
export const putChunk = (recId, seq, blob) => tx(['chunks'], 'readwrite', (t) => promisify(t.objectStore('chunks').put({ recId, seq, blob, at: Date.now() })));
export async function getChunks(recId) {
  const rows = await tx(['chunks'], 'readonly', (t) => promisify(t.objectStore('chunks').index('recId').getAll(recId)));
  return rows.sort((a, b) => a.seq - b.seq).map((r) => r.blob);
}
export async function deleteChunks(recId) {
  return tx(['chunks'], 'readwrite', (t) => {
    const idx = t.objectStore('chunks').index('recId');
    const req = idx.openKeyCursor(IDBKeyRange.only(recId));
    req.onsuccess = () => {
      const c = req.result;
      if (c) { t.objectStore('chunks').delete(c.primaryKey); c.continue(); }
    };
  });
}
/** Returns {recId: {count, bytes, lastAt}} for chunk sets left behind (e.g. after a crash). */
export async function listChunkSets() {
  const rows = await tx(['chunks'], 'readonly', (t) => promisify(t.objectStore('chunks').getAll()));
  const sets = {};
  for (const r of rows) {
    const s = (sets[r.recId] ||= { count: 0, bytes: 0, lastAt: 0 });
    s.count++; s.bytes += r.blob.size; s.lastAt = Math.max(s.lastAt, r.at || 0);
  }
  return sets;
}

// ---- projects ----
export const putProject = (itemId, data) => tx(['projects'], 'readwrite', (t) => promisify(t.objectStore('projects').put({ itemId, data, savedAt: Date.now() })));
export async function getProject(itemId) {
  const r = await tx(['projects'], 'readonly', (t) => promisify(t.objectStore('projects').get(itemId)));
  return r ? r.data : null;
}

/** Remove everything: history, media, unfinished chunks and projects. */
export async function clearAll() {
  await tx(['items', 'blobs', 'chunks', 'projects'], 'readwrite', (t) => {
    for (const s of ['items', 'blobs', 'chunks', 'projects']) t.objectStore(s).clear();
  });
}

/** Remove orphaned blobs not referenced by any item and leftover chunks (temporary files). */
export async function cleanupTemporary({ keepRecId = null } = {}) {
  const items = await listItems();
  const referenced = new Set(items.flatMap(blobKeysOf));
  const keys = await tx(['blobs'], 'readonly', (t) => promisify(t.objectStore('blobs').getAllKeys()));
  const orphans = keys.filter((k) => !referenced.has(k) && !String(k).startsWith('pending:'));
  const sets = await listChunkSets();
  await tx(['blobs'], 'readwrite', (t) => { for (const k of orphans) t.objectStore('blobs').delete(k); });
  let chunkSets = 0;
  for (const recId of Object.keys(sets)) {
    if (recId === keepRecId) continue;
    await deleteChunks(recId); chunkSets++;
  }
  // Origin-private file system scratch files (video export temp output)
  let opfsFiles = 0;
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) {
      if (name.startsWith('tmp-')) { await root.removeEntry(name).catch(() => {}); opfsFiles++; }
    }
  } catch { /* OPFS unavailable in this context */ }
  return { orphanBlobs: orphans.length, chunkSets, opfsFiles };
}
