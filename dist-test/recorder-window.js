// src/audio/mixer.js
var AudioMixer = class _AudioMixer {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 48e3, latencyHint: "interactive" });
    this.dest = this.ctx.createMediaStreamDestination();
    this.dest.channelCount = 2;
    this.micGain = null;
    this.micAnalyser = null;
    this.srcAnalyser = null;
    this.nodes = [];
    this.levelBuf = new Float32Array(2048);
  }
  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume().catch(() => {
    });
  }
  addSourceAudio(stream, { monitor = false } = {}) {
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(this.dest);
    if (monitor) gain.connect(this.ctx.destination);
    this.srcAnalyser = this.ctx.createAnalyser();
    this.srcAnalyser.fftSize = 2048;
    gain.connect(this.srcAnalyser);
    this.nodes.push(src, gain);
  }
  addMic(stream) {
    const src = this.ctx.createMediaStreamSource(stream);
    this.micGain = this.ctx.createGain();
    this.micGain.gain.value = 1;
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 2048;
    src.connect(this.micGain);
    this.micGain.connect(this.dest);
    this.micGain.connect(this.micAnalyser);
    this.nodes.push(src);
  }
  setMicMuted(muted) {
    if (this.micGain) this.micGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.015);
  }
  static rms(analyser, buf) {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.min(1, Math.sqrt(s / buf.length) * 4);
  }
  levels() {
    return { mic: _AudioMixer.rms(this.micAnalyser, this.levelBuf), source: _AudioMixer.rms(this.srcAnalyser, this.levelBuf) };
  }
  get track() {
    return this.dest.stream.getAudioTracks()[0] || null;
  }
  close() {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
      }
    }
    this.ctx.close().catch(() => {
    });
  }
};

// src/webcam/webcam-layout.js
function webcamRect(outW, outH, o) {
  const sizePct = Math.max(5, Math.min(60, Number(o.size ?? o.webcamSize ?? 22)));
  const shape = o.shape ?? o.webcamShape ?? "circle";
  const camAspect = o.camAspect || 16 / 9;
  const w = Math.round(outW * sizePct / 100);
  const h2 = shape === "circle" ? w : Math.round(w / camAspect);
  const m = Math.round(Math.min(outW, outH) * 0.03);
  const pos = o.position ?? o.webcamPosition ?? "bottom-right";
  let x;
  let y;
  if (pos === "top-left") {
    x = m;
    y = m;
  } else if (pos === "top-right") {
    x = outW - w - m;
    y = m;
  } else if (pos === "bottom-left") {
    x = m;
    y = outH - h2 - m;
  } else if (pos === "custom") {
    x = Math.round((o.x ?? o.webcamX ?? 0.75) * outW);
    y = Math.round((o.y ?? o.webcamY ?? 0.7) * outH);
  } else {
    x = outW - w - m;
    y = outH - h2 - m;
  }
  x = Math.max(0, Math.min(outW - w, x));
  y = Math.max(0, Math.min(outH - h2, y));
  return { x, y, w, h: h2, shape };
}
function drawWebcam(ctx, frame, frameW, frameH, rect, { opacity = 1, mirror = true, border = true } = {}) {
  const { x, y, w, h: h2, shape } = rect;
  const scale = Math.max(w / frameW, h2 / frameH);
  const sw = w / scale;
  const sh = h2 / scale;
  const sx = (frameW - sw) / 2;
  const sy = (frameH - sh) / 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));
  ctx.beginPath();
  if (shape === "circle") ctx.arc(x + w / 2, y + h2 / 2, w / 2, 0, Math.PI * 2);
  else if (ctx.roundRect) ctx.roundRect(x, y, w, h2, Math.min(w, h2) * 0.08);
  else ctx.rect(x, y, w, h2);
  ctx.save();
  ctx.clip();
  if (mirror) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h2);
  } else ctx.drawImage(frame, sx, sy, sw, sh, x, y, w, h2);
  ctx.restore();
  if (border) {
    ctx.lineWidth = Math.max(2, Math.round(w * 0.015));
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.stroke();
  }
  ctx.restore();
}

