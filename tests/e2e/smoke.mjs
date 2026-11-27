import { launch, tabIdOf, sendMsg, verifyBands } from './harness.mjs';
import { startServer } from '../fixtures/server.mjs';
const { server, url } = await startServer();
const env = await launch();
try {
  const page = await env.context.newPage();
  await page.goto(`${url}/bands?n=40`);
  await page.bringToFront();
  const tabId = await tabIdOf(env.ctrl, '/bands');
  const t0 = Date.now();
  const r = await sendMsg(env.ctrl, { type: 'capture:start-wait', tabId, openEditor: false });
  console.log('capture result', r, (Date.now() - t0) + 'ms');
  if (r.itemId) console.log(JSON.stringify(await verifyBands(env.ctrl, r.itemId, { n: 40 }), null, 1));
} finally { await env.context.close(); server.close(); }
