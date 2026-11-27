# Testing FullPage HD Capture

There are two layers of automated tests plus a short manual checklist for what automation cannot reach: real permission prompts, operating‑system audio, and clicking the toolbar icon.

## 1. Unit tests (Node)

```bash
npm test
```

They need `python3` with Pillow/NumPy, `ffmpeg`/`ffprobe` and poppler (`pdfinfo`, `pdfimages`, `pdftoppm`).

| Area | What is verified |
|---|---|
| JPEG encoder | Output decodes in PIL; PSNR > 38 / 42 / 48 dB at 90 / 95 / 100 % for odd sizes and odd strip heights; 4:4:4 by default, optional 4:2:0; JFIF DPI; a 40,000 px tall single JPEG (beyond the canvas limit); rejects sizes above 65,535 px |
| PDF writer | Valid for poppler; Unicode title; A4 geometry; multi‑page; very long pages use `/UserUnit` with the correct proportions; JPEG embedded byte‑for‑byte |
| WebM duration fix | A MediaRecorder‑style live WebM (no Duration, unknown sizes) gets the correct duration, and all 90 frames still decode |
| Edit decision list | Split, delete, trim and speed time‑mapping; overlays shift after deletions; crop/rotate output size; no upscaling; gain envelope (volume, fades, mute) |
| Renderer geometry | Crop + 90/180° rotation output sizes and inverse mapping |
| Filenames | Default patterns (`FullPage_Capture_Google_27-11-2026`, `Screen_Recording_27-11-2026_11-30`), tokens, invalid characters, reserved names, path traversal, IP/localhost hosts |

## 2. End‑to‑end tests (real Chrome + the extension)

```bash
npm run test:e2e
```

This command:
- builds `dist-test/` (the production build plus `<all_urls>` host access, so automation can start captures without a toolbar click),
- starts a local fixture server,
- launches Chrome for Testing headful under Xvfb with the extension loaded.

The `--allowlisted-extension-id` switch stands in for the toolbar click that `chrome.tabCapture` requires. Outputs are verified with `ffprobe`/`ffmpeg`, PIL and poppler.

Run single suites with `xvfb-run -a node tests/e2e/run-e2e.mjs screenshot`, or select tests with `--grep <pattern>`. Results are written to `test-results/e2e.json`. **Do not run two e2e processes at the same time**: each rebuilds `dist-test/`.

### Fixture pages (`tests/fixtures/server.mjs`)
- `/bands`: full‑width colour bands whose colour encodes their index. Every band is sampled at its expected position in the stitched image, so any missing, duplicated or shifted row fails the test. Options: band height, sticky header, fixed header/footer/floating button, extra width.
- `/lazy`: `loading="lazy"` images served with a delay, plus `IntersectionObserver` content.
- `/infinite`: appends content forever.
- `/inner`: app layout that scrolls inside a `<main>` element.
- `/table`, `/article`: a large table with a sticky `<thead>`, and a long news article with a sticky nav and images.
- `/media`: animated canvas plus a 440 Hz tone, used for recording.
- `tests/fixtures/media/rgb-6s.webm`: 0–2 s red, 2–4 s green, 4–6 s blue, a white corner marker and a 440 Hz tone, used for the editor.

### Suites

**screenshot** (19 tests): stitching is pixel‑exact at DPR 2 for long pages, odd band heights and fractional overlaps. It also covers:
- fixed header, footer and floating button shown once in minimise mode, and repeated in "as displayed" mode,
- the sticky header neutralised,
- page state restored, and cancel restoring the page,
- lazy images and observer content,
- the infinite‑scroll cap (status *truncated*),
- the inner scroller, horizontal overflow, and table/article heights,
- visible capture, and the restricted‑page error,
- JPG export at full size, 4:4:4, 192 dpi, with PSNR against the lossless capture,
- an 80,000 px page exported as 2 full‑resolution JPG parts plus a 1‑page PDF holding every row,
- A4 and Letter‑landscape paged PDFs,
- edits (crop, rotate, rectangle, text, redaction) present in the export while the original stays untouched.