// src/webcam/compositor.js
var Compositor = class {
  constructor(screenTrack, camTrack, opts) {
    this.screenTrack = screenTrack;
    this.camTrack = camTrack;
    this.opts = { ...opts };
    this.fps = opts.fps || 30;
    this.minInterval = 1e3 / this.fps;
    this.camVisible = !!camTrack;
    this.running = false;
    this.lastScreen = null;
    this.lastCam = null;
    this.lastOut = 0;
    this.frames = 0;
    this.canvas = null;
    this.ctx = null;
    this.generator = new MediaStreamTrackGenerator({ kind: "video" });
    this.writer = this.generator.writable.getWriter();
    this.track = this.generator;
  }
  static supported() {
    return typeof MediaStreamTrackProcessor !== "undefined" && typeof MediaStreamTrackGenerator !== "undefined";
  }
  start() {
    this.running = true;
    this._pump(this.screenTrack, "screen");
    if (this.camTrack) this._pump(this.camTrack, "cam");
  }
  setCamTrack(track) {
    this.camTrack = track;
    if (track && this.running) this._pump(track, "cam");
  }
  setCamVisible(v) {
    this.camVisible = v;
  }
  setLayout(patch) {
    Object.assign(this.opts, patch);
  }
  async _pump(track, kind) {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    try {
      while (this.running) {
        const { value: frame, done } = await reader.read();
        if (done) break;
        if (kind === "screen") {
          this.lastScreen?.close();
          this.lastScreen = frame;
          this._compose(true);
        } else {
          this.lastCam?.close();
          this.lastCam = frame;
          this._compose(false);
        }
      }
    } catch {
    } finally {
      reader.releaseLock?.();
    }
  }
  _compose(fromScreen) {
    const now = performance.now();
    if (!this.lastScreen) return;
    if (!fromScreen && now - this.lastOut < this.minInterval) return;
    if (fromScreen && now - this.lastOut < this.minInterval * 0.5) return;
    const sf = this.lastScreen;
    const W = sf.displayWidth;
    const H = sf.displayHeight;
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(W, H);
      this.ctx = this.canvas.getContext("2d", { alpha: false, desynchronized: true });
    }
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (W === cw && H === ch) ctx.drawImage(sf, 0, 0);
    else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);
      const s = Math.min(cw / W, ch / H);
      const dw = W * s;
      const dh = H * s;
      ctx.drawImage(sf, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }
    if (this.camVisible && this.lastCam) {
      const cf = this.lastCam;
      const rect = webcamRect(cw, ch, { ...this.opts, camAspect: cf.displayWidth / cf.displayHeight });
      drawWebcam(ctx, cf, cf.displayWidth, cf.displayHeight, rect, { opacity: (this.opts.opacity ?? 100) / 100, mirror: this.opts.mirror !== false });
    }
    this.lastOut = now;
    this.frames++;
    const out = new VideoFrame(this.canvas, { timestamp: Math.round(now * 1e3) });
    this.writer.write(out).catch(() => {
    }).finally(() => out.close());
  }
  snapshot() {
    return this.canvas ? this.canvas.convertToBlob({ type: "image/png" }) : null;
  }
  stop() {
    this.running = false;
    this.lastScreen?.close();
    this.lastCam?.close();
    this.lastScreen = this.lastCam = null;
    this.writer.close().catch(() => {
    });
    this.generator.stop?.();
  }
};

// src/screen-recorder/codecs.js
var RESOLUTIONS = {
  "720": [1280, 720],
  "1080": [1920, 1080],
  "1440": [2560, 1440],
  "2160": [3840, 2160],
  source: [7680, 4320]
};
var CANDIDATES = {
  vp9: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9"],
  vp8: ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8"],
  av1: ["video/webm;codecs=av01,opus", "video/webm;codecs=av1,opus"],
  h264: ["video/webm;codecs=h264,opus", "video/mp4;codecs=avc1.640033,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2"]
};
function pickMimeType(codec, hasAudio) {
  const order = [codec, "vp9", "vp8"].filter((c, i, a) => c && a.indexOf(c) === i);
  for (const c of order) {
    for (let m of CANDIDATES[c] || []) {
      if (!hasAudio) m = m.replace(/,(opus|mp4a[^;]*)$/, "");
      if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, codec: c, fallback: c !== codec };
    }
  }
  if (MediaRecorder.isTypeSupported("video/webm")) return { mimeType: "video/webm", codec: "default", fallback: true };
  throw new Error("This browser cannot record video with MediaRecorder.");
}
var BPP = { standard: 0.08, high: 0.16, max: 0.4 };
function videoBitrate({ width, height, fps, quality, customMbps }) {
  if (quality === "custom") return Math.round(Math.max(0.5, Number(customMbps) || 8) * 1e6);
  const bpp = BPP[quality] || BPP.high;
  return Math.round(Math.min(12e7, Math.max(1e6, width * height * Math.max(15, fps) * bpp)));
}
function audioBitrate(quality) {
  return quality === "max" ? 256e3 : quality === "standard" ? 128e3 : 192e3;
}

// src/screen-recorder/webm-duration.js
function readVint(buf, pos) {
  const first = buf[pos];
  if (first === void 0) return null;
  let len = 1;
  let mask = 128;
  while (len <= 8 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 8) return null;
  let value = first & mask - 1;
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    const b = buf[pos + i];
    if (b === void 0) return null;
    value = value * 256 + b;
    if (b !== 255) allOnes = false;
  }
  return { len, value, unknown: allOnes };
}
function readId(buf, pos) {
  const first = buf[pos];
  let len = 1;
  let mask = 128;
  while (len <= 4 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 4) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}
