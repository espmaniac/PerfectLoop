# FFmpeg multithread core

These unmodified ES-module assets come from **@ffmpeg/core-mt 0.12.10**.
PerfectLoop loads this core only in a cross-origin isolated browser. The ordinary
single-thread core remains available for browsers without isolation.

The JavaScript wrapper is shared with `../ffmpeg/`. The WASM file is stored as
lossless gzip to keep each repository asset within GitHub's upload limit. Gzip
uses compression level 9, no filename, and `mtime=0`; decompression restores the
exact upstream binary. No changes were made to the upstream core or its worker.

## Verified provenance

- npm package: https://www.npmjs.com/package/@ffmpeg/core-mt/v/0.12.10
- npm archive: https://registry.npmjs.org/@ffmpeg/core-mt/-/core-mt-0.12.10.tgz
- npm archive SHA-512 integrity:
  `sha512-atyRTOpa58bLCIgd6GXBZAXWyWD3AUoQyzxqjvGhp9MuSzdILtOTI62ffLswBsCnLq15lQ8IETHUpm1oe4V9FQ==`
- npm archive SHA-256:
  `269ab67383ad3884e3303c9dded79e4bece1ae8b4c20d1cb0bbfc70fd8e97d45`
- npm package git revision: `63ea4ccb6c58e127cc1767f88c508371936178c2`
- upstream project/build sources:
  https://github.com/ffmpegwasm/ffmpeg.wasm/tree/63ea4ccb6c58e127cc1767f88c508371936178c2
- FFmpeg source: https://ffmpeg.org/download.html

The archive SHA-512 was verified against npm's pinned `dist.integrity` before
copying assets. `checksums.json` records SHA-256 values for the copied JavaScript,
worker, license, compressed WASM, and original uncompressed WASM.

## License

The core package declares **GPL-2.0-or-later**, separate from the MIT JavaScript
wrapper. It includes GPL codec components such as x264 and x265. See `GPL-2.txt`,
the upstream build sources for component source revisions, and the application's
`THIRD-PARTY-NOTICES.txt`. The gzip transformation does not modify the WASM code.

The application-level `coi-serviceworker.js` and `js/start.js` are original code.
The service worker adds isolation headers to network responses in this app's
same-origin scope; it does not cache media or create an offline copy of the app.
