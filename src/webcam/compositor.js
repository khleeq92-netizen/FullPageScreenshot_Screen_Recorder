// Real-time compositor: draws the screen/tab video and the webcam into one canvas and produces a
// new video track that MediaRecorder records – so the webcam is part of the actual file.
// Frames are driven by the media sources themselves (MediaStreamTrackProcessor), not by timers,
// so it keeps running in a hidden offscreen document.
import { webcamRect, drawWebcam } from './webcam-layout.js';

export class Compositor {
  constructor(screenTrack, camTrack, opts) {
    this.screenTrack = screenTrack; this.camTrack = camTrack;
    this.opts = { ...opts };
    this.fps = opts.fps || 30;
    this.minInterval = 1000 / this.fps;
    this.camVisible = !!camTrack;
    this.running = false;
    this.lastScreen = null; this.lastCam = null;
    this.lastOut = 0; this.frames = 0;
    this.canvas = null; this.ctx = null;
    this.generator = new MediaStreamTrackGenerator({ kind: 'video' });
    this.writer = this.generator.writable.getWriter();
    this.track = this.generator;
  }

  static supported() {
    return typeof MediaStreamTrackProcessor !== 'undefined' && typeof MediaStreamTrackGenerator !== 'undefined';
  }

  start() {
    this.running = true;
    this._pump(this.screenTrack, 'screen');
    if (this.camTrack) this._pump(this.camTrack, 'cam');
  }

  setCamTrack(track) {
    this.camTrack = track;
    if (track && this.running) this._pump(track, 'cam');
  }

  setCamVisible(v) { this.camVisible = v; }
  setLayout(patch) { Object.assign(this.opts, patch); }

  async _pump(track, kind) {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    try {
      while (this.running) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        if (kind === 'screen') { this.lastScreen?.close(); this.lastScreen = frame; this._compose(true); }
        else { this.lastCam?.close(); this.lastCam = frame; this._compose(false); }
      }
    } catch { /* track ended */ }
    finally { reader.releaseLock?.(); }
  }

  _compose(fromScreen) {
    const now = performance.now();
    if (!this.lastScreen) return;
    // Screen frames are always composed (they define motion); camera frames only re-compose
    // when the screen is static, limited to the target frame rate.
    if (!fromScreen && now - this.lastOut < this.minInterval) return;
    if (fromScreen && now - this.lastOut < this.minInterval * 0.5) return;
    const sf = this.lastScreen;
    const W = sf.displayWidth; const H = sf.displayHeight;
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(W, H);
      this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    }
    const ctx = this.ctx; const cw = this.canvas.width; const ch = this.canvas.height;
    if (W === cw && H === ch) ctx.drawImage(sf, 0, 0);
    else {
      // Source size changed (e.g. tab resized): letterbox into the original frame size.
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
      const s = Math.min(cw / W, ch / H); const dw = W * s; const dh = H * s;
      ctx.drawImage(sf, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }
    if (this.camVisible && this.lastCam) {
      const cf = this.lastCam;
      const rect = webcamRect(cw, ch, { ...this.opts, camAspect: cf.displayWidth / cf.displayHeight });
      drawWebcam(ctx, cf, cf.displayWidth, cf.displayHeight, rect, { opacity: (this.opts.opacity ?? 100) / 100, mirror: this.opts.mirror !== false });
    }
    this.lastOut = now;
    this.frames++;
    const out = new VideoFrame(this.canvas, { timestamp: Math.round(now * 1000) });
    this.writer.write(out).catch(() => {}).finally(() => out.close());
  }

  snapshot() { return this.canvas ? this.canvas.convertToBlob({ type: 'image/png' }) : null; }

  stop() {
    this.running = false;
    this.lastScreen?.close(); this.lastCam?.close();
    this.lastScreen = this.lastCam = null;
    this.writer.close().catch(() => {});
    this.generator.stop?.();
  }
}
