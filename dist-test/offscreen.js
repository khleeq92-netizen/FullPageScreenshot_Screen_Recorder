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
  const h = shape === "circle" ? w : Math.round(w / camAspect);
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
    y = outH - h - m;
  } else if (pos === "custom") {
    x = Math.round((o.x ?? o.webcamX ?? 0.75) * outW);
    y = Math.round((o.y ?? o.webcamY ?? 0.7) * outH);
  } else {
    x = outW - w - m;
    y = outH - h - m;
  }
  x = Math.max(0, Math.min(outW - w, x));
  y = Math.max(0, Math.min(outH - h, y));
  return { x, y, w, h, shape };
}
function drawWebcam(ctx, frame, frameW, frameH, rect, { opacity = 1, mirror = true, border = true } = {}) {
  const { x, y, w, h, shape } = rect;
  const scale = Math.max(w / frameW, h / frameH);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (frameW - sw) / 2;
  const sy = (frameH - sh) / 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));
  ctx.beginPath();
  if (shape === "circle") ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
  else if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.08);
  else ctx.rect(x, y, w, h);
  ctx.save();
  ctx.clip();
  if (mirror) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h);
  } else ctx.drawImage(frame, sx, sy, sw, sh, x, y, w, h);
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
  const h = readId(buf, pos);
  if (!h || h.id !== 440786851) return blob;
  pos += h.len;
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
      const h = Math.max(2, Math.round(tabSize.height * k / 2) * 2);
      Object.assign(video.mandatory, { minWidth: w, maxWidth: w, minHeight: h, maxHeight: h });
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
function hostRecorder(hostId, { onStatus } = {}) {
  let session = null;
  const send = (msg) => {
    if (msg.type === "rec:status") onStatus?.(msg.status);
    return chrome.runtime.sendMessage({ ...msg, hostId }).catch(() => {
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
    if (msg?.target !== "recorder" || msg.hostId !== hostId) return false;
    const h = handlers[msg.type];
    if (!h) return false;
    h(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  });
  return {
    get session() {
      return session;
    },
    handle: (type, m = {}) => handlers[type]?.(m)
  };
}

// src/screen-recorder/offscreen.js
var host = hostRecorder("offscreen");
addEventListener("pagehide", () => {
  if (host.session?.state === "recording") host.session.stop();
});
//# sourceMappingURL=offscreen.js.map
