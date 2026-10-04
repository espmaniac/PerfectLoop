# Verification

Verified on 2026-10-04 using Chromium 138 and the fixtures described below.

## Structured metadata

Static JSON-LD describes the site, page, and free browser application using WebSite, WebPage, and WebApplication. The canonical URL, Open Graph metadata, application image, graph IDs, and single-page XML sitemap consistently use `https://espmaniac.github.io/PerfectLoop/`.

JSON parsing, graph references, property types, metadata consistency, sitemap XML, image dimensions, and asset responses were checked. Live Google validation has not been performed.

The markup describes the application without ratings or reviews. Google's Software App rich result additionally requires a genuine rating or review; this graph is general Schema.org metadata and does not establish eligibility for that rich result.

## Version 2.1.2 PL favicon

The selected PL monogram was recreated as flat SVG geometry and used for the favicon and header mark. SVG parsing, ICO decoding at 16/32/48 px, PNG dimensions at 180/192/512 px, and the Apple icon's fully opaque background were checked. The vector and small raster icons were visually inspected. All icon links, the header image, and manifest assets returned HTTP 200 when served under `/perfect-loop/`; manifest scope, ID, and start URL stay relative to that repository path.

Header icon dimensions retain the previous 44px desktop and 32/31px mobile sizes. Every video-processing JavaScript module is byte-for-byte unchanged. This asset update did not receive a fresh browser run because the local Chromium executable was truncated and could not launch. Browser results in the sections below apply to their stated earlier versions.

## Version 2.1.1 Custom aspect ratio

Custom now reveals Width and Height directly below the aspect buttons, without opening Output settings. Choosing it preserves the current dimensions and keeps Custom selected while typing, including when dimensions match 16:9. Choosing the Custom destination preset also reveals the fields.

Real Chromium export was independently checked with ffprobe: H.264, 480 × 272, 24 fps, 36 frames, 1.500 seconds, no audio stream. Arbitrary dimensions, preset switching, undo/redo, and rejection of odd output dimensions worked. Custom fields and all five aspect labels were checked at widths 320, 390, 768, 1024, 1280, and 1440, with no page or button-label overflow. Desktop and phone screenshots were inspected. No uncaught browser exceptions were recorded.

## Version 2.1 Studio redesign

The graphite layout was checked in the browser with portrait and landscape sources. Real downloads were examined with native `ffprobe`:

- Default Canvas export: H.264, 576 × 1024, 165 frames at 30 fps, no audio stream.
- Landscape export: H.264, 160 × 90, 48 frames at 24 fps, with AAC when retained and no audio stream when removed.
- Encoded preview, boundary-frame comparison, search results, candidate selection, frame stepping, guides, and help worked through the new interface.
- Original, 16:9, 9:16, and square choices updated actual output settings. Original dimensions followed a newly opened source and its selected rotation. Aspect undo/redo, alternate framing, fit/fill controls, manual dimensions, and destination presets were checked.
- A landscape Source preview retained 16:9 when the output was switched to 9:16. Encoded preview used the rendered dimensions. Preview mute did not change audio export settings.
- No horizontal overflow in Edit loop, Auto find, and Inspect seam at 320, 390, 768, 1024, 1280, 1440, and 1584 px. Desktop, tablet, and phone screenshots were inspected. Export buttons have no background gradient and use backdrop blur.
- Final interface checks covered the speed slider and its numeric value, slider undo, trim-handle dragging and grouped undo, keyboard tab navigation, mobile tool navigation, and expanded Output settings at all seven viewport widths. The sliders retain their six-pixel tracks on phones. Delayed sample loading still cannot overwrite a selected user file.

The broader processing checks below were recorded before the visual redesign; the same loop algorithms and FFmpeg engine remain in use. The four developer checks also passed after the redesign.

## Real browser exports

The bundled 18-second sample includes audio. Downloads were examined independently with native `ffprobe`.

| Export | Verified result |
| --- | --- |
| Default Canvas MP4 | H.264, 576 × 1024, 30 fps, 165 frames, 5.500s; video stream only. |
| Natural cut | 144 × 256 at 24 fps, 96 frames from a four-second selection. |
| Crossfade | Same dimensions/rate, 84 frames with a half-second overlap. |
| Offset dissolve | Same dimensions/rate, 84 frames. |
| Rebound | Same dimensions/rate, 190 frames; turning-point duplicates omitted. |
| Eased rebound | Same dimensions/rate, 190 frames. |
| Fade through black | Same dimensions/rate, 96 frames. |
| Retained-audio MP4 | H.264 plus AAC. |
| Retained-audio WebM | VP8 plus Opus. |
| Animated GIF | 18 frames from a 1.5-second selection, infinite repetition metadata. |
| Motion interpolation and framing | Successful MP4 with interpolation, rotation, mirroring, and border framing. |
| Three repeats | 252 frames, 10.500s for the 84-frame dissolve cycle. |

Rendered previews and seam comparison worked. A GIF's MP4 preview was independently checked to contain no audio even when the previous video setting retained audio.

## Search, compatibility, and interface

- Discovery found the sample's exact six- and twelve-second repeating ranges with top scores of 98. The strongest candidates received frame refinement.
- Candidate selection and a two-video batch ZIP export completed.
- An FFV1/PCM MKV that the browser could not display was converted to a playable proxy. A subsequent export contained H.264 and AAC from the original source, rather than exporting the silent proxy.
- The proxy/export check also forced the JavaScript gzip fallback by disabling native `DecompressionStream`. Both the native and fallback WASM loaders worked.
- Preview mute left export audio settings intact. Playback repeated across the full source endpoint. PNG capture, timeline dragging, grouped drag undo, redo, frame controls, and timeline zoom worked.
- Search cancellation and render cancellation completed, followed by a successful retry.
- No horizontal page overflow at widths 320, 390, 768, 1024, and 1440. Desktop, tablet, and mobile layouts were visually inspected.
- No uncaught browser exceptions during the completed scenarios. Save project and Load project controls and handlers are absent.
- A delayed startup demo request previously replaced an immediately selected user video. This was reproduced, fixed with fetch cancellation, and checked again with a deliberately delayed response. The user file stayed selected without a stray error or cancellation notice; manual Load sample and subsequent file selection also worked.

## Developer checks

All four `node --test tests/*.test.js` checks passed, including real native FFmpeg sequences for every loop method. JavaScript syntax checks passed for the application and vendor modules. The delivered folder contains no `.ts`, `.tsx`, TypeScript configuration, React dependency, Vite configuration, or generated framework bundle. Its optional `package.json` has no dependencies.

The largest file is the 10,257,774-byte gzip WASM asset. The remaining site files are smaller. All required runtime assets are included locally.

These results cover Chromium and the stated fixtures. Spotify submission, other browsers, and arbitrary input codecs were not tested. Search remains approximate, and browser memory and performance limits apply.
