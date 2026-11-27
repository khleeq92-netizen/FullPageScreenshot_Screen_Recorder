# FullPage HD Capture

A Chrome extension (Manifest V3) that combines **full‑page HD screenshots** (JPG / PDF / PNG) with a **screen & tab recorder** (microphone, tab/system audio, webcam overlay, cursor effects, live annotations) and a **built‑in video editor**. Everything runs locally: no account, no server, no uploads, no analytics.

## Features

### Screenshot Studio
- **Full‑page capture**: the page is scrolled and captured viewport by viewport with `chrome.tabs.captureVisibleTab`, then stitched using the *measured* scroll offsets and the *measured* pixel scale. It works at any device pixel ratio or zoom level (for example, 1440 CSS px at DPR 2 gives a 2880 px wide image).
- **No downscaling.** The capture is stored losslessly (PNG) in full‑resolution horizontal segments, so pages beyond the browser's canvas limit (32,767 px) are still kept at full resolution.
- Handles fixed headers, sticky navigation, floating buttons, lazy‑loaded images and `IntersectionObserver` content, infinite scroll (with a configurable maximum height), apps that scroll inside an inner element, horizontally scrolling pages, fractional scroll positions and the final partial viewport.
- Two sticky modes: *minimise repeated sticky/fixed elements* (the default; headers appear once at the top and footers once at the bottom) or *leave as displayed*.
- Restores the page afterwards (scroll position, styles). Cancel from the popup or with **Esc**.
- **Preview & editor**: zoom, crop, rotate, arrows, rectangles, ellipses, highlights, freehand, text, and blur / pixelate / solid redaction, with undo/redo. Edits are applied to a working copy and the original capture is never modified.
- **Exports**
  - **JPG** at 90 / 95 / 100 % quality, with 4:4:4 colour by default so small coloured text stays sharp. A streaming encoder produces one JPEG up to the format limit of 65,535 px. Taller images are saved as several full‑resolution parts. JPEG is lossy at every quality setting.
  - **PDF**: a single long page, or paged A4 / Letter in portrait or landscape with margins and smart page breaks that avoid cutting through text lines. JPEG data is embedded byte‑for‑byte (DCTDecode) at full resolution.
  - **PNG**: lossless.

### Screen Recorder
- **Current Chrome tab** (`chrome.tabCapture`): captures the tab's web content only. The capture size follows the tab's own aspect ratio and physical pixel size, so there are no letterbox bars and no upscaling.
- **Entire screen / application window / any tab** through Chrome's own share picker (`chrome.desktopCapture`).
- 720p / 1080p / 1440p / 4K (only when the source provides it), 24 / 30 / 60 fps, Standard / High / Maximum quality presets or a custom bitrate, and VP9 / VP8 / AV1 / H.264 where MediaRecorder supports them. The **actual** resolution and the measured frame rate are shown and stored.
- Audio: none, microphone, tab/system audio, or microphone + tab/system, mixed with Web Audio. You keep hearing the tab while it is recorded, and the microphone is never played back, so there is no feedback loop. Echo cancellation is on by default. The recorder page has a level meter and a 3‑second microphone test.
- **Webcam overlay**: choose the camera, circle or rectangle shape, size, opacity, a corner position or drag it anywhere in the preview. It is either composited into the video frames (`MediaStreamTrackProcessor` → canvas → `MediaStreamTrackGenerator`) or recorded as a separate track that you can reposition later in the editor.
- **Cursor effects & live annotation** (pen, highlighter, arrow, rectangle, circle, text, eraser, colours, thickness, undo/redo, clear) are drawn in an in‑page layer, so tab and screen capture record them natively. Tab capture never includes the OS pointer, so an optional synthetic cursor is drawn for tab recordings.
- Countdown (off / 3 / 5 / 10 s), pause/resume into one file, stop, cancel, mute, webcam toggle, and screenshot‑during‑recording. Controls are available in the popup, on the in‑page toolbar, in the recording‑control window, on the dashboard and as keyboard shortcuts.
- **Robust lifecycle**
  - Recording continues when the popup or dashboard is closed.
  - Data is written to IndexedDB in 1‑second chunks, so memory use stays flat.
  - If you stop sharing in Chrome or close the recorded tab, the recording is saved.
  - Interrupted recordings can be recovered from Capture History, but only when the data is actually playable.

