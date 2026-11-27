// Filename generation and sanitisation.
const pad = (n) => String(n).padStart(2, '0');

export function siteName(url, title) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').pop() || 'File').replace(/\.[a-z0-9]+$/i, '');
    let h = u.hostname.replace(/^www\d?\./, '');
    const parts = h.split('.');
    // google.com -> Google, docs.github.com -> Github, bbc.co.uk -> Bbc
    let main = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (!main) main = title || 'Page';
    return main.charAt(0).toUpperCase() + main.slice(1);
  } catch {
    return (title || 'Page').slice(0, 40);
  }
}

/** Remove characters that are invalid in Windows/macOS/Linux filenames and Chrome download paths. */
export function sanitizeFilename(name, fallback = 'capture') {
  let s = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*~]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim()
    .replace(/^[.\s_]+|[.\s_]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  if (!s) s = fallback;
  return s.slice(0, 150);
}

export function sanitizeFolder(path) {
  return String(path || '')
    .split(/[\\/]+/)
    .map((p) => sanitizeFilename(p, ''))
    .filter((p) => p && p !== '..' && p !== '.')
    .join('/');
}

/**
 * Expand a filename pattern. Tokens: {site} {title} {domain} {date} (DD-MM-YYYY) {time} (HH-MM)
 * {datetime} {yyyy} {mm} {dd} {hh} {min} {ss} {w} {h} {type}
 */
export function expandPattern(pattern, ctx = {}) {
  const d = ctx.date ? new Date(ctx.date) : new Date();
  let domain = '';
  try { domain = new URL(ctx.url).hostname; } catch { /* ignore */ }
  const map = {
    site: siteName(ctx.url || '', ctx.title),
    title: (ctx.title || '').slice(0, 60),
    domain,
    date: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`,
    time: `${pad(d.getHours())}-${pad(d.getMinutes())}`,
    datetime: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
    yyyy: d.getFullYear(), mm: pad(d.getMonth() + 1), dd: pad(d.getDate()),
    hh: pad(d.getHours()), min: pad(d.getMinutes()), ss: pad(d.getSeconds()),
    w: ctx.width ?? '', h: ctx.height ?? '', type: ctx.type ?? '',
  };
  const out = String(pattern || '{site}_{date}').replace(/\{(\w+)\}/g, (m, k) => (k in map ? String(map[k]) : m));
  return sanitizeFilename(out);
}

export function buildDownloadPath(baseName, ext, settings) {
  const folder = sanitizeFolder(settings?.downloadSubfolder);
  const file = `${sanitizeFilename(baseName)}.${ext.replace(/^\./, '')}`;
  return folder ? `${folder}/${file}` : file;
}
