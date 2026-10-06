<p align="center">
  <img src="./favicon.svg" width="72" height="72" alt="PerfectLoop logo">
</p>

# PerfectLoop

A browser-based video loop studio for Spotify Canvas, music visuals, iPhone wallpaper preparation, and short clips. Find repeating moments in longer footage, choose how to join them, and export a loop in portrait, landscape, square, or custom dimensions.

Media processing happens on your device; your source videos and photos are never uploaded.

**[Open PerfectLoop](https://espmaniac.github.io/PerfectLoop/)**

## Features

- **Automatic loop discovery** — search an entire video or a selected range, set preferred loop lengths, and compare ranked candidates with thumbnails.
- **Precise timing** — edit in/out points, step through frames, drag timeline handles, zoom the filmstrip, and undo or redo settings.
- **Six loop methods** — use a natural cut, dissolve, ping-pong, or fade depending on the footage.
- **Flexible framing** — choose Original, 16:9, 9:16, 1:1, or Custom; adjust crop position, fit, rotation, mirroring, and background color.
- **Motion controls** — change playback speed, overlap, dissolve curve, seam position, and optional motion interpolation.
- **Seam inspection** — compare boundary frames, inspect their difference, use composition guides, and watch a rendered loop preview.
- **Audio control** — mute playback independently, export without an audio track, or retain audio with smoothing options.
- **Export options** — download MP4, WebM, or a GIF that loops forever or plays once. Adjust frame rate and dimensions for all formats; set quality, cycles in the file, and an approximate file-size target for video. Export selected loop candidates together as a ZIP.
- **Included sample** — a repeating animation with audio loads automatically once when the page opens.
- **Text and image layers** — add text or a local image in **Layers**, set its position, size, angle, and opacity, and reorder, hide, or duplicate it. Move either type left to right, right to left, top to bottom, or bottom to top while preserving its angle.
- **iPhone wallpaper preparation** — open a video or photo, preview approximate Lock Screen and Home Screen layouts, choose a key photo, and create a paired Live Photo entirely in the browser. Download its native package, a still JPG, regular MP4, or full wallpaper kit with Photos import instructions.

## Loop methods

| Method | How it works |
| --- | --- |
| Natural cut | Joins the selected end directly to the start. Best when the source motion already repeats. |
| Crossfade | Blends the end into the start using an adjustable overlap. |
| Offset dissolve | Uses the dissolve cycle and moves the transition inside the clip. |
| Ping-pong | Plays to the end, then backward to the start. Each cycle is nearly twice as long as a forward pass, without duplicate turning-point frames. |
| Smooth ping-pong | Slows the forward and backward motion into each turn for a softer reversal. |
| Fade through black | Hides the boundary with matching black frames and a visible fade. |

Dissolves can introduce ghosting, and ping-pong methods reverse motion. Choose the method that suits the footage, then check the join in motion.

Both ping-pong methods work with MP4, WebM, and GIF. GIF has no playback-direction flag, so one cycle stores the forward and backward frames. **Loop forever** repeats that entire cycle; turning it off plays the forward-and-backward cycle once.

## Make a loop

1. Start with the automatically loaded sample, choose **Open media** for a video, or drop your own video into the editor.
2. Set the in/out points manually, or use **Auto find** to discover candidate ranges.
3. Choose a loop method and configure dimensions, framing, and audio in **Video settings**.
4. Select **Render preview** and use **Inspect seam** to check the join.
5. Export the finished loop and review the downloaded file at full resolution.

**Auto find** ranks loopable clips throughout **Search from / Search to**, including clips beginning later in the video. Those fields and the timeline handles edit the same search area; playback and frame stepping in Auto find also use that area. **Min / Max loop length** constrain each candidate's source duration. Selecting a candidate sets the separate render in/out points and preserves the search area for another search. Changing search options clears previous results. Search edits support Undo/Redo.

The **Source** preview keeps the original video's proportions. **Loop preview** shows the rendered output, including its framing, at a smaller resolution. In **Edit loop** or **Layers**, drag the video to open a live **Composition** draft and reposition it within the output frame. **Video scale** resizes the video from 25% to 400%; smaller sizes can expose the border color. Reset restores 100% scale and centered positioning. These settings also apply to rendered previews and exports. Render again after changing settings.

The **Layers** tab opens a live **Composition** draft with output framing. **Movement speed** chooses 1–10 complete passes per processed loop cycle. The four screen directions follow the frame axes. Rotating a text or image layer adds **Along rotation** and **Against rotation** to **Movement**; these follow the element's angle in either direction. An angled path exits the frame before returning at the opposite end, so it repeats without a visible jump. Resetting Rotation to 0° (or a full turn) converts these choices to Left to right or Right to left. **Render preview** and exports include the same layers and motion; video repeats repeat the entire composed cycle, and GIF **Loop forever** repeats that cycle automatically.

**Rotation animation** spins text or images clockwise or counterclockwise around their center. **Rotation speed** chooses 1–10 complete turns per processed loop. **Rotation** sets the starting angle. Spin can be combined with any **Movement** choice; Along rotation and Against rotation use the starting angle, so the travel path stays straight while the element spins.

Both speed sliders use whole passes or turns so the loop ends at its starting position and angle. Their calculated rates use one processed cycle: movement passes per second and rotation degrees per second. Changing the range, loop method, playback speed, or frame rate updates those rates; video repeats repeat the same animation. Static hides its speed slider and retains the value for when animation is enabled again.

Images are read locally as PNG, JPEG, WebP, or GIF; animated images use their first frame. In **Layers**, click a visible text or image in the preview to select it, then drag it to change its position. Its selection outline follows its current movement and rotation. Outside **Layers**, dragging changes video framing. Each drag forms one Undo step. Layers and image assets remain in this page session and support Undo/Redo. Up to eight layers are supported.

Text layers include Inter, Noto Serif, Roboto Mono, Oswald, Lobster, and Pacifico, all with Latin and Cyrillic support, alongside generic system families. These fonts are bundled with the editor and load when selected. **Use device fonts** adds the installed font faces provided by the browser, including bold and italic variants, after you grant permission. Device font enumeration requires a supporting browser such as desktop Chrome or Edge and a secure origin (HTTPS or localhost); other browsers can use **Upload fonts** instead.

**Upload fonts** accepts one or more TTF, OTF, WOFF, or WOFF2 files, up to 20 MB per file. Font files stay on your device and remain available for this page session, including after Undo/Redo or opening another video. Preview and export wait for the selected font to load before measuring or rendering the text. See [bundled font licenses and sources](./vendor/fonts/README.md).

Text colors use an embedded picker with hue, saturation, brightness, HEX, RGB, and color opacity controls, so selecting a color stays inside the editor. Text fills support solid colors and linear, radial, or conic gradients. Add any number of color stops, edit their positions and opacity, and set the gradient angle or center and radius. Equal stop positions create hard color transitions. One gradient covers the whole text block, including multiple lines, and moves and rotates with the text in Composition, rendered previews, and exports. Layer Opacity applies to the entire text layer in addition to each color's opacity. Picker drags form one Undo step.

The displayed **Finished loop** duration includes the loop method, speed, overlap, and repeats. In/out points describe the source range; a dissolve shortens it, while ping-pong extends it.

## Output presets

| Preset | Intended use |
| --- | --- |
| Spotify Canvas | Silent MP4 at 576 × 1024 and 30 fps, with checks for the finished 3–8 second loop. |
| Vertical music visual | Short portrait visuals, with a suggested duration of up to 15 seconds. |
| iPhone wallpaper | A suggested two-second cycle, phone-size previews, key-photo selection, and Live Photo or ordinary wallpaper downloads. |
| Custom | Your own output dimensions, format, timing, and frame rate. |

Select **Custom** under **Aspect ratio** to enter Width and Height directly. Use even dimensions from **16 to 3840 pixels**.

MP4 uses H.264 with optional AAC audio. The paired MOV inside a Live Photo uses the separate HEVC compatibility profile described below. WebM uses VP8 with optional Opus audio. GIF exports are silent and contain one loop cycle; **Loop forever** controls whether playback repeats continuously or stops after that cycle. Video cycle counts and file-size targets do not apply to GIF.

**Muting the preview does not remove export audio.** Choose the audio-removal option in **Video settings** to create a video with no audio stream.

Review [Spotify's Canvas guidelines](https://support.spotify.com/us/artists/article/canvas-guidelines/) before submitting a Canvas.

## Prepare an iPhone wallpaper

Select **iPhone wallpaper** in **Destination preset**. Choose a phone size or enter custom dimensions, then open a video or choose **Open photo** to make a gentle two-second zoom loop from a JPEG, PNG, or WebP photo. The preset suggests a two-second selection; **Fit to a 2-second cycle** adjusts the source range for the loop method and speed. Text and image layers, movement, rotation, and framing work with wallpaper exports.

Select **Render preview**, then use **Video** to play the processed clip. **Lock Screen layout** and **Home Screen layout** show the selected **Key photo** behind approximate phone controls and icons. They are static layout checks; before a current render, they show a labeled draft. Phone frames, clocks, and icons never appear in downloaded media.

iOS creates its own short Lock Screen wake animation from motion near the key photo. It can select only a small part of the clip, change its speed, and interpolate or drop frames. The browser's full-video playback does not simulate that effect or establish its smoothness. Choose a key photo near the movement you want to highlight, then check the result on the target iPhone.

PerfectLoop creates the paired JPEG/MOV, timed frame and key-photo metadata, and native `.pvt` package on this site, without a third-party converter. Live Photo exports use silent HEVC Main, 8-bit video at 60 fps, scaled down to at most 720 × 1560 while preserving the selected aspect ratio. They do not upscale smaller output sizes. The full kit's MP4 and JPG use this same size; standalone **Video · MP4** and **Still wallpaper · JPG** keep your selected dimensions.

The generated timing records describe the exported frames with identity geometry and their actual timestamps. They are not measurements of the source camera's motion. PerfectLoop does not copy donor sensor recordings or add a fake camera identity or GPS location.

Browsers with directory access offer **Live Photo · PVT package** by default: select a destination folder, and the site saves the real package directly without an archive. Existing packages are preserved, and interrupted writes remove the partial package. If cleanup fails, the error identifies the folder to remove.

Safari, including iPhone, and browsers without directory access use **Live Photo · ZIP**. A `.pvt` is a package folder, so downloading an ordinary file with that extension cannot replace the folder's structure. Creation and export work in a compatible browser on a phone or computer; saving the finished result into Apple Photos is a separate system import step.

On iPhone/iPad, try saving the ZIP to Files, choosing **Uncompress**, opening `live-photo.pvt`, and using **Save to Photos** if the system offers it. This action depends on iOS and is not guaranteed. On a Mac, import the package or its paired files together into the built-in Photos app, verify one Live Photo, then sync with iCloud Photos or share that asset from Photos via AirDrop. The full kit also includes an MP4 and still JPG at the compatibility size.

Import and wallpaper eligibility are experimental: native package support does not guarantee an import action is available in Files, and correct metadata does not guarantee modern iOS will animate the result as Lock Screen wallpaper. PerfectLoop has not verified these outcomes on a physical iPhone. Home Screen wallpaper stays still; iOS controls Lock Screen motion. Two seconds is preparation guidance, not a universal Apple limit. See [format details, import steps, and the device reports behind the compatibility profile](./docs/iphone-wallpapers.md).

## Browser and processing notes

Search scores estimate visual similarity; they do not guarantee a smooth transition. Review candidates and the rendered preview before exporting.

Processing speed and available memory depend on the browser and device. Large resolutions, long clips, ping-pong buffers, and motion interpolation take more resources. Short clips at moderate resolutions work best.

Live Photo encoding uses a bundled multithread FFmpeg core. On a supported HTTPS or localhost page, an app-scoped service worker supplies the cross-origin isolation headers it needs. First use can reload the page once, before the editor, sample, or local files load. The worker fetches network responses without caching media or creating an offline copy. Browsers that cannot enable isolation can still use the ordinary single-thread editor; Live Photo HEVC export requires the multithread core.

Source playback depends on browser codec support. If a file cannot play, use **Create proxy**. Exports still read the original file; retained audio is taken from the original source.

When opening a video, the editor checks a small readable prefix before replacing the current project and repairs missing MIME information for known video containers. An empty or unavailable Photos/iCloud selection keeps the previous project and explains how to retry. Frame readers remain attached to the document while waiting for decoded frames, then are removed after reading or cancellation. These measures improve Safari loading; a Photo Library file may still differ from the file selected through Files because iOS can supply a converted or temporary representation.

## License

Application source: **GPL-3.0-or-later**. Bundled dependencies retain their own licenses. See [LICENSE](./LICENSE) and [THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt).