function sizeVint8(n) {
  const out = new Uint8Array(8);
  out[0] = 1;
  for (let i = 7; i >= 1; i--) {
    out[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return out;
}
var ID_SEGMENT = 408125543;
var ID_INFO = 357149030;
var ID_DURATION = 17545;
var ID_TIMECODESCALE = 2807729;
async function fixWebmDuration(blob, durationMs) {
  const headLen = Math.min(blob.size, 256 * 1024);
  const buf = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
  let pos = 0;
  const h2 = readId(buf, pos);
  if (!h2 || h2.id !== 440786851) return blob;
  pos += h2.len;
  const hs = readVint(buf, pos);
  pos += hs.len + hs.value;
  const seg = readId(buf, pos);
  if (!seg || seg.id !== ID_SEGMENT) return blob;
  pos += seg.len;
  const ss = readVint(buf, pos);
  pos += ss.len;
  while (pos < buf.length - 8) {
    const el = readId(buf, pos);
    if (!el) return blob;
    const sz = readVint(buf, pos + el.len);
    if (!sz) return blob;
    const dataStart = pos + el.len + sz.len;
    if (el.id === ID_INFO) {
      const infoEnd = dataStart + sz.value;
      if (infoEnd > buf.length) return blob;
      let timecodeScale = 1e6;
      const children = [];
      let p = dataStart;
      while (p < infoEnd) {
        const c = readId(buf, p);
        const cs = readVint(buf, p + c.len);
        const cStart = p + c.len + cs.len;
        const cEnd = cStart + cs.value;
        if (c.id === ID_TIMECODESCALE) {
          let v = 0;
          for (let i = cStart; i < cEnd; i++) v = v * 256 + buf[i];
          timecodeScale = v || timecodeScale;
        }
        if (c.id !== ID_DURATION) children.push(buf.subarray(p, cEnd));
        p = cEnd;
      }
      const dur = new Uint8Array(11);
      dur[0] = 68;
      dur[1] = 137;
      dur[2] = 136;
      new DataView(dur.buffer).setFloat64(3, durationMs * (1e6 / timecodeScale));
      const bodyLen = children.reduce((a, c) => a + c.length, 0) + dur.length;
      const idBytes = buf.subarray(pos, pos + el.len);
      const newInfo = new Uint8Array(el.len + 8 + bodyLen);
      newInfo.set(idBytes, 0);
      newInfo.set(sizeVint8(bodyLen), el.len);
      let o = el.len + 8;
      for (const c of children) {
        newInfo.set(c, o);
        o += c.length;
      }
      newInfo.set(dur, o);
      return new Blob([buf.subarray(0, pos), newInfo, blob.slice(infoEnd)], { type: blob.type });
    }
    if (sz.unknown) return blob;
    pos = dataStart + sz.value;
  }
  return blob;
}

// src/storage/db.js
var DB_NAME = "fullpage-hd-capture";
var DB_VERSION = 1;
var dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("items")) {
        const s = db.createObjectStore("items", { keyPath: "id" });
        s.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "key" });
      if (!db.objectStoreNames.contains("chunks")) {
        const c = db.createObjectStore("chunks", { keyPath: ["recId", "seq"] });
        c.createIndex("recId", "recId");
      }
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "itemId" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => {
      result = r;
    }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Transaction aborted"));
  });
}
function newId(prefix = "c") {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${rnd[0].toString(36)}${rnd[1].toString(36)}`;
}
var putItem = (item) => tx(["items"], "readwrite", (t) => promisify(t.objectStore("items").put(item)));
var putBlob = (key, blob) => tx(["blobs"], "readwrite", (t) => promisify(t.objectStore("blobs").put({ key, blob })));
var putChunk = (recId, seq, blob) => tx(["chunks"], "readwrite", (t) => promisify(t.objectStore("chunks").put({ recId, seq, blob, at: Date.now() })));
async function getChunks(recId) {
  const rows = await tx(["chunks"], "readonly", (t) => promisify(t.objectStore("chunks").index("recId").getAll(recId)));
  return rows.sort((a, b) => a.seq - b.seq).map((r) => r.blob);
}
async function deleteChunks(recId) {
  return tx(["chunks"], "readwrite", (t) => {
    const idx = t.objectStore("chunks").index("recId");
    const req = idx.openKeyCursor(IDBKeyRange.only(recId));
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        t.objectStore("chunks").delete(c.primaryKey);
        c.continue();
      }
    };
  });
}

// src/screen-recorder/recorder-engine.js
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function describeGumError(e, what) {
  const n = e?.name || "";
  if (n === "NotAllowedError") return `${what} permission was denied. Allow it in the extension's Screen Recorder page (or Chrome site settings) and try again.`;
  if (n === "NotFoundError" || n === "OverconstrainedError") return `No ${what.toLowerCase()} was found.`;
  if (n === "NotReadableError") return `The ${what.toLowerCase()} is in use by another application.`;
  if (n === "AbortError") return `${what} capture was aborted${e?.message ? ` (${e.message})` : ""}.`;
  return `${what} error: ${e?.message || n || e}`;
}
var RecordingSession = class {
  constructor({ send }) {
    this.send = send;
    this.state = "idle";
    this.recId = newId("rec");
    this.warnings = [];
    this.tracks = [];
    this.seq = 0;
    this.camSeq = 0;
    this.bytes = 0;
    this.writeChain = Promise.resolve();
    this.pausedTotal = 0;
    this.pauseStart = 0;
    this.startTime = 0;
    this.muted = false;
    this.cancelled = false;
    this.statusTimer = null;
    this.finishing = null;
  }
  elapsed() {
    if (!this.startTime) return 0;
    const now = this.state === "paused" ? this.pauseStart : performance.now();
    return Math.max(0, (now - this.startTime - this.pausedTotal) / 1e3);
  }
  status(extra = {}) {
    const lv = this.mixer ? this.mixer.levels() : { mic: 0, source: 0 };
    const vs = this.videoTrack?.getSettings?.() || {};
    return {
      state: this.state,
      elapsed: this.elapsed(),
      bytes: this.bytes,
      micLevel: lv.mic,
      sourceLevel: lv.source,
      muted: this.muted,
      hasMic: !!this.micStream,
      hasSourceAudio: !!this.sourceAudio,
      webcam: !!this.camStream,
      webcamVisible: this.compositor ? this.compositor.camVisible : !!this.camStream,
      width: this.outWidth || vs.width || 0,
      height: this.outHeight || vs.height || 0,
      fps: this.measuredFps || Math.round(vs.frameRate || 0),
      targetFps: this.settings?.recFps,
      mimeType: this.mimeType,
      bitrate: this.vbr,
      source: this.source,
      warnings: this.warnings,
      recId: this.recId,
      ...extra
    };
  }
  pushStatus(extra) {
    this.send({ type: "rec:status", status: this.status(extra) });
  }
  async begin({ streamId, source, canTabAudio, settings, meta, tabSize }) {
    this.settings = settings;
    this.source = source;
    this.meta = meta || {};
    const fps = Number(settings.recFps) || 30;
    const [maxW, maxH] = RESOLUTIONS[settings.recResolution] || RESOLUTIONS["1080"];
    const chromeMediaSource = source === "tab" ? "tab" : "desktop";
    const wantSourceAudio = settings.recAudio === "tab" || settings.recAudio === "both";
    const wantMic = settings.recAudio === "mic" || settings.recAudio === "both";
    const video = { mandatory: { chromeMediaSource, chromeMediaSourceId: streamId, maxWidth: maxW, maxHeight: maxH, maxFrameRate: fps } };
    if (tabSize?.width && tabSize?.height) {
      const landscapeBox = tabSize.width >= tabSize.height ? [maxW, maxH] : [maxH, maxW];
      const k = Math.min(1, landscapeBox[0] / tabSize.width, landscapeBox[1] / tabSize.height);
      const w = Math.max(2, Math.round(tabSize.width * k / 2) * 2);
      const h2 = Math.max(2, Math.round(tabSize.height * k / 2) * 2);
      Object.assign(video.mandatory, { minWidth: w, maxWidth: w, minHeight: h2, maxHeight: h2 });
      this.nativeSize = tabSize;
    }
    let stream;
    const audio = wantSourceAudio && (source === "tab" || canTabAudio) ? { mandatory: { chromeMediaSource, chromeMediaSourceId: streamId } } : false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch (e) {
      if (audio) {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }).catch((e2) => {
          throw new Error(describeGumError(e2, "Screen"));
        });
        this.warnings.push(source === "tab" ? "Tab audio could not be captured." : "System audio is not available for the selected source.");
      } else throw new Error(describeGumError(e, "Screen"));
    }
    if (wantSourceAudio && source !== "tab" && !canTabAudio) {
      this.warnings.push("System audio was not shared. On Windows/ChromeOS tick \u201CShare system audio\u201D; on macOS/Linux only tab audio is available from Chrome.");
    }
    this.screenStream = stream;
    this.videoTrack = stream.getVideoTracks()[0];
    this.tracks.push(...stream.getTracks());
    this.videoTrack.addEventListener("ended", () => this.onSourceEnded());
    try {
      this.videoTrack.contentHint = "detail";
    } catch {
    }
    const srcAudio = stream.getAudioTracks()[0];
    if (srcAudio) this.sourceAudio = srcAudio;
    if (wantMic) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: settings.micDeviceId ? { exact: settings.micDeviceId } : void 0,
            echoCancellation: settings.micEchoCancellation !== false,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (e) {
        if (settings.micDeviceId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
          if (this.micStream) this.warnings.push("The selected microphone was not found; the default microphone is used.");
        }
        if (!this.micStream) this.warnings.push(`${describeGumError(e, "Microphone")} Recording continues without the microphone.`);
      }
      if (this.micStream) this.tracks.push(...this.micStream.getTracks());
    }
    let audioTrack = null;
    if (this.sourceAudio || this.micStream) {
      this.mixer = new AudioMixer();
      await this.mixer.resume();
      if (this.sourceAudio) this.mixer.addSourceAudio(new MediaStream([this.sourceAudio]), { monitor: source === "tab" });
      if (this.micStream) this.mixer.addMic(this.micStream);
      audioTrack = this.mixer.track;
    }
    let videoOut = this.videoTrack;
    if (settings.webcamEnabled) {
      try {
        this.camStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: settings.webcamDeviceId ? { exact: settings.webcamDeviceId } : void 0, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
        });
        this.tracks.push(...this.camStream.getTracks());
      } catch (e) {
        this.warnings.push(`${describeGumError(e, "Camera")} Recording continues without the webcam.`);
      }
      if (this.camStream && settings.webcamMode !== "separate") {
        if (Compositor.supported()) {
          this.compositor = new Compositor(this.videoTrack, this.camStream.getVideoTracks()[0], {
            fps,
            size: settings.webcamSize,
            shape: settings.webcamShape,
            position: settings.webcamPosition,
            x: settings.webcamX,
            y: settings.webcamY,
            opacity: settings.webcamOpacity,
            mirror: true
          });
          this.compositor.start();
          videoOut = this.compositor.track;
        } else {
          this.warnings.push("Webcam compositing is not supported by this Chrome version; the webcam is saved as a separate editable track.");
          settings.webcamMode = "separate";
        }
      }
    }
    const vs = this.videoTrack.getSettings();
    this.outWidth = vs.width;
    this.outHeight = vs.height;
    const { mimeType, fallback } = pickMimeType(settings.recCodec, !!audioTrack);
    if (fallback) this.warnings.push(`The ${settings.recCodec.toUpperCase()} codec is not supported here; using ${mimeType}.`);
    this.mimeType = mimeType;
    this.vbr = videoBitrate({ width: vs.width || maxW, height: vs.height || maxH, fps, quality: settings.recQuality, customMbps: settings.recBitrateMbps });
    const recStream = new MediaStream([videoOut, ...audioTrack ? [audioTrack] : []]);
    this.recorder = new MediaRecorder(recStream, { mimeType, videoBitsPerSecond: this.vbr, audioBitsPerSecond: audioBitrate(settings.recQuality), videoKeyFrameIntervalDuration: 2e3 });
    this.recorder.ondataavailable = (e) => this.onData(e.data, false);
    this.recorder.onerror = (e) => this.fail(`Recorder error: ${e.error?.message || e.error?.name || "unknown"}`);
    if (this.camStream && settings.webcamMode === "separate") {
      const camMime = pickMimeType("vp9", false).mimeType;
      this.camRecorder = new MediaRecorder(new MediaStream(this.camStream.getVideoTracks()), { mimeType: camMime, videoBitsPerSecond: 4e6 });
      this.camRecorder.ondataavailable = (e) => this.onData(e.data, true);
    }
    this.lastFrames = null;
    this.statusTimer = setInterval(() => this.tick(), 500);
    const cd = Number(settings.countdown) || 0;
    for (let i = cd; i > 0; i--) {
      if (this.cancelled) return { ok: true, cancelled: true };
      this.state = "countdown";
      this.pushStatus({ countdown: i });
      await sleep(1e3);
    }
    if (this.cancelled || this.state === "stopping") return { ok: true, cancelled: true };
    if (cd > 0) {
      this.state = "starting";
      this.pushStatus();
      await sleep(250);
    }
    this.thumbPromise = this.grabFrame().catch(() => null);
    this.recorder.start(1e3);
    this.camRecorder?.start(1e3);
    this.startTime = performance.now();
    this.state = "recording";
    this.pushStatus();
    return { ok: true, width: vs.width, height: vs.height, frameRate: vs.frameRate, mimeType, warnings: this.warnings };
  }
  tick() {
    const t = this.videoTrack;
    try {
      const st = t?.stats;
      if (st && typeof st.totalFrames === "number") {
        const now = performance.now();
        if (this.lastFrames) {
          const df = st.totalFrames - this.lastFrames.n;
          const dt = (now - this.lastFrames.t) / 1e3;
          if (dt > 0) this.measuredFps = Math.round(df / dt);
        }
        this.lastFrames = { n: st.totalFrames, t: now };
      }
    } catch {
    }
    if (this.state === "recording" || this.state === "paused" || this.state === "countdown") this.pushStatus();
  }
  onData(blob, isCam) {
    if (!blob || !blob.size) return;
    const seq = isCam ? this.camSeq++ : this.seq++;
    if (!isCam) this.bytes += blob.size;
    const recId = isCam ? `${this.recId}_cam` : this.recId;
    this.writeChain = this.writeChain.then(() => putChunk(recId, seq, blob)).catch((e) => {
      this.warnings.push(`Writing to storage failed: ${e.message}`);
      this.fail("Storage is full or unavailable \u2013 the recording was stopped.");
    });
  }
  pause() {
    if (this.state !== "recording") return;
    this.recorder.pause();
    this.camRecorder?.pause();
    this.pauseStart = performance.now();
    this.state = "paused";
    this.pushStatus();
  }
  resume() {
    if (this.state !== "paused") return;
    this.recorder.resume();
    this.camRecorder?.resume();
    this.pausedTotal += performance.now() - this.pauseStart;
    this.pauseStart = 0;
    this.state = "recording";
    this.pushStatus();
  }
  setMuted(m) {
    this.muted = !!m;
    this.mixer?.setMicMuted(this.muted);
    this.pushStatus();
  }
  setWebcam({ enabled, position }) {
    if (!this.compositor) return { ok: false, error: "The webcam can only be toggled when the recording was started with the webcam enabled." };
    if (typeof enabled === "boolean") this.compositor.setCamVisible(enabled);
    if (position) this.compositor.setLayout({ position });
    this.pushStatus();
    return { ok: true };
  }
  onSourceEnded() {
    if (this.state === "recording" || this.state === "paused") {
      this.warnings.push("Sharing was stopped (the source ended or \u201CStop sharing\u201D was clicked). The recording was saved.");
      this.stop();
    } else if (this.state === "countdown" || this.state === "starting") this.cancel();
  }
  async grabFrame() {
    if (this.compositor?.canvas) return this.compositor.snapshot();
    const ic = new ImageCapture(this.videoTrack);
    const bmp = await ic.grabFrame();
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close();
    return c.convertToBlob({ type: "image/png" });
  }
  /** Screenshot of the current frame, saved to Capture History. */
  async screenshot() {
    const blob = await this.grabFrame();
    const bmp = await createImageBitmap(blob);
    const id = newId("shot");
    await putBlob(`${id}:seg0`, blob);
    const tc = new OffscreenCanvas(320, Math.max(1, Math.round(320 * bmp.height / bmp.width)));
    tc.getContext("2d").drawImage(bmp, 0, 0, tc.width, tc.height);
    await putBlob(`${id}:thumb`, await tc.convertToBlob({ type: "image/jpeg", quality: 0.8 }));
    await putItem({
      id,
      kind: "screenshot",
      mode: "recording-frame",
      title: `${this.meta.title || "Recording"} \u2013 frame at ${this.elapsed().toFixed(1)}s`,
      url: this.meta.url || "",
      createdAt: Date.now(),
      width: bmp.width,
      height: bmp.height,
      cssWidth: bmp.width,
      cssHeight: bmp.height,
      scale: 1,
      dpr: 1,
      frames: 1,
      status: "complete",
      warnings: [],
      segments: [{ key: `${id}:seg0`, y: 0, height: bmp.height, size: blob.size }],
      size: blob.size,
      thumbKey: `${id}:thumb`,
      format: "png"
    });
    bmp.close();
    return { ok: true, itemId: id };
  }
  fail(message) {
    if (this.state === "done" || this.state === "error") return;
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
    if (!rec || rec.state === "inactive") return;
    await new Promise((resolve) => {
      rec.addEventListener("stop", resolve, { once: true });
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
  }
  async _finish() {
    const wasRecording = this.startTime > 0;
    const duration = this.elapsed();
    this.state = "stopping";
    this.pushStatus();
    clearInterval(this.statusTimer);
    await Promise.all([this._waitStop(this.recorder), this._waitStop(this.camRecorder)]);
    await this.writeChain;
    const thumb = this.thumbPromise ? await this.thumbPromise : null;
    this.releaseMedia();
    if (this.cancelled || !wasRecording) {
      await deleteChunks(this.recId);
      await deleteChunks(`${this.recId}_cam`);
      this.state = "cancelled";
      this.send({ type: "rec:finished", cancelled: true });
      return { ok: true, cancelled: true };
    }
    try {
      const itemId = await this.assemble(duration, thumb);
      this.state = "done";
      this.send({ type: "rec:finished", itemId });
      return { ok: true, itemId };
    } catch (e) {
      this.state = "error";
      this.send({ type: "rec:finished", error: `Saving the recording failed: ${e.message}. The raw data is kept and can be recovered from Capture History.` });
      return { ok: false, error: e.message };
    }
  }
  async assemble(duration, thumb) {
    const chunks = await getChunks(this.recId);
    if (!chunks.length) throw new Error("No video data was recorded");
    const type = this.mimeType.split(";")[0];
    let blob = new Blob(chunks, { type });
    if (type === "video/webm") blob = await fixWebmDuration(blob, duration * 1e3);
    const id = this.recId;
    await putBlob(`${id}:video`, blob);
    let webcamBlobKey = null;
    if (this.camRecorder) {
      const camChunks = await getChunks(`${id}_cam`);
      if (camChunks.length) {
        let cb = new Blob(camChunks, { type: "video/webm" });
        cb = await fixWebmDuration(cb, duration * 1e3);
        webcamBlobKey = `${id}:webcam`;
        await putBlob(webcamBlobKey, cb);
      }
    }
    let thumbKey = null;
    if (thumb) {
      try {
        const bmp = await createImageBitmap(thumb);
        const tc = new OffscreenCanvas(320, Math.max(1, Math.round(320 * bmp.height / bmp.width)));
        tc.getContext("2d").drawImage(bmp, 0, 0, tc.width, tc.height);
        bmp.close();
        thumbKey = `${id}:thumb`;
        await putBlob(thumbKey, await tc.convertToBlob({ type: "image/jpeg", quality: 0.8 }));
      } catch {
        thumbKey = null;
      }
    }
    const ext = type === "video/mp4" ? "mp4" : "webm";
    await putItem({
      id,
      kind: "video",
      title: this.meta.title ? `Recording \u2013 ${this.meta.title}` : "Screen recording",
      url: this.meta.url || "",
      createdAt: Date.now(),
      duration,
      width: this.outWidth,
      height: this.outHeight,
      fps: this.measuredFps || Number(this.settings.recFps),
      targetFps: Number(this.settings.recFps),
      format: ext,
      mimeType: this.mimeType,
      bitrate: this.vbr,
      size: blob.size,
      blobKey: `${id}:video`,
      thumbKey,
      webcamBlobKey,
      webcamLayout: webcamBlobKey ? {
        size: this.settings.webcamSize,
        shape: this.settings.webcamShape,
        position: this.settings.webcamPosition,
        x: this.settings.webcamX,
        y: this.settings.webcamY,
        opacity: this.settings.webcamOpacity
      } : null,
      source: this.source,
      audio: { mic: !!this.micStream, source: !!this.sourceAudio },
      warnings: this.warnings,
      status: "complete"
    });
    await deleteChunks(id);
    await deleteChunks(`${id}_cam`);
    return id;
  }
  releaseMedia() {
    this.compositor?.stop();
    for (const t of this.tracks) {
      try {
        t.stop();
      } catch {
      }
    }
    this.tracks = [];
    this.mixer?.close();
    this.mixer = null;
  }
};

// src/screen-recorder/recorder-host.js
function hostRecorder(hostId2, { onStatus } = {}) {
  let session = null;
  const send = (msg) => {
    if (msg.type === "rec:status") onStatus?.(msg.status);
    return chrome.runtime.sendMessage({ ...msg, hostId: hostId2 }).catch(() => {
    });
  };
  const handlers = {
    "rec:begin": async (m) => {
      if (session && !["done", "error", "cancelled"].includes(session.state)) return { ok: false, error: "Already recording" };
      session = new RecordingSession({ send });
      try {
        return await session.begin(m);
      } catch (e) {
        session.releaseMedia();
        session = null;
        send({ type: "rec:finished", error: e.message });
        return { ok: false, error: e.message };
      }
    },
    "rec:pause": async () => {
      session?.pause();
      return { ok: true };
    },
    "rec:resume": async () => {
      session?.resume();
      return { ok: true };
    },
    "rec:stop": async () => {
      if (!session) return { ok: false, error: "Not recording" };
      if (session.state === "countdown" || session.state === "starting") return session.cancel();
      return session.stop();
    },
    "rec:cancel": async () => session ? session.cancel() : { ok: true },
    "rec:mute": async (m) => {
      session?.setMuted(m.muted);
      return { ok: true };
    },
    "rec:webcam": async (m) => session ? session.setWebcam(m) : { ok: false },
    "rec:screenshot": async () => {
      if (!session) return { ok: false, error: "Not recording" };
      const r = await session.screenshot();
      send({ type: "rec:notify", text: "Screenshot saved to Capture History" });
      return r;
    },
    "rec:ping": async () => ({ ok: true, state: session?.state || "idle" })
  };
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== "recorder" || msg.hostId !== hostId2) return false;
    const h2 = handlers[msg.type];
    if (!h2) return false;
    h2(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  });
  return {
    get session() {
      return session;
    },
    handle: (type, m = {}) => handlers[type]?.(m)
  };
}