### Video Editor
- Preview with play/pause, seek, frame step, playback speed and fullscreen.
- Timeline with video thumbnails, audio waveform, the webcam track (when recorded separately) and an annotation track with draggable and resizable items.
- Editing:
  - Cuts: trim start/end, split, delete clip.
  - Picture: crop, rotate, per‑clip speed (0.25–4×), resize on export.
  - Overlays: text, arrows, boxes, circles, highlights, spotlight, and blur / pixelate / solid redaction.
  - Audio: mute, volume 0–200 %, fade in/out of picture and sound, webcam overlay layout.
  - Undo/redo.
- **Export** decodes with WebCodecs and renders every frame with the same renderer as the preview (what you see is what you get), then re‑encodes:
  - **WebM** (VP9 + Opus).
  - **MP4** (H.264 + AAC; if the browser has no AAC encoder, as in some Linux builds, the audio falls back to Opus and the editor tells you).
  The MP4 is a genuine transcode, never a renamed WebM.
- The output is never upscaled beyond the source resolution or frame rate. If nothing was edited, the original file is saved unchanged with no re‑encode. The original recording is never modified: edits are saved as a new history item.

### Capture History & Settings
- History with thumbnails, filters, search, sort, preview/open, edit, export again, rename, delete, recovery of interrupted recordings, and storage usage.
- Settings for screenshots, PDF, recording, export defaults, filename patterns (`{site} {title} {domain} {date} {time} …`), a Downloads subfolder or "ask where to save", theme (system / light / dark), and privacy actions: delete temporary files, clear history, and see the permission state.

## Install (Load unpacked)

Requirements: Chrome 116 or later (developed and tested on Chrome 158) and Node.js 18 or later for building.

```bash
npm install
```

```bash
npm run build
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin **FullPage HD Capture** to the toolbar.

To create a ZIP for distribution, run the command below. It writes `release/fullpage-hd-capture-<version>.zip` with source maps excluded.

```bash
npm run package
```

## Usage

**Screenshot:** open a page, click the toolbar icon, then **CAPTURE FULL PAGE** (or press <kbd>Alt+Shift+S</kbd>). Keep the tab visible while it scrolls. The preview opens with editing tools and JPG / PDF / PNG export.

**Recording:** click the toolbar icon, then **RECORD SCREEN**, then choose *Current tab* or *Entire screen / window*. Set the audio, webcam and countdown, then **Start recording**.
- Tab recordings run in the background.
- Screen recordings use a small *Recording control* window that holds Chrome's share picker and the recording. It minimises itself; closing it stops the recording.

When you stop, the video editor opens.

### Keyboard shortcuts

They work even when the popup is closed (on macOS use <kbd>⌥ Option</kbd> + <kbd>⇧ Shift</kbd>):

| Shortcut | Action |
|---|---|
| <kbd>Alt+Shift+F</kbd> | Open the FullPage HD Capture popup |
| <kbd>Alt+Shift+S</kbd> | Capture the full page (screenshot) |
| <kbd>Alt+Shift+V</kbd> | Start recording the current tab; press again to stop and save |
| <kbd>Alt+Shift+K</kbd> | Pause / resume the recording |

There are also four optional actions without a default key, which you can assign at `chrome://extensions/shortcuts`: capture the visible area, record the entire screen or a window, stop recording, and draw on the page while recording. The keys are listed in the popup (**Keyboard shortcuts**) and in **Settings → Keyboard shortcuts**.

Chrome allows an extension at most four default shortcuts and silently skips keys it reserves, such as <kbd>Alt+Shift+P</kbd> and <kbd>Alt+Shift+R</kbd>, so these four were checked to be accepted.

Inside the editors: Space (play), S (split), Delete, Ctrl+Z / Ctrl+Y, and V / A / R / E / H / T / P / B / C to pick tools in the screenshot editor.

## Permissions (and why)

| Permission | Used for |
|---|---|
| `activeTab`, `scripting` | Scroll/measure the page you clicked the icon on, and show the recording overlay. Nothing is injected automatically (no content scripts). |
| `tabCapture` | Record the current tab after you click the icon. |
| `desktopCapture` | Show Chrome's screen/window/tab picker. Recording only starts after you choose a source. |
| `offscreen` | Keep tab recordings running when the popup closes. |
| `storage`, `unlimitedStorage` | Settings, and the local capture history in IndexedDB. |
| `downloads` | Save exports. Files are never overwritten (`uniquify`). |
| optional `<all_urls>` | Asked for only when you capture or record a tab **from the dashboard** instead of the toolbar icon. |

Microphone and camera access are requested only when you enable them. The recorder runs in a hidden document that cannot show prompts, so access is granted once on the extension's Screen Recorder page.

## Known platform limitations (by design, not bugs)