**recording-tab** (10 tests): tab recording at 1080p30 with tab audio. Dimensions match the tab's aspect with no letterbox, the duration matches, all frames decode, and the audio is audible. Also:
- 720p limit and no upscaling,
- pause/resume producing one file without the paused time,
- cancel leaving no item and no chunks,
- recording surviving the starting page (popup) being closed,
- closing the recorded tab saving a playable file,
- the in‑page overlay injected and removed,
- an annotation drawn on the page visible in the video frames,
- screenshot during recording,
- VP8 and H.264 recordings.

**recording-screen** (6 tests), with fake mic/camera:
- entire screen + microphone + composited webcam (ring detected in the frames, mic tone audible),
- webcam recorded as a separate track,
- the "system audio not shared" warning,
- a 60 fps request where the measured fps is reported,
- countdown, pause, mute, resume and stop through the control‑window host,
- killing the control window mid‑recording, then **recovering** the data from Capture History.

**editor** (8 tests):
- no edits gives a byte‑identical copy,
- split → delete the middle clip → trim start/end **through the UI**, then undo/redo; the exported frames contain red then blue and never the deleted green; the duration is correct; the original is untouched,
- crop + 90° rotation + text + solid redaction + rectangle + 50 % volume, checked by output size, pixel probes, the rotated corner marker and −6 dB in volumedetect,
- 2× speed, 480p resize and mute (no audio track),
- fade‑in,
- MP4 is H.264 (plus AAC, or Opus where Chrome has no AAC encoder),
- a separate webcam track composited at the chosen position,
- the exported file reopens in the editor.

**performance** (4 tests): capture time and peak memory for 51 → 154 → 307 MP pages (memory stays flat, about 250 MB), a 2560×120,000 JPG export, a 60 s recording with flat memory, and media streams and the recorder document released after stop.

**privacy** (7 tests):
- production manifest permissions (no host access, no content scripts, local‑only CSP),
- no network endpoints or upload APIs in the bundles,
- **zero external requests** while capturing, exporting a PDF, recording, exporting video and opening every page,
- no automatic capture or injection,
- mic/camera not requested by merely opening pages,
- "Delete temporary files" removes orphans and unfinished chunks but keeps history,
- deleting one capture removes its media, and "Clear history" empties everything.

## 3. Manual checklist (things automation cannot do)

Load `dist/` unpacked in a normal Chrome profile.

1. **Toolbar flow, `activeTab`:** on a normal website, click the icon → **CAPTURE FULL PAGE**. Progress shows in the popup and badge, and the preview opens. Repeat with <kbd>Alt+Shift+S</kbd>, and start/stop a tab recording with <kbd>Alt+Shift+V</kbd>.
2. **Restricted pages:** on `chrome://settings` the popup explains that full‑page capture is impossible there; **RECORD SCREEN** still works.
3. **Permissions:**
   - Choose *Microphone* and *Webcam* in the popup and press Start. The Screen Recorder page opens and asks for access.
   - After you allow it, recording from the popup works.
   - Deny it: recording continues without the mic or camera and shows a warning.
4. **Screen picker:**
   - *Entire screen / window* opens the Recording control window with Chrome's picker.
   - Pick a window. While recording the control window minimises itself.
   - Stop it from the popup, from Chrome's "Stop sharing" bar, and by closing the window; each case must save or offer recovery.
5. **System audio** (Windows/ChromeOS): share the entire screen with "Share system audio" ticked; the audio must be present. On macOS/Linux the warning appears instead.
6. **Tab audio:** while recording a YouTube tab, you keep hearing it and it is in the file.
7. **Annotation during recording:** use the toolbar pen/arrow/text/eraser, undo/redo and clear; Esc leaves drawing mode.
8. **Large pages:** capture a very long page (> 32,767 px at your DPR). The preview scrolls smoothly; JPG produces parts only beyond 65,535 px; the PDF is a single file.
9. **Downloads:**
   - Set *Ask where to save* and choose a folder.
   - Export the same file twice: the second copy is renamed and never overwrites the first.
   - Cancel a save dialog: the error message is shown.
10. **MP4 on Windows/macOS:** the export uses AAC audio.
