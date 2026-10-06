# iPhone wallpaper preparation

PerfectLoop creates the Live Photo entirely in your browser: the still image, finished motion video, pairing identifier, per-frame timing and alignment metadata, timed key-photo marker, and native package. A compatible browser on a phone or computer can create and export these files. No third-party converter is required to create the result.

Saving the downloaded package as one asset in Apple Photos is a separate operating-system import step. Browsers have no standard PhotoKit API to perform that import directly. A ZIP downloaded into Files is not automatically a Photos asset.

## Create and preview

1. In **Video settings**, select **iPhone wallpaper** under **Destination preset**.
2. Choose a representative phone screen size or **Custom phone size**. These sizes control the preview canvas and ordinary MP4/JPG downloads; Live Photo exports use the smaller compatibility profile below. Profiles do not reproduce every iPhone model or iOS layout exactly.
3. Open a video, or choose **Open photo** for a JPEG, PNG, or WebP image to make a gentle two-second zoom loop that returns to its starting framing. Add text and image layers in **Layers** if needed.
4. Choose the source range, loop method, framing, and layer animation. **Fit to a 2-second cycle** accounts for speed, dissolves, and ping-pong. Shorter sources remain within their available range. Two seconds is a practical starting point, not a verified universal Apple duration limit.
5. Select **Render preview**. Use **Lock Screen** to review approximate clock placement and **Home Screen** to review a still background behind approximate app icons. **Editor** returns to the ordinary canvas. Source playback uses the ordinary canvas too.
6. Set **Key photo** to a frame in the finished video. A frame at 0.5 seconds or later is suggested when the clip allows it. Changing this frame alone does not require another video preview render. Before a current render, the Home Screen shows a labeled draft.
7. Use **Save Live Photo (.pvt)** in a browser with directory access, or **Download Live Photo ZIP** otherwise, to generate and export the native package locally.

Actual wallpaper cropping, controls, motion eligibility, and playback depend on the device and iOS. Screen frames, clocks, and app icons are DOM overlays and never appear in exported photos or video.

## Downloads

| Choice | Download |
| --- | --- |
| Live Photo · PVT package (when supported) | Saves a real native package at the compatibility size directly to a chosen folder, without an archive. |
| Live Photo · ZIP | Downloads that package inside a ZIP. Used by browsers without directory access, including Safari. |
| Still wallpaper · JPG | The selected frame at your selected dimensions for a still Lock Screen or Home Screen wallpaper. |
| Video · MP4 | The ordinary finished silent H.264 video at your selected dimensions and frame rate. |
| Full wallpaper kit · ZIP | The Live Photo package and instructions, plus H.264 MP4 and still JPG at the compatibility size. |

### Live Photo compatibility profile

PVT, Live Photo ZIP, and the full kit prepare their paired MOV as silent HEVC Main, 8-bit video at constant 60 fps. The canvas is scaled down to fit within 720 pixels wide and 1560 pixels high, preserving its aspect ratio without upscaling. Dimensions are rounded down to even pixels for the encoder, with its existing 16-pixel minimum retained for extremely narrow canvases. The JPEG cover uses the same canvas and the selected frame of the finished render. Crop, layers, and animations follow the selected framing. HDR preservation and correct HDR-to-SDR tone mapping are not guaranteed; inspect the output colors when using HDR footage.

Standalone MP4 and JPG downloads retain the dimensions selected in Video settings. The full kit instead includes MP4/JPG from the same compatibility render as its Live Photo. The preview keeps the selected phone-screen aspect ratio; the download note shows the actual Live Photo dimensions.

The smaller profile follows scoped converter reports rather than an Apple specification. FaceLift documents an iPhone 16 Pro reporting iOS 27.0: with the same one-second HEVC/60 fps clip and 0.5-second JPEG cover, 1080 × 2340 was rejected while 720 × 1560 animated on Lock Screen wake. Its generated metadata differs from PerfectLoop's independently generated records, so that success does not establish our export's eligibility. Other converters report success with different sizes, codecs, and durations. Two seconds and a later key photo are guidance; changing duration alone is not a demonstrated universal fix.

### Browser startup and encoding

HEVC encoding uses the bundled multithread FFmpeg core and requires cross-origin isolation. On a supported top-level HTTPS or localhost page, an app-scoped service worker supplies the required headers to same-origin network responses. First use can reload once before the editor, sample, or user files load. The worker does not cache media, upload sources, or create an offline copy. It does not intercept other origins or paths outside this app's scope.

If isolation is unavailable, the ordinary editor can use the existing single-thread core. Live Photo HEVC export needs a browser that can run the multithread core. Existing media decoding, memory, and browser capability limits still apply.

