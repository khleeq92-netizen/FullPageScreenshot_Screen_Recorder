// Keyboard shortcuts panel: shows the keys currently assigned in Chrome (users can change them).
import { h } from './ui.js';

const ORDER = ['_execute_action', 'capture-full-page', 'capture-visible', 'toggle-recording', 'record-screen', 'toggle-recording-pause', 'stop-recording', 'toggle-annotation'];

export async function getShortcuts() {
  const all = await chrome.commands.getAll();
  return all.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name)).map((c) => ({
    name: c.name,
    description: c.name === '_execute_action' ? 'Open FullPage HD Capture' : c.description,
    shortcut: c.shortcut || '',
  }));
}

export function openShortcutSettings() {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

const kbd = (s) => s.split('+').map((k, i) => [i ? '+' : '', h('kbd', {}, k)]).flat().filter(Boolean);

/** Table of shortcuts. `compact` shows only the ones that have a key assigned. */
export async function shortcutsPanel({ compact = false } = {}) {
  const list = await getShortcuts();
  const rows = (compact ? list.filter((c) => c.shortcut) : list).map((c) => h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '12px', padding: '3px 0' } },
    h('span', { class: 'small' }, c.description),
    c.shortcut ? h('span', { class: 'row', style: { gap: '2px', flex: 'none' } }, ...kbd(c.shortcut)) : h('span', { class: 'small muted', style: { flex: 'none' } }, 'Not set')));
  const change = h('a', { href: '#', class: 'small', id: 'change-shortcuts' }, 'Change shortcuts…');
  change.addEventListener('click', (e) => { e.preventDefault(); openShortcutSettings(); });
  return h('div', { class: 'col', style: { gap: '2px' }, id: 'shortcuts-panel' }, ...rows, h('div', { style: { marginTop: '4px' } }, change));
}