// src/shared/settings.js
var DEFAULT_SETTINGS = {
  // Screenshot
  jpgQuality: 95,
  // 90 | 95 | 100
  chromaSubsampling: "444",
  // '444' (sharpest text) | '420' (smaller)
  scrollDelay: 350,
  // ms to wait after each scroll before capturing
  lazyLoadPrep: true,
  // pre-scroll the page to trigger lazy-loaded content
  lazyLoadDelay: 200,
  // ms per step during pre-scroll
  stickyMode: "minimize",
  // 'normal' | 'minimize'
  hideScrollbars: true,
  maxCaptureHeight: 6e4,
  // CSS px – protects against infinite scroll
  captureHorizontal: true,
  // capture horizontally scrolling pages too
  pdfLayout: "single",
  // 'single' (one long page) | 'paged'
  pdfPaper: "a4",
  // 'a4' | 'letter'
  pdfOrientation: "portrait",
  // 'portrait' | 'landscape'
  pdfMarginMm: 10,
  pdfSmartBreaks: true,
  // avoid cutting through text lines on page breaks
  openEditorAfterCapture: true,
  // Recording
  recSource: "tab",
  // 'tab' | 'screen'
  recResolution: "1080",
  // '720' | '1080' | '1440' | '2160' | 'source'
  recFps: 30,
  // 24 | 30 | 60
  recQuality: "high",
  // 'standard' | 'high' | 'max' | 'custom'
  recBitrateMbps: 12,
  // used when recQuality === 'custom'
  recCodec: "vp9",
  // 'vp9' | 'vp8' | 'av1' | 'h264'
  recAudio: "tab",
  // 'none' | 'mic' | 'tab' | 'both'
  micDeviceId: "",
  micEchoCancellation: true,
  webcamEnabled: false,
  webcamDeviceId: "",
  webcamMode: "burn",
  // 'burn' (composited into video) | 'separate' (editable track in the editor)
  webcamShape: "circle",
  // 'circle' | 'rect'
  webcamSize: 22,
  // % of output width
  webcamOpacity: 100,
  // %
  webcamPosition: "bottom-right",
  // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'custom'
  webcamX: 0.78,
  webcamY: 0.7,
  // normalised custom position (top-left corner)
  countdown: 3,
  // 0 | 3 | 5 | 10
  showToolbar: true,
  // in-page recording toolbar (it is part of the captured tab)
  cursorHighlight: false,
  clickEffects: true,
  syntheticCursor: true,
  // draw a cursor in tab recordings (tab capture never includes the OS cursor)
  cursorColor: "#facc15",
  cursorSize: 36,
  clickColorLeft: "#3b82f6",
  clickColorRight: "#ef4444",
  openEditorAfterRecording: true,
  // Video editor / export
  exportFormat: "webm",
  // 'webm' | 'mp4'
  exportResolution: "source",
  // 'source' | '2160' | '1440' | '1080' | '720' | '480'
  exportFps: "source",
  // 'source' | 24 | 30 | 60
  exportQuality: "high",
  // 'standard' | 'high' | 'max'
  previewQuality: "full",
  // 'full' | 'half'
  // Files
  screenshotPattern: "FullPage_Capture_{site}_{date}",
  videoPattern: "Screen_Recording_{date}_{time}",
  downloadSubfolder: "FullPage HD Capture",
  askWhereToSave: false,
  // UI
  theme: "system"
  // 'system' | 'light' | 'dark'
};
async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings || {} };
}