- Chrome forbids extensions on `chrome://` pages, the Chrome Web Store and other extensions' pages. Full‑page capture explains this; screen recording still works there.
- `captureVisibleTab` is limited to 2 calls per second, so a capture takes about 0.6 s per screen of page height. The tab must stay visible (switching tabs stops the capture with a message).
- Embedded cross‑origin iframes are captured as displayed; their own inner scroll content is not expanded.
- Image limits: JPEG is capped at 65,535 px per side, so taller pages are exported as parts or as one PDF. Captures wider than 16,384 px are limited to that width, with a warning.
- **System audio** is only offered by Chrome for whole‑screen sharing on Windows and ChromeOS. Tab audio works everywhere. The UI distinguishes the two and warns when audio is not shared.
- **Tab capture never contains the mouse pointer.** The extension can draw a synthetic cursor and click effects inside web pages. Clicks in other applications or in Chrome's own UI cannot be detected.
- Requested resolution and frame rate are upper limits. Chrome delivers what the source provides (for example, a static screen produces fewer frames), and the measured values are shown.
- MP4 audio uses AAC where the browser has an AAC encoder (Windows, macOS, ChromeOS). Linux builds of Chrome lack one, so Opus‑in‑MP4 is used and the editor says so.
- Speed changes in the editor resample the audio, so pitch changes with speed.

## Architecture

```
src/
  background/service-worker.js   message router, capture orchestration, recording lifecycle, badge, shortcuts
  screenshot/page-agent.js       injected on demand: measure, scroll, sticky/fixed handling, restore
  screenshot/capture-controller  scroll → captureVisibleTab → stitch loop (actual offsets, throttling, cancel)
  stitching/stitcher.js          full-resolution PNG segments with OffscreenCanvas
  image-processing/              streaming 4:4:4 JPEG encoder, edit renderer, export worker (JPG/PNG/PDF)
  pdf/pdf-writer.js              dependency-free PDF writer (DCTDecode, UserUnit for very long pages)
  screenshot-editor/             preview + vector annotation editor (SVG overlay)
  screen-recorder/               RecordingSession engine, hosts (offscreen doc / control window), codecs, WebM duration fix, recorder UI
  audio/mixer.js                 Web Audio mixing, level meters, mute
  webcam/                        overlay layout + real-time compositor
  overlay/recording-overlay.js   in-page toolbar, countdown, cursor effects, live annotation (shadow DOM)
  video-editor/                  project model (edit decision list), shared frame renderer, editor UI
  timeline/media-analysis.js     thumbnails, waveform peaks, probing (WebCodecs)
  video-export/export-worker.js  WebCodecs decode → render → encode → mux (streamed to OPFS)
  history/, settings/, app/, popup/   dashboard UI
  storage/db.js                  IndexedDB: items, blobs, recording chunks, projects
  shared/                        settings, filenames, downloads, UI helpers
```

Data flow:
- **Screenshot:** service worker → page agent (scroll) → `captureVisibleTab` → stitcher → IndexedDB → preview page → export worker → `chrome.downloads`.
- **Recording:** popup or dashboard → service worker → host (offscreen document for tabs, control window for screens) → `getUserMedia(streamId)` → mixer / compositor → `MediaRecorder` → IndexedDB chunks → assembled WebM with the Duration element fixed → editor.

Dependencies: [`mediabunny`](https://github.com/Vanilagy/mediabunny) (MPL‑2.0), used unmodified for WebM/MP4 demuxing and muxing with WebCodecs, and `esbuild` (MIT) for building. Everything else, including the JPEG encoder and PDF writer, is written for this project. FFmpeg‑WASM was considered for MP4 and rejected: about 30 MB, slow, high memory use, and GPL/LGPL licensing. WebCodecs encodes H.264 natively in Chrome.

## Testing

See [TESTING.md](TESTING.md). In short:

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` runs the unit tests: JPEG decoded by PIL, PDF checked by poppler, WebM duration, time mapping, filenames. `npm run test:e2e` drives real Chrome under Xvfb with the extension loaded. It covers 54 scenarios across screenshots, tab and screen recording, the editor, privacy and performance, verified with ffprobe, ffmpeg, PIL and poppler.

## Privacy

The extension never sends screenshots, video, audio, webcam frames, URLs or browsing data anywhere. It has no analytics, no telemetry, no AI processing and no account. Captures stay in this browser profile's IndexedDB until you delete them (Capture History → Delete / Clear history, or Settings → Privacy). Nothing is captured or recorded without your explicit action, and Chrome's own sharing indicator stays visible while recording.