A `.pvt` is a directory package, displayed as a single package by supporting operating systems. It contains three files. Renaming ZIP bytes to `.pvt` does not create a native directory package.

Direct saving uses the browser's directory picker, requested from the export click before rendering. It requires a secure context and directory access support. The resulting package uses a unique name and preserves existing files. Failed or cancelled saves remove their partial package; if deletion fails, the error identifies the package to remove. Safari and Firefox currently do not expose this API. Runtime support determines which choice appears in the editor.

The ZIP download ends in `.pvt.zip` and contains:

```text
live-photo.pvt/
  photo.jpg             JPEG with the Live Photo pairing identifier
  photo.mov             HEVC motion with pairing, frame timing, and still metadata
  metadata.plist        Native Live Photo bundle version
```

The native download has exactly one top-level PVT package, so it can be treated as a bundle archive without extra root files or a nested outer package. The full kit adds `wallpaper.jpg`, `wallpaper.mp4`, `wallpaper-info.json`, and `README.txt` outside the native package; its MP4 and JPG use the same compatibility dimensions. The MOV contains the selected loop method, crop, layers, and animations. Its paired JPEG uses the same selected frame from that finished video. The key-photo slider reaches the last actual frame rather than the end-of-file timestamp.

## Import into Apple Photos

### Try directly on iPhone or iPad

1. Save the ZIP completely to **Files**. A ZIP created on Windows or Linux can be transferred to the iPhone unchanged.
2. Touch and hold the ZIP and choose **Uncompress**.
3. Open `live-photo.pvt`. **If the system offers Save to Photos**, use that action.
4. Confirm that Photos shows **one Live Photo** and plays its motion.

This route is reported by another exporter, and native iOS Live Photo bundle handling exists. The available Files action depends on device and iOS version; it may not be offered. PerfectLoop has not verified this route on a physical iPhone and does not guarantee direct import on every version. If the action is unavailable, use the built-in Mac Photos route below when available. No verified browser-only route is provided that bypasses the missing system import action on Windows/Linux or iPhone.

### Built-in Photos on a Mac

1. Unzip the download.
2. Import `live-photo.pvt` into **Photos**. If the package is not recognized, open its contents and import **both** `photo.jpg` and `photo.mov` together.
3. Verify that Photos shows **one Live Photo** and plays its motion.
4. Sync that Photos asset using iCloud Photos, or share the already imported asset from Photos to the iPhone with AirDrop.
5. Verify playback in iPhone Photos.

Two loose files saved separately are not a reliable substitute for importing the paired asset. These are import and transfer steps for the result already created on this site.

### Select as wallpaper

In **Settings → Wallpaper → Add New Wallpaper → Photos**, select the imported Live Photo and check motion availability before setting it as the Lock Screen. Home Screen wallpaper is static. Lock Screen motion is controlled by iOS; it is not continuous video playback.

**Photos playback and wallpaper eligibility are separate.** Modern iOS can accept a Live Photo in Photos and still show **Motion Not Available** in wallpaper selection. The native package does not remove this eligibility check.

## Format and verification

PerfectLoop independently writes these structures:

| Resource | Format data |
| --- | --- |
| JPEG | Apple MakerNote tag 17 (`ContentIdentifier`) with a newly generated UUID. |
| MOV | The same UUID in `com.apple.quicktime.content.identifier` movie metadata. |
| MOV frame metadata | A `mebx` track with `com.apple.quicktime.live-photo-info`, one independently generated 136-byte V3 record per actual video frame, using that frame's timestamp and duration. Setup data declares version 1 and the output dimensions. |
| MOV still metadata | A second `mebx` track with `com.apple.quicktime.still-image-time`, signed int8 value −1, an identity `live-photo-still-image-transform`, and its reference dimensions. Its presentation time identifies the key photo. |
| PVT package | Matching JPG/MOV filenames plus `metadata.plist`, containing `PFVideoComplementMetadataVersionKey` as string `1`. The ZIP contains an explicit package directory entry. |

The MOV is remuxed from the completed HEVC compatibility output without re-encoding its video packets. The JPEG writer preserves compressed image data. PVT is a native package convention, associated with `com.apple.private.live-photo-bundle`, rather than a guarantee about import UI or wallpaper eligibility.

The V3 records describe a fixed digital coordinate space: identity trajectory, zero additional motion-blur displacement, unit zoom, and the actual exported frame timestamps. Camera exposure, focus, gain, faces, and sensor measurements remain absent. The records are generated from the output timeline; they do not measure or reconstruct the source camera's motion. PerfectLoop does not transplant donor packets, claim Apple camera hardware or software versions, invent GPS locations, or copy vitality scores. These independently written structures remain a compatibility experiment, not a verified recipe for every iPhone or iOS version.

