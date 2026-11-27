// Build script: bundles each entry point with esbuild and copies static assets into dist/.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const testBuild = process.argv.includes('--test'); // adds host permissions so automated tests can drive capture without a click
const outdir = testBuild ? 'dist-test' : 'dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync('static', outdir, { recursive: true });

if (testBuild) {
  const m = JSON.parse(readFileSync(`${outdir}/manifest.json`, 'utf8'));
  m.host_permissions = ['<all_urls>'];
  m.name += ' (test build)';
  writeFileSync(`${outdir}/manifest.json`, JSON.stringify(m, null, 2));
}

const entryPoints = {
  background: 'src/background/service-worker.js',
  offscreen: 'src/screen-recorder/offscreen.js',
  popup: 'src/popup/popup.js',
  app: 'src/app/app.js',
  screenshot: 'src/screenshot-editor/screenshot-page.js',
  'video-editor': 'src/video-editor/video-editor-page.js',
  'page-agent': 'src/screenshot/page-agent.js',
  'recording-overlay': 'src/overlay/recording-overlay.js',
  'export-worker': 'src/image-processing/export-worker.js',
  'video-export-worker': 'src/video-export/export-worker.js',
  'recorder-window': 'src/screen-recorder/recorder-window.js',
};

const options = {
  entryPoints,
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  sourcemap: 'linked',
  minify: !watch && !testBuild,
  legalComments: 'linked',
  logLevel: 'info',
};

// Content scripts are injected with chrome.scripting.executeScript({files}) and must be classic scripts.
const contentOptions = {
  ...options,
  entryPoints: { 'page-agent': entryPoints['page-agent'], 'recording-overlay': entryPoints['recording-overlay'] },
  format: 'iife',
};
delete entryPoints['page-agent'];
delete entryPoints['recording-overlay'];

if (watch) {
  const a = await esbuild.context(options); const b = await esbuild.context(contentOptions);
  await a.watch(); await b.watch();
} else {
  await esbuild.build(options);
  await esbuild.build(contentOptions);
  if (!existsSync(`${outdir}/background.js`)) throw new Error('build failed');
}