// src/shared/ui.js
var $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
var ICONS = {
  capture: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M8 8h8v8H8z"/>',
  page: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
  visible: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  editor: '<path d="M4 20h16M4 16l10-10 4 4-10 10H4z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: '<path d="M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.7M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  rotateL: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  arrow: '<path d="M5 19L19 5M19 5h-8M19 5v8"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6.5"/>',
  highlight: '<path d="M4 20h7M14 4l6 6-8 8H6v-6l8-8z"/>',
  blur: '<circle cx="7" cy="7" r="1.5"/><circle cx="12" cy="7" r="1.5"/><circle cx="17" cy="7" r="1.5"/><circle cx="7" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="17" cy="12" r="1.5"/><circle cx="7" cy="17" r="1.5"/><circle cx="12" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/>',
  pen: '<path d="M3 21l3.8-1 11-11-2.8-2.8-11 11L3 21z"/>',
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6"/>',
  split: '<path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  file: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
  webcam: '<circle cx="12" cy="10" r="6"/><circle cx="12" cy="10" r="2"/><path d="M8 21h8M12 16v5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'
};
var icon = (name, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[name] || ""}</svg>`;
async function applyTheme() {
  try {
    const s = await getSettings();
    if (s.theme === "light" || s.theme === "dark") document.documentElement.dataset.theme = s.theme;
    else delete document.documentElement.dataset.theme;
  } catch {
  }
}

// src/shared/format.js
function formatBytes(n) {
  if (n == null || !isFinite(n)) return "\u2014";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function formatDuration(sec, withMs = false) {
  if (sec == null || !isFinite(sec)) return "\u2014";
  sec = Math.max(0, sec);
  const h2 = Math.floor(sec / 3600);
  const m = Math.floor(sec % 3600 / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor(sec % 1 * 100);
  const base = h2 > 0 ? `${h2}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return withMs ? `${base}.${String(ms).padStart(2, "0")}` : base;
}