Automated checks and independent FFprobe/ExifTool inspection verify identifiers, timed metadata, video packets/frames, and the selected JPEG frame. Physical Mac Photos/iPhone import and Lock Screen animation have not been verified by PerfectLoop; structural checks do not establish those outcomes.

## Research sources

Researched on 2026-10-06. Apple support, developer, and App Store pages were blocked by this environment's network policy. Findings were cross-checked against accessible format definitions, camera-file metadata, implementations, and compatibility reports. The Live Photo metadata writer is independently written and includes no donor camera recordings, sensor templates, GPS, or copied third-party implementation code.

- [LimitPoint format and PhotoKit workflow](https://github.com/LimitPoint/LivePhoto/blob/0263052d14e2fc8399b9f6d0ef73e31054ae9427/README.md).
- [ExifTool Apple MakerNote identifier](https://github.com/exiftool/exiftool/blob/2200871d9cef988051d2a99d67df3bda6cbb30a8/lib/Image/ExifTool/Apple.pm#L112) and [QuickTime definitions](https://github.com/exiftool/exiftool/blob/2200871d9cef988051d2a99d67df3bda6cbb30a8/lib/Image/ExifTool/QuickTime.pm#L6731).
- [Established makelive PVT writer](https://github.com/RhetTbull/makelive/blob/40abfa4a5bc458609ddb9087d3a2743a826103a4/makelive/makelive.py#L362) and [native bundle UTI mapping](https://github.com/RhetTbull/osxphotos/blob/a671b60c4cc4be6db4152dbcb351ed3cf33c9bf9/osxphotos/uti.py#L273).
- [Reported iPhone/iPad Files import workflow](https://github.com/Hronrad/livephoto-forge/blob/41d2366f68dffad7a1be038de7613882b117d077/README.en.md) and [structural export tests](https://github.com/Hronrad/livephoto-forge/blob/41d2366f68dffad7a1be038de7613882b117d077/tests/test_web.py#L79). This report does not specify a tested iOS version or provide independent device verification.
- [Mac Photos → iCloud → iPhone playback report](https://github.com/RhetTbull/makelive/issues/26#issuecomment-2708626042), distinguishing wallpaper failure from Photos playback.
- [Modern wallpaper compatibility reports](https://github.com/LimitPoint/LivePhoto/issues/10).
- [Published V3 record layout and serialization observations](https://github.com/EthanArbuckle/iPhone17-1_18.2_22C152_Restore/blob/e26ed4563f78871c59d2d96856756a65d62517e5/System/Library/PrivateFrameworks/CMCapture.framework/CMCapture.m#L60141) and [setup schema and field interpretation](https://github.com/EthanArbuckle/iPhone17-1_18.2_22C152_Restore/blob/e26ed4563f78871c59d2d96856756a65d62517e5/System/Library/PrivateFrameworks/MediaAnalysis.framework/VCPVideoMetaLivePhotoMetaAnalyzer.m#L214). These describe iOS 18.2 format behavior; no proprietary implementation code is copied, and they do not establish iOS 27 wallpaper acceptance.
- [FaceLift's scoped iPhone/iOS 27 resolution comparison](https://github.com/deluxebear/FaceLift/blob/408a760d6facb5adaae6b2a076db347158aaba5b/docs/video-wallpaper.md) and [metadata provenance and confirmed sample playback](https://github.com/deluxebear/FaceLift/blob/408a760d6facb5adaae6b2a076db347158aaba5b/Resources/LivePhoto/README.md). Its constant compatibility template is not included in PerfectLoop.
- [Live Photo Batch Converter's device-tested 60 fps profile and cover continuity experiments](https://github.com/pudding0503/live-photo-batch/blob/00b8ab2d19b7eca1c7e8f4097d886a7a65789603/RULES.md), including reported successful 1.87–2.67-second clips. Its profile is not a universal Apple requirement.
- [A separate H.264/60 fps iOS 17 converter report](https://github.com/giangtruong2302/claude-live-photo/blob/77f5dadceadb13e869baf537f420dfc670268b8d/README.md). Codec and device observations differ between implementations.
- [Native package type declarations](https://github.com/darlinghq/darling/blob/60ba801decee7a00782f74f6be4c8ffb013f79ff/src/frameworks/CoreServices/Info.plist#L2907), [directory-picker browser support](https://github.com/mdn/browser-compat-data/blob/03b0ca395986fbff181b2731ad8b73a58ddc84d2/api/Window.json), and [File System Access requirements](https://github.com/WICG/file-system-access/blob/93119927fa7a678c1863996f6f3a32d9ac53943d/index.bs#L330).
