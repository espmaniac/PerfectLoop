# iPhone wallpaper preparation

PerfectLoop prepares wallpaper media locally in the browser. It can download resources for a Live Photo, but saving those resources as one asset in Photos requires a native import or conversion step.

## Create and preview

1. In **Video settings**, select **iPhone wallpaper** under **Destination preset**.
2. Choose a representative phone screen size or **Custom phone size**. These profiles describe output dimensions; they do not reproduce every iPhone model or iOS layout exactly.
3. Open a video, or choose **Open photo** for a JPEG, PNG, or WebP image. A photo becomes a gentle three-second zoom loop that returns to its starting framing. Add text and image layers in **Layers** if needed.
4. Choose the source range, loop method, framing, and layer animation. **Fit to a 3-second cycle** accounts for speed, dissolves, and ping-pong. Shorter sources remain within their available range. Three seconds is a useful conversion starting point, not a verified universal iOS limit.
5. Select **Render preview**. Use **Lock Screen** to review approximate clock placement and **Home Screen** to review a still background behind approximate app icons. **Editor** returns to the ordinary canvas. Source playback uses the ordinary canvas too.
6. Set **Key photo** to a frame in the finished video. Changing this frame alone does not require another video preview render. The Home Screen preview uses that still frame after a current render; before rendering it shows a labeled draft.

The screen simulation is approximate. Actual wallpaper cropping, controls, motion eligibility, and playback depend on the device and iOS. All screen frames, clocks, and app icons are DOM overlays; none are painted into exported photos or video.

## Downloads

| Choice | Download | Next step |
| --- | --- | --- |
| MP4 for an iOS converter | One silent H.264 video cycle | Transfer to the iPhone and use a converter that supports Live Photo wallpapers for its iOS version. |
| Still wallpaper · JPG | The selected frame from the finished video | Save to Photos and select as a still Lock Screen or Home Screen wallpaper. |
| Wallpaper kit · ZIP | The files below and instructions | Try the paired Photos import, or use the included MP4 conversion path. |

The kit contains:

```text
live-photo/photo.jpg     JPEG with the Live Photo pairing identifier
live-photo/photo.mov     Silent QuickTime movie with pairing and timed still metadata
wallpaper.jpg            Plain selected still frame
wallpaper.mp4            Ordinary MP4 conversion input
wallpaper-info.json      Dimensions, timing, identifier, and experimental status
README.txt               Transfer and installation instructions
```

The video contains the selected loop method, crop, layers, and animations. The plain and paired still images use the same frame from that finished video. The key-photo slider reaches the last actual frame rather than the end-of-file timestamp.

## Transfer to iPhone

### MP4 conversion

1. Download the MP4 directly or extract `wallpaper.mp4` from the kit.
2. Transfer the video to the iPhone through Files, cloud storage, or AirDrop.
3. Open it in an iOS converter that supports Live Photo wallpapers for the target iOS version and save the converted asset to Photos.
4. In **Settings → Wallpaper → Add New Wallpaper → Photos**, select that Live Photo and check that motion is available before setting it as the Lock Screen.

Converter support varies. PerfectLoop does not require a particular app or assume every converter version supports every iPhone.

### Experimental paired import on a Mac

1. Unzip the kit on the computer.
2. Import **both** `live-photo/photo.jpg` and `live-photo/photo.mov` together into Photos on a Mac.
3. Verify that Photos shows **one Live Photo** and plays its motion.
4. Sync that Photos asset using iCloud Photos, or share the already imported asset from Photos to the iPhone with AirDrop.
5. Check the asset in iPhone Photos, then check motion availability when selecting it as wallpaper.

Downloading a ZIP into Files does not create a Live Photo asset. Two loose files shared separately are not a reliable substitute for importing the paired asset. Windows/Linux users can use the MP4 conversion route. If the paired import or wallpaper motion fails, the kit retains the MP4 and still JPG.

Home Screen wallpaper is static. Lock Screen motion is controlled by iOS; it is not continuous video playback.

## Format and compatibility

A Live Photo uses a paired still and QuickTime movie, not a GIF or an MP4 renamed to MOV. PerfectLoop independently writes these pairing structures:

| Resource | Pairing data |
| --- | --- |
| JPEG | Apple MakerNote tag 17 (`ContentIdentifier`) with a newly generated UUID. |
| MOV | The same UUID in `com.apple.quicktime.content.identifier` movie metadata. |
| MOV timed metadata | A boxed `mebx` sample in a `meta` track, with `com.apple.quicktime.still-image-time`, signed int8 value −1. The sample presentation time identifies the key photo. |

The MOV is remuxed from the completed H.264 output without re-encoding its video packets. Its metadata track is a real timed track, rather than a global string bearing the same name. The JPEG writer preserves its compressed image data. The browser has no standard PhotoKit API that inserts both resources into Photos as one asset.

**Pairing is separate from wallpaper eligibility.** Modern camera Live Photos can contain additional vitality scoring and binary timed `live-photo-info` metadata. Those fields and modern iOS wallpaper acceptance rules are not reproduced by this exporter. A pair may work in Photos and still show **Motion Not Available** in wallpaper selection. PerfectLoop labels this route experimental and includes the MP4 conversion fallback.

The implementation was checked with browser FFmpeg exports, independent FFprobe packet/frame inspection, and ExifTool: matching identifiers, a correctly timed still marker, unchanged video packets, and a matching selected JPEG frame. Automated tests also cover source bounds, loop-method timing, packaging, and cancellation. Import into Mac Photos and Lock Screen animation have not been tested on a physical iPhone; structural checks do not establish that compatibility.

## Research sources

Researched on 2026-10-06. Apple support, developer, and App Store pages were blocked by this environment's network policy, so the format and import findings were cross-checked against the accessible implementations, format definitions, camera-file metadata, and compatibility reports below. References inform the independently written format code; no camera recordings, sensor templates, GPS, or implementation code from these projects are included in PerfectLoop.

- [LimitPoint LivePhoto format and PhotoKit workflow](https://github.com/LimitPoint/LivePhoto/blob/0263052d14e2fc8399b9f6d0ef73e31054ae9427/README.md).
- [ExifTool Apple MakerNote identifier definition](https://github.com/exiftool/exiftool/blob/2200871d9cef988051d2a99d67df3bda6cbb30a8/lib/Image/ExifTool/Apple.pm#L112).
- [ExifTool QuickTime metadata definitions](https://github.com/exiftool/exiftool/blob/2200871d9cef988051d2a99d67df3bda6cbb30a8/lib/Image/ExifTool/QuickTime.pm#L6731), including vitality fields and timed Live Photo metadata.
- [makelive import workflow and wallpaper limitations](https://github.com/RhetTbull/makelive/blob/40abfa4a5bc458609ddb9087d3a2743a826103a4/README.md).
- [Maintainer report: Mac Photos → iCloud Photos → iPhone playback](https://github.com/RhetTbull/makelive/issues/26#issuecomment-2708626042), with wallpaper failure distinguished from Photos playback.
- [iOS 17 wallpaper compatibility reports](https://github.com/LimitPoint/LivePhoto/issues/10).