// src/screen-recorder/recorder-window.js
var q = new URLSearchParams(location.search);
var reqId = q.get("req");
var hostId = `window:${reqId}`;
var sources = (q.get("sources") || "screen,window,tab,audio").split(",");
var lastState = "idle";
var minimised = false;
var host = hostRecorder(hostId, { onStatus: render });
function render(st) {
  lastState = st.state;
  const badge = $("#badge");
  badge.textContent = st.state === "recording" ? "\u25CF REC" : st.state === "paused" ? "PAUSED" : st.state === "countdown" ? `Starting in ${st.countdown}` : st.state;
  badge.className = `badge ${st.state === "recording" ? "rec" : ""}`;
  $("#msg").style.display = "none";
  for (const id of ["time", "meta", "controls", "hint"]) $(`#${id}`).style.display = "";
  $("#time").textContent = formatDuration(st.elapsed || 0);
  $("#meta").textContent = `${st.width || "?"}\xD7${st.height || "?"}${st.fps ? ` \xB7 ${st.fps} fps` : ""} \xB7 ${formatBytes(st.bytes)}`;
  const meter = $("#meter");
  meter.style.display = st.hasMic ? "" : "none";
  meter.firstElementChild.style.width = `${Math.round((st.muted ? 0 : st.micLevel || 0) * 100)}%`;
  const warn = $("#warn");
  warn.style.display = st.warnings?.length ? "" : "none";
  warn.textContent = (st.warnings || []).join(" ");
  const c = $("#controls");
  const paused = st.state === "paused";
  const mk = (ic, label, fn, cls = "") => {
    const b = h("button", { class: `btn ${cls}`, html: `${icon(ic)}<span>${label}</span>` });
    b.addEventListener("click", fn);
    return b;
  };
  c.replaceChildren(
    mk(paused ? "play" : "pause", paused ? "Resume" : "Pause", () => host.handle(paused ? "rec:resume" : "rec:pause")),
    mk("stop", "Stop", () => host.handle("rec:stop"), "primary"),
    mk("x", "Discard", () => {
      if (confirm("Discard this recording?")) host.handle("rec:cancel");
    }, "danger"),
    st.hasMic ? mk(st.muted ? "micOff" : "mic", st.muted ? "Unmute" : "Mute", () => host.handle("rec:mute", { muted: !st.muted })) : null,
    mk("camera", "Screenshot", () => host.handle("rec:screenshot"))
  );
  if (st.state === "recording" && !minimised) {
    minimised = true;
    chrome.windows.getCurrent().then((w) => chrome.windows.update(w.id, { state: "minimized" })).catch(() => {
    });
  }
}
addEventListener("beforeunload", (e) => {
  if (lastState === "recording" || lastState === "paused") {
    e.preventDefault();
    e.returnValue = "";
  }
});
addEventListener("pagehide", () => {
  if (host.session && ["recording", "paused"].includes(host.session.state)) host.session.stop();
});
applyTheme();
chrome.desktopCapture.chooseDesktopMedia(sources, (streamId, options) => {
  chrome.runtime.sendMessage({ type: "picker:result", reqId, hostId, streamId: streamId || null, canRequestAudioTrack: !!options?.canRequestAudioTrack });
  if (!streamId) window.close();
  else $("#msg").textContent = "Starting\u2026";
});
//# sourceMappingURL=recorder-window.js.map
