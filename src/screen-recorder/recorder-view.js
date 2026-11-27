// Screen Recorder page (dashboard): full configuration, device selection, permission grants,
// microphone test, webcam preview/layout and recording controls.
import { h, icon, send, toast } from '../shared/ui.js';
import { getSettings, saveSettings } from '../shared/settings.js';
import { formatBytes, formatDuration } from '../shared/format.js';
import { webcamRect } from '../webcam/webcam-layout.js';
import { capturableTabs, tabSelect, selectedTabId, ensureHostAccess } from '../app/common.js';
import { restrictionReason } from '../screenshot/capture-controller.js';
import { RESOLUTIONS } from './codecs.js';

async function permState(name) {
  try { return (await navigator.permissions.query({ name })).state; } catch { return 'prompt'; }
}

function stopStream(s) { s?.getTracks().forEach((t) => t.stop()); }

export async function renderRecorder({ view, params, head }) {
  let s = await getSettings();
  const resources = { mic: null, cam: null, ctx: null, raf: 0 };
  const save = async (patch) => { s = await saveSettings(patch); };
  const field = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint ? h('span', { class: 'small', style: { fontWeight: 400 } }, hint) : null);
  const select = (key, opts, onChange) => {
    const el = h('select', { id: `opt-${key}` });
    for (const [v, l] of opts) el.append(h('option', { value: v, selected: String(s[key]) === String(v) }, l));
    el.addEventListener('change', async () => { await save({ [key]: typeof s[key] === 'number' ? Number(el.value) : el.value }); onChange?.(); });
    return el;
  };
  const check = (key, label, onChange) => {
    const c = h('input', { type: 'checkbox', id: `opt-${key}`, checked: !!s[key] });
    c.addEventListener('change', async () => { await save({ [key]: c.checked }); onChange?.(); });
    return h('label', { class: 'check' }, c, label);
  };

  // ---------------------------------------------------------------- active recording panel
  const active = h('div', { class: 'card col', id: 'rec-active', style: { display: 'none', marginBottom: '16px' } });
  const renderActive = (st) => {
    if (!st?.active) { active.style.display = 'none'; return; }
    active.style.display = '';
    const paused = st.state === 'paused';
    const btn = (id, ic, label, fn, cls = '') => { const b = h('button', { class: `btn ${cls}`, id, html: `${icon(ic)}<span>${label}</span>` }); b.addEventListener('click', fn); return b; };
    active.replaceChildren(
      h('div', { class: 'row' },
        h('span', { class: `badge ${paused ? '' : 'rec'}` }, st.state === 'countdown' ? `Starting in ${st.countdown}` : paused ? 'PAUSED' : st.state === 'recording' ? '● REC' : st.state),
        h('b', { style: { fontSize: '26px', fontVariantNumeric: 'tabular-nums' } }, formatDuration(st.elapsed || 0)),
        h('span', { class: 'muted grow' }, `${st.width || '?'}×${st.height || '?'} · ${st.fps || st.targetFps || '?'} fps · ${formatBytes(st.bytes)} · ${st.mimeType || ''}`)),
      h('div', { class: 'row wrap' },
        btn('ctl-pause', paused ? 'play' : 'pause', paused ? 'Resume' : 'Pause', () => send(paused ? 'rec:resume' : 'rec:pause')),
        btn('ctl-stop', 'stop', 'Stop & save', () => send('rec:stop'), 'primary'),
        btn('ctl-mute', st.muted ? 'micOff' : 'mic', st.muted ? 'Unmute mic' : 'Mute mic', () => send('rec:mute', { muted: !st.muted })),
        st.webcam ? btn('ctl-cam', 'webcam', st.webcamVisible ? 'Hide webcam' : 'Show webcam', () => send('rec:webcam', { enabled: !st.webcamVisible }).catch((e) => toast(e.message, 'error'))) : null,
        btn('ctl-annot', 'pen', 'Annotate on page', () => send('rec:annotate-toggle')),
        btn('ctl-shot', 'camera', 'Screenshot', () => send('rec:screenshot').then(() => toast('Frame saved to Capture History', 'ok'))),
        btn('ctl-cancel', 'x', 'Discard', () => { if (confirm('Discard this recording?')) send('rec:cancel'); }, 'danger')),
      st.hasMic ? h('div', { class: 'meter', style: { maxWidth: '320px' } }, h('i', { style: { width: `${Math.round((st.muted ? 0 : st.micLevel) * 100)}%` } })) : null,
      (st.warnings || []).length ? h('div', { class: 'notice warn' }, ...st.warnings.map((w) => h('div', {}, w))) : null);
  };

  // ---------------------------------------------------------------- permission grant flow
  const grant = params.get('grant');
  const grantBox = h('div', { class: 'notice warn col', style: { display: grant ? '' : 'none', marginBottom: '16px' } });
  if (grant) {
    const wants = grant.split(',');
    const b = h('button', { class: 'btn primary', id: 'grant-btn' }, `Allow ${wants.map((w) => (w === 'mic' ? 'microphone' : 'camera')).join(' & ')}`);
    b.addEventListener('click', async () => {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: wants.includes('mic'), video: wants.includes('cam') });
        stopStream(st);
        grantBox.replaceChildren(h('b', {}, '✓ Access granted.'), h('span', {}, 'Go back to the tab you want to record and press Record in the extension popup again — or start a recording from this page below.'));
        refreshDevices();
      } catch (e) {
        grantBox.replaceChildren(h('b', {}, 'Access was blocked.'), h('span', {}, `Chrome reported: ${e.name}. Click the camera/microphone icon in the address bar of this page to allow it, then reload.`));
      }
    });
    grantBox.append(h('b', {}, 'Permission needed'), h('span', {}, 'The recorder runs in a hidden background document that cannot show permission prompts. Grant access once here; Chrome remembers it for this extension.'), h('div', {}, b));
  }

  // ---------------------------------------------------------------- source
  const tabs = await capturableTabs();
  const tabSel = tabSelect(tabs.filter((t) => !t.url || !restrictionReason(t.url)), Number(params.get('tab')) || undefined, () => dispatchEvent(new HashChangeEvent('hashchange')));
  let source = s.recSource === 'tab' ? 'tab' : 'screen';
  const srcSeg = h('div', { class: 'seg', id: 'src-seg' });
  const srcNote = h('div', { class: 'muted small' });
  const tabRow = h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Tab:'), tabSel);
  for (const [v, l] of [['tab', 'Chrome tab'], ['screen', 'Entire screen / window']]) {
    const b = h('button', { class: v === source ? 'sel' : '' }, l);
    b.addEventListener('click', async () => { source = v; [...srcSeg.children].forEach((c) => c.classList.toggle('sel', c === b)); await save({ recSource: v }); updSrc(); });
    srcSeg.append(b);
  }
  const updSrc = () => {
    tabRow.style.display = source === 'tab' ? '' : 'none';
    srcNote.textContent = source === 'tab'
      ? 'Records the selected tab’s web content only (no address bar or browser UI). Supports tab audio, click effects and on-page annotation. Site access to the tab is requested once.'
      : 'Chrome’s screen picker lets you choose an entire screen, an application window or a tab. System audio is offered by Chrome where the platform supports it (Windows/ChromeOS: entire screen; all platforms: tabs).';
  };
  updSrc();

  // ---------------------------------------------------------------- devices
  const micSel = h('select', { id: 'mic-select' }); const camSel = h('select', { id: 'cam-select' });
  const meter = h('div', { class: 'meter', style: { flex: 1 } }, h('i'));
  const micStatus = h('span', { class: 'small muted' });
  async function refreshDevices() {
    let devs = [];
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch { /* ignore */ }
    const mics = devs.filter((d) => d.kind === 'audioinput'); const cams = devs.filter((d) => d.kind === 'videoinput');
    const fill = (sel, list, cur, noun) => {
      sel.replaceChildren(h('option', { value: '' }, `Default ${noun}`));
      list.forEach((d, i) => { if (d.deviceId && d.deviceId !== 'default') sel.append(h('option', { value: d.deviceId, selected: d.deviceId === cur }, d.label || `${noun} ${i + 1}`)); });
    };
    fill(micSel, mics, s.micDeviceId, 'microphone'); fill(camSel, cams, s.webcamDeviceId, 'camera');
    micStatus.textContent = !mics.length ? 'No microphone found.' : (await permState('microphone')) !== 'granted' ? 'Microphone access not granted yet.' : `${mics.length} microphone(s) available.`;
  }
  micSel.addEventListener('change', async () => { await save({ micDeviceId: micSel.value }); if (resources.mic) startMicMonitor(); });
  camSel.addEventListener('change', async () => { await save({ webcamDeviceId: camSel.value }); if (resources.cam) startCamPreview(); });

  async function startMicMonitor() {
    stopStream(resources.mic); resources.ctx?.close(); cancelAnimationFrame(resources.raf);
    try {
      resources.mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: s.micDeviceId ? { exact: s.micDeviceId } : undefined, echoCancellation: s.micEchoCancellation } });
      resources.ctx = new AudioContext();
      const an = resources.ctx.createAnalyser(); an.fftSize = 2048;
      resources.ctx.createMediaStreamSource(resources.mic).connect(an);
      const buf = new Float32Array(2048);
      const loop = () => {
        an.getFloatTimeDomainData(buf); let sum = 0; for (const v of buf) sum += v * v;
        meter.firstChild.style.width = `${Math.min(100, Math.sqrt(sum / buf.length) * 400)}%`;
        resources.raf = requestAnimationFrame(loop);
      };
      loop();
      micStatus.textContent = `Listening: ${resources.mic.getAudioTracks()[0]?.label || 'microphone'}`;
      refreshDevices();
    } catch (e) { micStatus.textContent = `Microphone unavailable: ${e.name === 'NotAllowedError' ? 'permission denied' : e.name === 'NotFoundError' ? 'no device' : e.message}`; }
  }

  const testBtn = h('button', { class: 'btn', id: 'mic-test', html: `${icon('mic')}<span>Test (record 3 s)</span>` });
  testBtn.addEventListener('click', async () => {
    try {
      if (!resources.mic) await startMicMonitor();
      if (!resources.mic) return;
      testBtn.disabled = true; testBtn.lastChild.textContent = 'Recording…';
      const mr = new MediaRecorder(resources.mic); const parts = [];
      mr.ondataavailable = (e) => parts.push(e.data);
      mr.start(); await new Promise((r) => setTimeout(r, 3000)); mr.stop();
      await new Promise((r) => { mr.onstop = r; });
      testBtn.lastChild.textContent = 'Playing back…';
      const a = new Audio(URL.createObjectURL(new Blob(parts, { type: mr.mimeType })));
      await a.play().catch(() => {});
      a.onended = () => { testBtn.disabled = false; testBtn.lastChild.textContent = 'Test (record 3 s)'; };
    } catch (e) { toast(e.message, 'error'); testBtn.disabled = false; }
  });

  // ---------------------------------------------------------------- webcam preview + layout
  const stage = h('div', { class: 'preview-stage', id: 'cam-stage' }, h('div', { class: 'fake' }));
  const camBox = h('div', { class: 'cam', style: { display: 'none' } }, h('video', { autoplay: true, muted: true, playsinline: true }));
  stage.append(camBox);
  const layoutCam = () => {
    const W = stage.clientWidth || 640; const H = stage.clientHeight || 360;
    const vid = camBox.firstChild;
    const r = webcamRect(W, H, { ...s, camAspect: vid.videoWidth ? vid.videoWidth / vid.videoHeight : 16 / 9 });
    Object.assign(camBox.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderRadius: r.shape === 'circle' ? '50%' : '8%', opacity: s.webcamOpacity / 100 });
  };
  async function startCamPreview() {
    stopStream(resources.cam);
    try {
      resources.cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: s.webcamDeviceId ? { exact: s.webcamDeviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } });
      camBox.firstChild.srcObject = resources.cam; camBox.style.display = '';
      camBox.firstChild.onloadedmetadata = layoutCam;
      layoutCam(); refreshDevices();
    } catch (e) { toast(`Camera unavailable: ${e.name === 'NotAllowedError' ? 'permission denied' : e.name === 'NotFoundError' ? 'no camera found' : e.message}`, 'error'); }
  }
  camBox.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const sr = stage.getBoundingClientRect(); const br = camBox.getBoundingClientRect();
    const ox = e.clientX - br.left; const oy = e.clientY - br.top;
    camBox.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const x = Math.max(0, Math.min(1 - br.width / sr.width, (ev.clientX - sr.left - ox) / sr.width));
      const y = Math.max(0, Math.min(1 - br.height / sr.height, (ev.clientY - sr.top - oy) / sr.height));
      s.webcamPosition = 'custom'; s.webcamX = x; s.webcamY = y; posSel.value = 'custom'; layoutCam();
    };
    const up = () => { camBox.removeEventListener('pointermove', mv); camBox.removeEventListener('pointerup', up); save({ webcamPosition: 'custom', webcamX: s.webcamX, webcamY: s.webcamY }); };
    camBox.addEventListener('pointermove', mv); camBox.addEventListener('pointerup', up);
  });
  const posSel = select('webcamPosition', [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'], ['custom', 'Custom (drag preview)']], layoutCam);
  const size = h('input', { type: 'range', min: 8, max: 45, value: s.webcamSize, id: 'opt-webcamSize' });
  size.addEventListener('input', () => { s.webcamSize = Number(size.value); layoutCam(); });
  size.addEventListener('change', () => save({ webcamSize: Number(size.value) }));
  const opa = h('input', { type: 'range', min: 20, max: 100, value: s.webcamOpacity, id: 'opt-webcamOpacity' });
  opa.addEventListener('input', () => { s.webcamOpacity = Number(opa.value); layoutCam(); });
  opa.addEventListener('change', () => save({ webcamOpacity: Number(opa.value) }));

  // ---------------------------------------------------------------- start
  const startBtn = h('button', { class: 'hero-btn record', id: 'rec-start', style: { minHeight: '64px', width: '100%' }, html: `${icon('record')}<span>START RECORDING</span><small id="start-sub"></small>` });
  const capInfo = h('div', { class: 'small muted', id: 'cap-info' });
  const updInfo = () => {
    const [w, hh] = RESOLUTIONS[s.recResolution] || [1920, 1080];
    capInfo.textContent = `Requested: up to ${s.recResolution === 'source' ? 'source resolution' : `${w}×${hh}`} at ${s.recFps} fps. The actual size and frame rate depend on the selected source and are shown once recording starts; video is never upscaled.`;
  };
  updInfo();
  startBtn.addEventListener('click', async () => {
    const needMic = s.recAudio === 'mic' || s.recAudio === 'both';
    try {
      if (needMic && (await permState('microphone')) !== 'granted') { await navigator.mediaDevices.getUserMedia({ audio: true }).then(stopStream); }
      if (s.webcamEnabled && (await permState('camera')) !== 'granted') { await navigator.mediaDevices.getUserMedia({ video: true }).then(stopStream); }
    } catch (e) { toast(`Permission denied: ${e.message}. You can still record without it.`, 'error', 6000); return; }
    stopStream(resources.mic); resources.mic = null; stopStream(resources.cam); resources.cam = null; camBox.style.display = 'none';
    startBtn.disabled = true;
    try {
      let req = { source, config: s };
      if (source === 'tab') {
        const tab = await chrome.tabs.get(selectedTabId(tabSel)).catch(() => null);
        if (!tab) throw new Error('Choose a tab to record.');
        if (!(await ensureHostAccess(tab))) throw new Error('Site access is needed to record a tab from the dashboard. Alternatively use the popup on that tab.');
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        req = { ...req, tabId: tab.id, allowPicker: true };
      }
      const r = await send('rec:start', req);
      if (r?.cancelled) toast('Recording cancelled.');
    } catch (e) { toast(e.message, 'error', 7000); }
    startBtn.disabled = false;
  });

  const codecOpts = [['vp9', 'VP9 (WebM) – best quality/size'], ['vp8', 'VP8 (WebM) – fastest'], ['av1', 'AV1 (WebM) – smallest, slow'], ['h264', 'H.264 – most compatible']]
    .filter(([c]) => ({ vp9: 'video/webm;codecs=vp9', vp8: 'video/webm;codecs=vp8', av1: 'video/webm;codecs=av01', h264: 'video/webm;codecs=h264' }[c] && (MediaRecorder.isTypeSupported({ vp9: 'video/webm;codecs=vp9', vp8: 'video/webm;codecs=vp8', av1: 'video/webm;codecs=av01', h264: 'video/webm;codecs=h264' }[c]) || (c === 'h264' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')))));

  view.replaceChildren(
    head('Screen Recorder', 'Record a Chrome tab, an application window or your entire screen — with microphone, webcam and annotations.'),
    grantBox, active,
    h('div', { class: 'grid-2' },
      h('div', { class: 'col', style: { gap: '16px' } },
        h('div', { class: 'card col' }, h('h2', {}, 'Source'), srcSeg, tabRow, srcNote),
        h('div', { class: 'card col' }, h('h2', {}, 'Video quality'),
          h('div', { class: 'form-grid' },
            field('Resolution', select('recResolution', [['720', '720p (1280×720)'], ['1080', '1080p (1920×1080)'], ['1440', '1440p (2560×1440)'], ['2160', '4K (3840×2160) where supported'], ['source', 'Source / maximum']], updInfo)),
            field('Frame rate', select('recFps', [[24, '24 FPS'], [30, '30 FPS'], [60, '60 FPS']], updInfo)),
            field('Quality preset', select('recQuality', [['standard', 'Standard'], ['high', 'High'], ['max', 'Maximum practical quality'], ['custom', 'Custom bitrate']], () => { bitrate.disabled = s.recQuality !== 'custom'; })),
            field('Bitrate (Mbps)', (() => { const el = h('input', { type: 'number', id: 'opt-bitrate', min: 0.5, max: 120, step: 0.5, value: s.recBitrateMbps, disabled: s.recQuality !== 'custom' }); el.addEventListener('change', () => save({ recBitrateMbps: Number(el.value) })); return el; })()),
            field('Codec', select('recCodec', codecOpts))),
          capInfo),
        h('div', { class: 'card col' }, h('h2', {}, 'Audio'),
          field('Audio source', select('recAudio', [['none', 'No audio'], ['mic', 'Microphone only'], ['tab', 'Tab / system audio'], ['both', 'Microphone + tab/system audio']])),
          h('div', { class: 'small muted' }, 'Tab audio comes directly from the recorded tab (you keep hearing it). System audio is only available when Chrome offers “Share system audio” for the chosen screen (Windows, ChromeOS).'),
          field('Microphone', micSel),
          h('div', { class: 'row' }, h('button', { class: 'btn', id: 'mic-monitor', html: `${icon('volume')}<span>Check level</span>`, onclick: startMicMonitor }), testBtn, meter),
          micStatus,
          check('micEchoCancellation', 'Echo cancellation (recommended with speakers)')),
      ),
      h('div', { class: 'col', style: { gap: '16px' } },
        h('div', { class: 'card col' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Webcam overlay'), check('webcamEnabled', 'Enabled')),
          field('Camera', camSel),
          stage,
          h('div', { class: 'row wrap' }, h('button', { class: 'btn', id: 'cam-preview', html: `${icon('webcam')}<span>Preview camera</span>`, onclick: startCamPreview }), h('span', { class: 'small muted' }, 'Drag the preview bubble to place it.')),
          h('div', { class: 'form-grid' },
            field('Shape', select('webcamShape', [['circle', 'Circle'], ['rect', 'Rectangle']], layoutCam)),
            field('Position', posSel),
            field('Size', size), field('Opacity', opa),
            field('Mode', select('webcamMode', [['burn', 'Composite into the video'], ['separate', 'Separate track (reposition later in the editor)']])))),
        h('div', { class: 'card col' }, h('h2', {}, 'Cursor, clicks & annotation'),
          check('clickEffects', 'Mouse-click effects (left / right click colours)'),
          check('cursorHighlight', 'Cursor highlight'),
          check('syntheticCursor', 'Show cursor in tab recordings (Chrome’s tab capture does not include the mouse pointer)'),
          check('showToolbar', 'Show recording toolbar on the page (it is visible in tab recordings; drawing tools appear when you annotate)'),
          h('div', { class: 'form-grid' },
            field('Highlight colour', (() => { const el = h('input', { type: 'color', value: s.cursorColor }); el.addEventListener('change', () => save({ cursorColor: el.value })); return el; })()),
            field('Left-click colour', (() => { const el = h('input', { type: 'color', value: s.clickColorLeft }); el.addEventListener('change', () => save({ clickColorLeft: el.value })); return el; })()),
            field('Right-click colour', (() => { const el = h('input', { type: 'color', value: s.clickColorRight }); el.addEventListener('change', () => save({ clickColorRight: el.value })); return el; })()),
            field('Highlight size (px)', (() => { const el = h('input', { type: 'number', min: 16, max: 120, value: s.cursorSize }); el.addEventListener('change', () => save({ cursorSize: Number(el.value) })); return el; })())),
          h('div', { class: 'small muted' }, 'Effects are drawn inside web pages the extension can access. Clicks in other applications or Chrome’s own UI cannot be detected.')),
        h('div', { class: 'card col' },
          h('div', { class: 'form-grid' }, field('Countdown', select('countdown', [[0, 'No countdown'], [3, '3 seconds'], [5, '5 seconds'], [10, '10 seconds']]))),
          startBtn,
          h('div', { class: 'small muted' }, 'Recording never starts without your click and Chrome’s own sharing indicator stays visible while recording.')),
      )),
  );
  const bitrate = view.querySelector('#opt-bitrate');
  startBtn.querySelector('#start-sub').textContent = 'Recording runs in the background — you can close this page.';
  refreshDevices();
  const onCh = (ch, area) => { if (area === 'session' && ch.recState) renderActive(ch.recState.newValue); };
  chrome.storage.onChanged.addListener(onCh);
  const { recState } = await chrome.storage.session.get('recState');
  renderActive(recState);
  if (grant) grantBox.querySelector('#grant-btn')?.focus();
  const ro = new ResizeObserver(layoutCam); ro.observe(stage);
  return () => {
    chrome.storage.onChanged.removeListener(onCh);
    stopStream(resources.mic); stopStream(resources.cam); resources.ctx?.close(); cancelAnimationFrame(resources.raf); ro.disconnect();
  };
}
