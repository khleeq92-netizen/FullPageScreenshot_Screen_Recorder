// Creates release/fullpage-hd-capture-<version>.zip from dist/ (run `npm run package`).
// Source maps are excluded from the store package.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
if (!existsSync(path.join(dist, 'manifest.json'))) throw new Error('Run `npm run build` first');
const { version } = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
mkdirSync(path.join(root, 'release'), { recursive: true });
const out = path.join(root, 'release', `fullpage-hd-capture-${version}.zip`);
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', '-X', out, '.', '-x', '*.map'], { cwd: dist, stdio: 'inherit' });
console.log(`Packaged ${path.relative(root, out)}`);
