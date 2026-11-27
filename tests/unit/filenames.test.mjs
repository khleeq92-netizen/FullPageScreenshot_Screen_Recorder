import assert from 'node:assert/strict';
import { expandPattern, sanitizeFilename, siteName, buildDownloadPath, sanitizeFolder } from '../../src/shared/filenames.js';
const d = new Date(2026, 10, 27, 11, 30, 5);
export const tests = [
  ['default screenshot name', () => assert.equal(expandPattern('FullPage_Capture_{site}_{date}', { url: 'https://www.google.com/search?q=x', date: d }), 'FullPage_Capture_Google_27-11-2026')],
  ['default video name', () => assert.equal(expandPattern('Screen_Recording_{date}_{time}', { date: d }), 'Screen_Recording_27-11-2026_11-30')],
  ['custom tokens', () => assert.equal(expandPattern('Tutorial_{yyyy}{mm}{dd}_{hh}{min}{ss}_{domain}', { url: 'https://docs.github.com/x', date: d }), 'Tutorial_20261127_113005_docs.github.com')],
  ['site name for multi-part TLDs', () => { assert.equal(siteName('https://www.bbc.co.uk/news'), 'Bbc'); assert.equal(siteName('https://docs.github.com'), 'Github'); }],
  ['invalid characters removed', () => assert.equal(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j'), 'a_b_c_d_e_f_g_h_i_j')],
  ['reserved Windows names and dots', () => { assert.equal(sanitizeFilename('CON'), '_CON'); assert.equal(sanitizeFilename(' ..name.. '), 'name'); assert.equal(sanitizeFilename(''), 'capture'); }],
  ['folder path traversal is blocked', () => assert.equal(sanitizeFolder('../a/./b\\..\\c'), 'a/b/c')],
  ['download path', () => assert.equal(buildDownloadPath('x', 'jpg', { downloadSubfolder: 'FullPage HD Capture' }), 'FullPage HD Capture/x.jpg')],
  ['long titles truncated', () => assert.ok(sanitizeFilename('x'.repeat(500)).length <= 150)],
];
tests.push(['IP-address and localhost hosts use the page title', () => {
  assert.equal(siteName('http://127.0.0.1:8080/x', 'News article'), 'News_article');
  assert.equal(siteName('http://localhost:3000/', ''), 'Localhost');
}]);
