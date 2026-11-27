import assert from 'node:assert/strict';
import { newProject, outToSrc, srcToOut, splitAt, deleteSegment, trimStartAt, trimEndAt, outputDuration, scaledOutputSize, naturalOutputSize, gainAt, isIdentity } from '../../src/video-editor/project.js';
const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
export const tests = [
  ['identity project', () => { const p = newProject(10); assert.equal(isIdentity(p), true); close(outputDuration(p), 10); }],
  ['split + delete maps time correctly', () => {
    const p = newProject(10); splitAt(p, 3); splitAt(p, 6); assert.equal(p.segments.length, 3);
    deleteSegment(p, p.segments[1].id); close(outputDuration(p), 7);
    close(outToSrc(p, 2).src, 2); close(outToSrc(p, 3.5).src, 6.5); assert.equal(srcToOut(p, 4), null); close(srcToOut(p, 7), 4);
  }],
  ['speed changes durations', () => { const p = newProject(10); p.segments[0].speed = 2; close(outputDuration(p), 5); close(outToSrc(p, 2).src, 4); }],
  ['trim start/end', () => { const p = newProject(10); trimStartAt(p, 2); close(outputDuration(p), 8); trimEndAt(p, 6); close(outputDuration(p), 6); close(p.segments[0].start, 2); close(p.segments[0].end, 8); }],
  ['overlays shift when a clip before them is deleted', () => {
    const p = newProject(10); splitAt(p, 4); p.overlays.push({ id: 'o', start: 6, end: 7 });
    deleteSegment(p, p.segments[0].id); close(p.overlays[0].start, 2); close(p.overlays[0].end, 3);
  }],
  ['crop/rotate output size and no upscaling', () => {
    const p = newProject(5); p.crop = { x: 0, y: 0, w: 0.5, h: 0.5 }; p.rotation = 90;
    assert.deepEqual(naturalOutputSize(p, 1920, 1080), { width: 540, height: 960 });
    assert.deepEqual(scaledOutputSize(p, 1920, 1080, '1080'), { width: 540, height: 960 });
    assert.deepEqual(scaledOutputSize(newProject(1), 1920, 1080, '720'), { width: 1280, height: 720 });
    assert.deepEqual(scaledOutputSize(newProject(1), 1280, 720, '1080'), { width: 1280, height: 720 });
  }],
  ['gain envelope: volume, fades, mute', () => {
    const p = newProject(10); p.volume = 0.5; p.fadeIn = 2; p.fadeOut = 2;
    close(gainAt(p, 1, 10), 0.25); close(gainAt(p, 5, 10), 0.5); close(gainAt(p, 9.5, 10), 0.125); p.muted = true; close(gainAt(p, 5, 10), 0);
  }],
];
