// Web Audio mixer: combines tab/system audio and microphone into one track for MediaRecorder.
//  * Tab audio is also routed back to the speakers (tab capture otherwise mutes the tab for the user).
//  * The microphone is never routed to the speakers (prevents feedback / echo loops).
export class AudioMixer {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.dest = this.ctx.createMediaStreamDestination();
    this.dest.channelCount = 2;
    this.micGain = null; this.micAnalyser = null; this.srcAnalyser = null;
    this.nodes = [];
    this.levelBuf = new Float32Array(2048);
  }

  async resume() { if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {}); }

  addSourceAudio(stream, { monitor = false } = {}) {
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain(); gain.gain.value = 1;
    src.connect(gain); gain.connect(this.dest);
    if (monitor) gain.connect(this.ctx.destination);
    this.srcAnalyser = this.ctx.createAnalyser(); this.srcAnalyser.fftSize = 2048; gain.connect(this.srcAnalyser);
    this.nodes.push(src, gain);
  }

  addMic(stream) {
    const src = this.ctx.createMediaStreamSource(stream);
    this.micGain = this.ctx.createGain(); this.micGain.gain.value = 1;
    this.micAnalyser = this.ctx.createAnalyser(); this.micAnalyser.fftSize = 2048;
    src.connect(this.micGain); this.micGain.connect(this.dest); this.micGain.connect(this.micAnalyser);
    this.nodes.push(src);
  }

  setMicMuted(muted) {
    if (this.micGain) this.micGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.015);
  }

  static rms(analyser, buf) {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.min(1, Math.sqrt(s / buf.length) * 4);
  }

  levels() {
    return { mic: AudioMixer.rms(this.micAnalyser, this.levelBuf), source: AudioMixer.rms(this.srcAnalyser, this.levelBuf) };
  }

  get track() { return this.dest.stream.getAudioTracks()[0] || null; }

  close() {
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    this.ctx.close().catch(() => {});
  }
}
