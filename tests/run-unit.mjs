// Unit tests (Node 20+): node tests/run-unit.mjs
import { readdirSync } from 'node:fs';
import path from 'node:path';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'unit');
let pass = 0; let fail = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.test.mjs')).sort()) {
  const { tests } = await import(path.join(dir, f));
  console.log(`▶ ${f}`);
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n      ${String(e?.stack || e).split('\n').slice(0, 4).join('\n      ')}`); }
  }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
