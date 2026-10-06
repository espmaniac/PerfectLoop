# iPhone wallpaper preparation

PerfectLoop creates the Live Photo entirely in your browser: the still image, finished motion video, pairing identifier, timed key-photo marker, and native package. A compatible browser on a phone or computer can create and download these files. No third-party converter is required to create the result.

Saving the downloaded package as one asset in Apple Photos is a separate operating-system import step. Browsers have no standard PhotoKit API to perform that import directly. A ZIP downloaded into Files is not automatically a Photos asset.

## Create and preview

1. In **Video settings**, select **iPhone wallpaper** under **Destination preset**.
2. Choose a representative phone screen size or **Custom phone size**. Profiles describe output dimensions; they do not reproduce every iPhone model or iOS layout exactly.
3. Open a video, or choose **Open photo** for a JPEG, PNG, or WebP image. A photo becomes a gentle three-second zoom loop that returns to its starting framing. Add text and image layers in **Layers** if needed.
4. Choose the source range, loop method, framing, and layer animation. **Fit to a 3-second cycle** accounts for speed, dissolves, and ping-pong. Shorter sources remain within their available range. Three seconds is a practical starting point, not a verified universal iOS limit.
5. Select **Render preview**. Use **Lock Screen** to review approximate clock placement and **Home Screen** to review a still background behind approximate app icons. **Editor** returns to the ordinary canvas. Source playback uses the ordinary canvas too.
6. Set **Key photo** to a frame in the finished video. Changing this frame alone does not require another video preview render. Before a current render, the Home Screen shows a labeled draft.
7. Choose **Download Live Photo** to generate the paired resources and native package locally, then download the ZIP.

Actual wallpaper cropping, controls, motion eligibility, and playback depend on the device and iOS. Screen frames, clocks, and app icons are DOM overlays and never appear in exported photos or video.

## Downloads

| Choice | Download |
| --- | --- |
| Live Photo · ZIP (default) | The browser-created native Live Photo package. Import instructions appear in Video settings. |
| Still wallpaper · JPG | The selected frame for a still Lock Screen or Home Screen wallpaper. |
| Video · MP4 | The ordinary finished silent H.264 video. |
| Full wallpaper kit · ZIP | The Live Photo package and instructions, plus the regular MP4 and still JPG. |

The default download ends in `.pvt.zip` and contains:

```text
live-photo.pvt/
  photo.jpg             JPEG with the Live Photo pairing identifier
  photo.mov             QuickTime motion with pairing and timed still metadata
  metadata.plist        Native Live Photo bundle version
```

The native download has exactly one top-level PVT package, so it can be treated as a bundle archive without extra root files or a nested outer package. The full kit adds `wallpaper.jpg`, `wallpaper.mp4`, `wallpaper-info.json`, and `README.txt` outside the native package. The MOV contains the selected loop method, crop, layers, and animations. Its paired JPEG uses the same selected frame from that finished video. The key-photo slider reaches the last actual frame rather than the end-of-file timestamp.

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
| MOV timed metadata | A boxed `mebx` sample in a `meta` track, with `com.apple.quicktime.still-image-time`, signed int8 value −1. Its presentation time identifies the key photo. |
| PVT package | Matching JPG/MOV filenames plus `metadata.plist`, containing `PFVideoComplementMetadataVersionKey` as string `1`. The ZIP contains an explicit package directory entry. |

The MOV is remuxed from the completed H.264 output without re-encoding its video packets. The JPEG writer preserves compressed image data. PVT is a native package convention, associated with `com.apple.private.live-photo-bundle`, rather than a guarantee about import UI or wallpaper eligibility.

Modern camera Live Photos can contain additional vitality scoring and binary timed `live-photo-info` metadata. This exporter does not reproduce those camera sensor records or assert an undocumented recipe for modern iOS wallpaper animation.

Browser FFmpeg exports, independent FFprobe inspection, and ExifTool verify matching identifiers, the timed marker, unchanged video packets/frames, and the selected JPEG frame. Tests cover package structure, source bounds, loop timing, and cancellation. Physical Mac Photos/iPhone import and Lock Screen animation have not been verified by PerfectLoop; structural checks do not establish those outcomes.

## Research sources

Researched on 2026-10-06. Apple support, developer, and App Store pages were blocked by this environment's network policy. Findings were cross-checked against accessible format definitions, camera-file metadata, implementations, and compatibility reports. References inform independently written format code; no donor camera recordings, sensor templates, GPS, or third-party implementation code are included.

- [LimitPoint format and PhotoKit workflow](https://github.com/LimitPoint/LivePhoto/blob/0263052d14e2fc8399b9f6d0ef73e31054ae9427/README.md).
- [ExifTool Apple MakerNote identifier](https://github.com/exiftool/exiftool/blob/2200871d9cef988051d2a99d67df3bda6cbb30a8/lib/Image/ExifTool/Apple.pm#L112) and [QuickTime definitions](https://github.com/exiftool/exiftool/blob/2200871d9cef988051d2a99d67df3bda6cbb30a8/lib/Image/ExifTool/QuickTime.pm#L6731).
- [Established makelive PVT writer](https://github.com/RhetTbull/makelive/blob/40abfa4a5bc458609ddb9087d3a2743a826103a4/makelive/makelive.py#L362) and [native bundle UTI mapping](https://github.com/RhetTbull/osxphotos/blob/a671b60c4cc4be6db4152dbcb351ed3cf33c9bf9/osxphotos/uti.py#L273).
- [Reported iPhone/iPad Files import workflow](https://github.com/Hronrad/livephoto-forge/blob/41d2366f68dffad7a1be038de7613882b117d077/README.en.md) and [structural export tests](https://github.com/Hronrad/livephoto-forge/blob/41d2366f68dffad7a1be038de7613882b117d077/tests/test_web.py#L79). This report does not specify a tested iOS version or provide independent device verification.
- [Mac Photos → iCloud → iPhone playback report](https://github.com/RhetTbull/makelive/issues/26#issuecomment-2708626042), distinguishing wallpaper failure from Photos playback.
- [Modern wallpaper compatibility reports](https://github.com/LimitPoint/LivePhoto/issues/10).
