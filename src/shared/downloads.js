// Downloads through chrome.downloads (works from extension pages that can create blob: URLs).
// Never overwrites: Chrome adds " (1)" etc. thanks to conflictAction 'uniquify'.
import { buildDownloadPath } from './filenames.js';

export function downloadBlob(blob, baseName, ext, settings, { saveAs } = {}) {
  const url = URL.createObjectURL(blob);
  const filename = buildDownloadPath(baseName, ext, settings);
  return new Promise((resolve, reject) => {
    let id = null;
    let settled = false;
    const finish = (state, error) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      if (state === 'complete') resolve({ id, filename });
      else reject(new Error(error === 'USER_CANCELED' ? 'Download cancelled.' : `Download interrupted (${error || 'unknown reason'}). Try again or choose another folder.`));
    };
    const check = (d) => {
      if (!d) return;
      const state = typeof d.state === 'string' ? d.state : d.state?.current;
      if (state === 'complete') finish('complete');
      else if (state === 'interrupted') {
        if (d.error && typeof d.error === 'string') finish('interrupted', d.error);
        else chrome.downloads.search({ id }, ([item]) => finish('interrupted', item?.error));
      }
    };
    // Listen before starting: small files can complete before the download() callback runs.
    const onChanged = (d) => { if (id != null && d.id === id) check(d); };
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: saveAs ?? !!settings?.askWhereToSave }, (newId) => {
      if (chrome.runtime.lastError || newId == null) {
        settled = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(url);
        reject(new Error(chrome.runtime.lastError?.message || 'Download was not started'));
        return;
      }
      id = newId;
      // Catch a state change that happened before `id` was known.
      chrome.downloads.search({ id }, ([item]) => check(item));
    });
  });
}
