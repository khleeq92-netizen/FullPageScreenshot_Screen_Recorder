// Recording session – lives in the offscreen document so it survives the popup closing.
// Pipeline: tab/desktop stream (+ mic, + webcam) -> [audio mixer] -> [webcam compositor] -> MediaRecorder
// MediaRecorder output is written to IndexedDB in 1-second chunks (crash-safe, low memory) and
// assembled into one playable file when recording stops.
import { AudioMixer } from '../audio/mixer.js';
import { Compositor } from '../webcam/compositor.js';
import { pickMimeType, videoBitrate, audioBitrate, RESOLUTIONS } from './codecs.js';
import { fixWebmDuration } from './webm-duration.js';
import { putChunk, getChunks, deleteChunks, putBlob, putItem, newId } from '../storage/db.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeGumError(e, what) {
  const n = e?.name || '';
  if (n === 'NotAllowedError') return `${what} permission was denied. Allow it in the extension's Screen Recorder page (or Chrome site settings) and try again.`;
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return `No ${what.toLowerCase()} was found.`;
  if (n === 'NotReadableError') return `The ${what.toLowerCase()} is in use by another application.`;
  if (n === 'AbortError') return `${what} capture was aborted${e?.message ? ` (${e.message})` : ''}.`;
  return `${what} error: ${e?.message || n || e}`;
}

export class RecordingSession {
  constructor({ send }) {
    this.send = send; // (msg) => void, to the service worker
    this.state = 'idle';
    this.recId = newId('rec');
    this.warnings = [];
    this.tracks = [];
    this.seq = 0; this.camSeq = 0;
    this.bytes = 0;
    this.writeChain = Promise.resolve();
    this.pausedTotal = 0; this.pauseStart = 0; this.startTime = 0;
    this.muted = false;
    this.cancelled = false;
    this.statusTimer = null;
    this.finishing = null;
  }

  elapsed() {
    if (!this.startTime) return 0;
    const now = this.state === 'paused' ? this.pauseStart : performance.now();
    return Math.max(0, (now - this.startTime - this.pausedTotal) / 1000);
  }

  status(extra = {}) {
    const lv = this.mixer ? this.mixer.levels() : { mic: 0, source: 0 };
    const vs = this.videoTrack?.getSettings?.() || {};
    return {
      state: this.state, elapsed: this.elapsed(), bytes: this.bytes,
      micLevel: lv.mic, sourceLevel: lv.source, muted: this.muted,
      hasMic: !!this.micStream, hasSourceAudio: !!this.sourceAudio,
      webcam: !!this.camStream, webcamVisible: this.compositor ? this.compositor.camVisible : !!this.camStream,
      width: this.outWidth || vs.width || 0, height: this.outHeight || vs.height || 0,
      fps: this.measuredFps || Math.round(vs.frameRate || 0), targetFps: this.settings?.recFps,
      mimeType: this.mimeType, bitrate: this.vbr, source: this.source,
      warnings: this.warnings, recId: this.recId, ...extra,
    };
  }

  pushStatus(extra) { this.send({ type: 'rec:status', status: this.status(extra) }); }

