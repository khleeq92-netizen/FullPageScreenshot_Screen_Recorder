// E2E runner: node tests/e2e/run-e2e.mjs [suite...] [--grep pattern]
// Requires a display (run via `npm run test:e2e`, which wraps it in xvfb-run).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, ROOT } from './harness.mjs';
import { startServer } from '../fixtures/server.mjs';

const args = process.argv.slice(2);
const gi = args.indexOf('--grep'); const grep = gi >= 0 ? new RegExp(args[gi + 1], 'i') : null;
const suites = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--grep');
const all = suites.length ? suites : ['screenshot', 'recording-tab', 'recording-screen', 'editor', 'privacy', 'performance'];

execFileSync('node', ['build.mjs', '--test'], { cwd: ROOT, stdio: 'ignore' });
const { server, url } = await startServer();
const results = [];
for (const suite of all) {
  const file = path.join(ROOT, 'tests/e2e', `${suite}.test.mjs`);
  if (!fs.existsSync(file)) continue;
  const { tests, launchOptions } = await import(file);
  console.log(`\n▶ ${suite}`);
  const env = await launch(launchOptions || {});
  const t0s = Date.now();
  for (const [name, fn] of tests) {
    if (grep && !grep.test(name)) continue;
    const t0 = Date.now();
    try {
      await Promise.race([fn(env, url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout (240 s)')), 240000))]);
      results.push({ suite, name, ok: true, ms: Date.now() - t0 });
      console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (e) {
      results.push({ suite, name, ok: false, ms: Date.now() - t0, error: String(e?.stack || e) });
      console.log(`  ✗ ${name}\n      ${String(e?.message || e).split('\n').slice(0, 6).join('\n      ')}`);
    }
  }
  console.log(`  (${((Date.now() - t0s) / 1000).toFixed(0)} s)`);
  await env.context.close().catch(() => {});
}
server.close();
const failed = results.filter((r) => !r.ok);
fs.mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'test-results/e2e.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
