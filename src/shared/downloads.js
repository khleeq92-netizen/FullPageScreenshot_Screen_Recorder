// Downloads through chrome.downloads (works from extension pages that can create blob: URLs).
// Never overwrites: Chrome adds " (1)" etc. thanks to conflictAction 'uniquify'.
import { buildDownloadPath } from './filenames.js';

export function downloadBlob(blob, baseName, ext, settings, { saveAs } = {}) {
  const url = URL.createObjectURL(blob);
  const filename = buildDownloadPath(baseName, ext, settings);
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: saveAs ?? !!settings?.askWhereToSave }, (id) => {
      if (chrome.runtime.lastError || id == null) {
        URL.revokeObjectURL(url);
        reject(new Error(chrome.runtime.lastError?.message || 'Download was not started'));
        return;
      }
      const onChanged = (d) => {
        if (d.id !== id || !d.state) return;
        if (d.state.current === 'complete') { cleanup(); resolve({ id, filename }); }
        else if (d.state.current === 'interrupted') {
          cleanup();
          chrome.downloads.search({ id }, ([item]) => {
            const reason = item?.error || 'unknown reason';
            reject(new Error(reason === 'USER_CANCELED' ? 'Download cancelled.' : `Download interrupted (${reason}). Try again or choose another folder.`));
          });
        }
      };
      const cleanup = () => { chrome.downloads.onChanged.removeListener(onChanged); setTimeout(() => URL.revokeObjectURL(url), 10_000); };
      chrome.downloads.onChanged.addListener(onChanged);
    });
  });
}