  async begin({ streamId, source, canTabAudio, settings, meta, tabSize }) {
    this.settings = settings; this.source = source; this.meta = meta || {};
    const fps = Number(settings.recFps) || 30;
    const [maxW, maxH] = RESOLUTIONS[settings.recResolution] || RESOLUTIONS['1080'];
    const chromeMediaSource = source === 'tab' ? 'tab' : 'desktop';
    const wantSourceAudio = (settings.recAudio === 'tab' || settings.recAudio === 'both');
    const wantMic = (settings.recAudio === 'mic' || settings.recAudio === 'both');

    // 1. Video (+ tab/system audio)
    const video = { mandatory: { chromeMediaSource, chromeMediaSourceId: streamId, maxWidth: maxW, maxHeight: maxH, maxFrameRate: fps } };
    if (tabSize?.width && tabSize?.height) {
      // Fit the tab's physical size into the resolution box (same aspect ratio, never upscaled).
      const landscapeBox = tabSize.width >= tabSize.height ? [maxW, maxH] : [maxH, maxW];
      const k = Math.min(1, landscapeBox[0] / tabSize.width, landscapeBox[1] / tabSize.height);
      const w = Math.max(2, Math.round((tabSize.width * k) / 2) * 2); const h = Math.max(2, Math.round((tabSize.height * k) / 2) * 2);
      Object.assign(video.mandatory, { minWidth: w, maxWidth: w, minHeight: h, maxHeight: h });
      this.nativeSize = tabSize;
    }
    let stream;
    const audio = wantSourceAudio && (source === 'tab' || canTabAudio) ? { mandatory: { chromeMediaSource, chromeMediaSourceId: streamId } } : false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch (e) {
      if (audio) {
        // Retry without audio: some sources (e.g. a window on Linux) cannot provide it.
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }).catch((e2) => { throw new Error(describeGumError(e2, 'Screen')); });
        this.warnings.push(source === 'tab' ? 'Tab audio could not be captured.' : 'System audio is not available for the selected source.');
      } else throw new Error(describeGumError(e, 'Screen'));
    }
    if (wantSourceAudio && source !== 'tab' && !canTabAudio) {
      this.warnings.push('System audio was not shared. On Windows/ChromeOS tick “Share system audio”; on macOS/Linux only tab audio is available from Chrome.');
    }
    this.screenStream = stream;
    this.videoTrack = stream.getVideoTracks()[0];
    this.tracks.push(...stream.getTracks());
    this.videoTrack.addEventListener('ended', () => this.onSourceEnded());
    try { this.videoTrack.contentHint = 'detail'; } catch { /* ignore */ }

    // 2. Audio
    const srcAudio = stream.getAudioTracks()[0];
    if (srcAudio) this.sourceAudio = srcAudio;
    if (wantMic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: settings.micDeviceId ? { exact: settings.micDeviceId } : undefined,
            echoCancellation: settings.micEchoCancellation !== false, noiseSuppression: true, autoGainControl: true,
          },
        });
      } catch (e) {
        if (settings.micDeviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
          if (this.micStream) this.warnings.push('The selected microphone was not found; the default microphone is used.');
        }
        if (!this.micStream) this.warnings.push(`${describeGumError(e, 'Microphone')} Recording continues without the microphone.`);
      }
      if (this.micStream) this.tracks.push(...this.micStream.getTracks());
    }
    let audioTrack = null;
    if (this.sourceAudio || this.micStream) {
      this.mixer = new AudioMixer();
      await this.mixer.resume();
      if (this.sourceAudio) this.mixer.addSourceAudio(new MediaStream([this.sourceAudio]), { monitor: source === 'tab' });
      if (this.micStream) this.mixer.addMic(this.micStream);
      audioTrack = this.mixer.track;
    }

    // 3. Webcam
    let videoOut = this.videoTrack;
    if (settings.webcamEnabled) {
      try {
        this.camStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: settings.webcamDeviceId ? { exact: settings.webcamDeviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        });
        this.tracks.push(...this.camStream.getTracks());
      } catch (e) {
        this.warnings.push(`${describeGumError(e, 'Camera')} Recording continues without the webcam.`);
      }
      if (this.camStream && settings.webcamMode !== 'separate') {
        if (Compositor.supported()) {
          this.compositor = new Compositor(this.videoTrack, this.camStream.getVideoTracks()[0], {
            fps, size: settings.webcamSize, shape: settings.webcamShape, position: settings.webcamPosition,
            x: settings.webcamX, y: settings.webcamY, opacity: settings.webcamOpacity, mirror: true,
          });
          this.compositor.start();
          videoOut = this.compositor.track;
        } else {
          this.warnings.push('Webcam compositing is not supported by this Chrome version; the webcam is saved as a separate editable track.');
          settings.webcamMode = 'separate';
        }
      }
    }

    // 4. MediaRecorder
    const vs = this.videoTrack.getSettings();
    this.outWidth = vs.width; this.outHeight = vs.height;
    const { mimeType, fallback } = pickMimeType(settings.recCodec, !!audioTrack);
    if (fallback) this.warnings.push(`The ${settings.recCodec.toUpperCase()} codec is not supported here; using ${mimeType}.`);
    this.mimeType = mimeType;
    this.vbr = videoBitrate({ width: vs.width || maxW, height: vs.height || maxH, fps, quality: settings.recQuality, customMbps: settings.recBitrateMbps });
    const recStream = new MediaStream([videoOut, ...(audioTrack ? [audioTrack] : [])]);
    this.recorder = new MediaRecorder(recStream, { mimeType, videoBitsPerSecond: this.vbr, audioBitsPerSecond: audioBitrate(settings.recQuality), videoKeyFrameIntervalDuration: 2000 });
    this.recorder.ondataavailable = (e) => this.onData(e.data, false);
    this.recorder.onerror = (e) => this.fail(`Recorder error: ${e.error?.message || e.error?.name || 'unknown'}`);
    if (this.camStream && settings.webcamMode === 'separate') {
      const camMime = pickMimeType('vp9', false).mimeType;
      this.camRecorder = new MediaRecorder(new MediaStream(this.camStream.getVideoTracks()), { mimeType: camMime, videoBitsPerSecond: 4e6 });
      this.camRecorder.ondataavailable = (e) => this.onData(e.data, true);
    }

    // frame-rate measurement where the browser exposes track statistics
    this.lastFrames = null;
    this.statusTimer = setInterval(() => this.tick(), 500);

    // 5. Countdown
    const cd = Number(settings.countdown) || 0;
    for (let i = cd; i > 0; i--) {
      if (this.cancelled) return { ok: true, cancelled: true };
      this.state = 'countdown'; this.pushStatus({ countdown: i });
      await sleep(1000);
    }
    if (this.cancelled || this.state === 'stopping') return { ok: true, cancelled: true };
    if (cd > 0) { this.state = 'starting'; this.pushStatus(); await sleep(250); } // let the overlay hide the countdown
    this.thumbPromise = this.grabFrame().catch(() => null);
    this.recorder.start(1000);
    this.camRecorder?.start(1000);
    this.startTime = performance.now();
    this.state = 'recording';
    this.pushStatus();
    return { ok: true, width: vs.width, height: vs.height, frameRate: vs.frameRate, mimeType, warnings: this.warnings };
  }

  tick() {
    const t = this.videoTrack;
    try {
      const st = t?.stats; // MediaStreamTrack statistics (Chrome)
      if (st && typeof st.totalFrames === 'number') {
        const now = performance.now();
        if (this.lastFrames) {
          const df = st.totalFrames - this.lastFrames.n; const dt = (now - this.lastFrames.t) / 1000;
          if (dt > 0) this.measuredFps = Math.round(df / dt);
        }
        this.lastFrames = { n: st.totalFrames, t: now };
      }
    } catch { /* not available */ }
    if (this.state === 'recording' || this.state === 'paused' || this.state === 'countdown') this.pushStatus();
  }

  onData(blob, isCam) {
    if (!blob || !blob.size) return;
    const seq = isCam ? this.camSeq++ : this.seq++;
    if (!isCam) this.bytes += blob.size;
    const recId = isCam ? `${this.recId}_cam` : this.recId;
    this.writeChain = this.writeChain.then(() => putChunk(recId, seq, blob)).catch((e) => {
      this.warnings.push(`Writing to storage failed: ${e.message}`);
      this.fail('Storage is full or unavailable – the recording was stopped.');
    });
  }

  pause() {
    if (this.state !== 'recording') return;
    this.recorder.pause(); this.camRecorder?.pause();
    this.pauseStart = performance.now();
    this.state = 'paused'; this.pushStatus();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.recorder.resume(); this.camRecorder?.resume();
    this.pausedTotal += performance.now() - this.pauseStart; this.pauseStart = 0;
    this.state = 'recording'; this.pushStatus();
  }

  setMuted(m) { this.muted = !!m; this.mixer?.setMicMuted(this.muted); this.pushStatus(); }

  setWebcam({ enabled, position }) {
    if (!this.compositor) return { ok: false, error: 'The webcam can only be toggled when the recording was started with the webcam enabled.' };
    if (typeof enabled === 'boolean') this.compositor.setCamVisible(enabled);
    if (position) this.compositor.setLayout({ position });
    this.pushStatus();
    return { ok: true };
  }

  onSourceEnded() {
    if (this.state === 'recording' || this.state === 'paused') {
      this.warnings.push('Sharing was stopped (the source ended or “Stop sharing” was clicked). The recording was saved.');
      this.stop();
    } else if (this.state === 'countdown' || this.state === 'starting') this.cancel();
  }

  async grabFrame() {
    if (this.compositor?.canvas) return this.compositor.snapshot();
    const ic = new ImageCapture(this.videoTrack);
    const bmp = await ic.grabFrame();
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return c.convertToBlob({ type: 'image/png' });
  }

  /** Screenshot of the current frame, saved to Capture History. */
  async screenshot() {
    const blob = await this.grabFrame();
    const bmp = await createImageBitmap(blob);
    const id = newId('shot');
    await putBlob(`${id}:seg0`, blob);
    const tc = new OffscreenCanvas(320, Math.max(1, Math.round(320 * bmp.height / bmp.width)));
    tc.getContext('2d').drawImage(bmp, 0, 0, tc.width, tc.height);
    await putBlob(`${id}:thumb`, await tc.convertToBlob({ type: 'image/jpeg', quality: 0.8 }));
    await putItem({
      id, kind: 'screenshot', mode: 'recording-frame', title: `${this.meta.title || 'Recording'} – frame at ${this.elapsed().toFixed(1)}s`,
      url: this.meta.url || '', createdAt: Date.now(), width: bmp.width, height: bmp.height, cssWidth: bmp.width, cssHeight: bmp.height,
      scale: 1, dpr: 1, frames: 1, status: 'complete', warnings: [], segments: [{ key: `${id}:seg0`, y: 0, height: bmp.height, size: blob.size }],
      size: blob.size, thumbKey: `${id}:thumb`, format: 'png',
    });
    bmp.close();
    return { ok: true, itemId: id };
  }

  fail(message) {
    if (this.state === 'done' || this.state === 'error') return;
    this.warnings.push(message);
    this.stop();
  }

  cancel() {
    this.cancelled = true;
    return this.stop();
  }

  stop() {
    if (this.finishing) return this.finishing;
    this.finishing = this._finish();
    return this.finishing;
  }

  async _waitStop(rec) {
    if (!rec || rec.state === 'inactive') return;
    await new Promise((resolve) => { rec.addEventListener('stop', resolve, { once: true }); try { rec.stop(); } catch { resolve(); } });
  }

  async _finish() {
    const wasRecording = this.startTime > 0;
    const duration = this.elapsed();
    this.state = 'stopping'; this.pushStatus();
    clearInterval(this.statusTimer);
    await Promise.all([this._waitStop(this.recorder), this._waitStop(this.camRecorder)]);
    await this.writeChain;
    const thumb = this.thumbPromise ? await this.thumbPromise : null;
    this.releaseMedia();

    if (this.cancelled || !wasRecording) {
      await deleteChunks(this.recId); await deleteChunks(`${this.recId}_cam`);
      this.state = 'cancelled';
      this.send({ type: 'rec:finished', cancelled: true });
      return { ok: true, cancelled: true };
    }
    try {
      const itemId = await this.assemble(duration, thumb);
      this.state = 'done';
      this.send({ type: 'rec:finished', itemId });
      return { ok: true, itemId };
    } catch (e) {
      this.state = 'error';
      this.send({ type: 'rec:finished', error: `Saving the recording failed: ${e.message}. The raw data is kept and can be recovered from Capture History.` });
      return { ok: false, error: e.message };
    }
  }

  async assemble(duration, thumb) {
    const chunks = await getChunks(this.recId);
    if (!chunks.length) throw new Error('No video data was recorded');
    const type = this.mimeType.split(';')[0];
    let blob = new Blob(chunks, { type });
    if (type === 'video/webm') blob = await fixWebmDuration(blob, duration * 1000);
    const id = this.recId;
    await putBlob(`${id}:video`, blob);
    let webcamBlobKey = null;
    if (this.camRecorder) {
      const camChunks = await getChunks(`${id}_cam`);
      if (camChunks.length) {
        let cb = new Blob(camChunks, { type: 'video/webm' });
        cb = await fixWebmDuration(cb, duration * 1000);
        webcamBlobKey = `${id}:webcam`;
        await putBlob(webcamBlobKey, cb);
      }
    }
    let thumbKey = null;
    if (thumb) {
      try {
        const bmp = await createImageBitmap(thumb);
        const tc = new OffscreenCanvas(320, Math.max(1, Math.round(320 * bmp.height / bmp.width)));
        tc.getContext('2d').drawImage(bmp, 0, 0, tc.width, tc.height); bmp.close();
        thumbKey = `${id}:thumb`;
        await putBlob(thumbKey, await tc.convertToBlob({ type: 'image/jpeg', quality: 0.8 }));
      } catch { thumbKey = null; }
    }
    const ext = type === 'video/mp4' ? 'mp4' : 'webm';
    await putItem({
      id, kind: 'video', title: this.meta.title ? `Recording – ${this.meta.title}` : 'Screen recording', url: this.meta.url || '',
      createdAt: Date.now(), duration, width: this.outWidth, height: this.outHeight,
      fps: this.measuredFps || Number(this.settings.recFps), targetFps: Number(this.settings.recFps),
      format: ext, mimeType: this.mimeType, bitrate: this.vbr, size: blob.size, blobKey: `${id}:video`, thumbKey,
      webcamBlobKey, webcamLayout: webcamBlobKey ? {
        size: this.settings.webcamSize, shape: this.settings.webcamShape, position: this.settings.webcamPosition,
        x: this.settings.webcamX, y: this.settings.webcamY, opacity: this.settings.webcamOpacity,
      } : null,
      source: this.source, audio: { mic: !!this.micStream, source: !!this.sourceAudio },
      warnings: this.warnings, status: 'complete',
    });
    await deleteChunks(id); await deleteChunks(`${id}_cam`);
    return id;
  }

  releaseMedia() {
    this.compositor?.stop();
    for (const t of this.tracks) { try { t.stop(); } catch { /* ignore */ } }
    this.tracks = [];
    this.mixer?.close(); this.mixer = null;
  }
}
