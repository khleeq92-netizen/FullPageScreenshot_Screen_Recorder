import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixWebmDuration } from '../../src/screen-recorder/webm-duration.js';

export const tests = [
  ['adds Duration to a live (MediaRecorder-style) WebM without touching media data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fphd-webm-'));
    const live = path.join(dir, 'live.webm');
    // Streaming output (pipe) => unknown segment size, no Duration, no Cues – like MediaRecorder.
    execSync(`ffmpeg -v error -f lavfi -i testsrc2=s=320x240:r=30:d=3 -c:v libvpx -b:v 300k -f webm -live 1 pipe:1 > "${live}"`);
    const before = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', live], { encoding: 'utf8' }).trim();
    assert.ok(before === 'N/A' || before === '', `fixture should lack a duration (${before})`);
    const blob = new Blob([fs.readFileSync(live)], { type: 'video/webm' });
    const fixed = await fixWebmDuration(blob, 3000);
    const out = path.join(dir, 'fixed.webm');
    fs.writeFileSync(out, Buffer.from(await fixed.arrayBuffer()));
    const after = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim());
    assert.ok(Math.abs(after - 3) < 0.05, `duration ${after}`);
    const frames = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
    assert.equal(Number(frames), 90);
  }],
  ['non-WebM input is returned unchanged', async () => {
    const b = new Blob([new Uint8Array([1, 2, 3, 4])]);
    assert.equal(await fixWebmDuration(b, 1000), b);
  }],
];
