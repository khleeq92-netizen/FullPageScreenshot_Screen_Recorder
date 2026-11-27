# Third-party software

| Package | Version | License | Use |
|---|---|---|---|
| [mediabunny](https://github.com/Vanilagy/mediabunny) | 1.66.5 | MPL-2.0 | WebM/MP4 demuxing & muxing on top of WebCodecs (video editor, export, timeline analysis). Bundled unmodified; source available from the project repository / npm. |
| [esbuild](https://esbuild.github.io/) | 0.28.2 | MIT | Build tool only (not shipped). |

The MPL-2.0 is a file-level copyleft licence: the mediabunny files are distributed under the MPL-2.0 and
their source is available at the link above; it does not extend to the rest of this extension.
License comments extracted during bundling are shipped as `*.LEGAL.txt` next to the bundles.

The JPEG encoder uses the standard tables and algorithms from ITU-T T.81 (Annex K) and the AAN DCT;
it is an original implementation. The PDF writer is an original implementation of the PDF 1.6 format.
