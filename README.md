<p align="center">
  <img src="./favicon.svg" width="72" height="72" alt="PerfectLoop logo">
</p>

# PerfectLoop

A browser-based video loop studio for Spotify Canvas, music visuals, iPhone wallpaper preparation, and short clips. Find repeating moments in longer footage, choose how to join them, and export a loop in portrait, landscape, square, or custom dimensions.

Media processing happens on your device; your source videos and photos are never uploaded.

**[Open PerfectLoop](https://espmaniac.github.io/PerfectLoop/)**

## Features

- **Automatic loop discovery** — search an entire video or a selected range, set preferred loop lengths, and compare ranked candidates with thumbnails.
- **Loop repair** — analyze an almost-looping clip, reduce sampled brightness fluctuations, correct a confident small seam drift, and compare an optional forward dissolve with the original.
- **Precise timing** — edit in/out points, step through frames, drag timeline handles, zoom the filmstrip, and undo or redo settings.
- **Six loop methods** — use a natural cut, dissolve, ping-pong, or fade depending on the footage.
- **Flexible framing** — choose Original, 16:9, 9:16, 1:1, or Custom; adjust crop position, fit, rotation, mirroring, and background color.
- **Motion controls** — change playback speed, overlap, dissolve curve, seam position, and optional motion interpolation.
- **Seam inspection** — compare boundary frames, inspect their difference, use composition guides, and watch a rendered loop preview.
- **Audio control** — mute playback independently, export without an audio track, or retain audio with smoothing options.
- **Export options** — download MP4, WebM, or a GIF that loops forever or plays once. Adjust frame rate and dimensions for all formats; set quality, cycles in the file, and an approximate file-size target for video. Export selected loop candidates together as a ZIP.
- **Included sample** — a repeating animation with audio loads automatically once when the page opens.
- **Text and image layers** — add text or a local image in **Layers**, set its position, size, angle, and opacity, and reorder, hide, or duplicate it. Move either type left to right, right to left, top to bottom, or bottom to top while preserving its angle.
- **Video patches** — reuse a clean moving region from the current source, with forward seam blending, soft edges, active timing, and fades. The donor cycle is fitted to its active interval in both preview and export.
- **Static patches** — select a clean frame fragment with a rectangle, lasso, or polygonal lasso and place it back at the same position. Feather its edges and limit its visibility to part of each loop.
- **iPhone wallpaper preparation** — open a video or photo, preview approximate Lock Screen and Home Screen layouts, choose a key photo, and create a paired Live Photo entirely in the browser. Download its native package, a still JPG, regular MP4, or full wallpaper kit with Photos import instructions.

## Cover a stationary defect with a patch

1. Open **Layers** and pause the source on a clean frame. Use the timeline or frame-step controls to find it.
2. Choose **Create patch from frame**. The selection window shows the framed source before layers and loop effects.
3. Draw a rectangle or freehand lasso. For polygonal lasso, click the corners and choose **Close polygon**. Use **Selection zoom** and scroll to reach small details. **Feather** softens the selected edge in output pixels.
4. Choose **Create patch**. The fragment becomes a fully opaque, static **Patch** layer at its original output coordinates.
5. Set **Active time → Show from / Show until**, or leave **Until end of loop** enabled. Times refer to the finished loop, repeat each cycle, and apply to both Composition and encoded output. Render to check the actual join and timing.

Patches can be moved, resized, rotated, hidden, duplicated, and removed like image layers. Opacity is available; movement and spinning are under **Optional animation** and are off by default. Active-time controls also work for ordinary text and image layers. An explicit end beyond the loop is clipped; a start beyond the loop keeps the layer hidden.

Static patches freeze a fragment. Neither patch type tracks objects or performs smart object segmentation. It works best for stationary details. Changing source framing may require recreating the patch, and loop repairs or dissolves may change the surrounding image. Feathering is baked into the fragment when it is created; redraw the selection to change it. Source pixels and generated patches stay in the browser.

## Cover a moving texture with a video patch

1. In **Layers**, choose **Create video patch** and draw a rectangle, lasso, or polygon around the stationary region to replace.
2. Set **Source from / Source to** to a clean 0.1–8 second donor fragment from the current video. The selection canvas remains the source frame shown when the dialog opened. Set **Feather** before creating the patch.
3. Set **Show from / Show until** in finished-loop seconds. One forward donor cycle fits that interval; the panel displays the resulting donor speed. Leave **Until end of loop** on for a patch that reaches the end.
4. Adjust **Seam blend** (0–40%) to blend the donor's tail into its head without reversing motion. This can create double edges on moving objects; it is not optical flow or object tracking.
5. Use **Fade in / Fade out** to soften a temporary repair's appearance. Fades are capped at half the active interval. Leave them at zero for uninterrupted coverage across the loop boundary. Hide the layer to compare, then render the finished loop.

Video patches capture up to 30 frames per second and retain only the selected region locally. Captured donor frames share a 64 MiB budget, including assets retained for Undo; export sequences have a 256 MiB uncompressed frame budget. Oversized operations stop with an explanation rather than silently reducing quality. Recreate a patch to change its donor range, mask, feathering, or source framing. Donor audio is excluded. MP4, WebM, and GIF use the same frame sampling and fades as the Composition preview. This tool suits fixed regions such as water, smoke, or a stationary reflection; it does not automatically follow a moving subject.

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

## Automatic repair

Open **Repair loop → Analyze & repair**. **Keep duration** preserves the finished cycle's exact frame count; a forward seam blend may slightly adjust playback speed to compensate for overlap. **Allow trimming** permits at most 20% shortening and never lengthens the loop.

Auto repair renders the current result, samples frames on both sides of the boundary, and scores small image tiles so a large static background cannot hide a local jump. It tests applicable brightness/alignment corrections, forward seam blending, a better nearby cut, and a feathered local video patch. Local patches currently use the selected source range (up to eight seconds), stay below existing overlays, and must fit both capture and full-resolution export memory budgets. Reverse and shifted methods retain their intended motion; they are not automatically converted to forward loops.

For an unshifted Natural loop without brightness/alignment repair, Auto repair also tries **Local background restoration**. It samples 17 source frames and only borrows colors that recur in at least 75% of the interior samples. A feathered mask targets changing boundary details; the generated patch fades away within 0.4 seconds of each side of the seam and is transparent throughout the middle. It leaves playback speed and duration unchanged. Moving backgrounds, large masks, insufficient exposed background, and excessive memory requirements are rejected. This can soften the disappearance of a small transient object; it does not track bubbles or invent hidden background. The usual motion and detail checks still apply, so removing an object may be rejected if it suppresses too much visible motion.

Candidates must materially reduce sampled seam error without failing the detail, motion, or duration checks. These are image-based screening heuristics, not semantic object recognition, optical flow, or a guarantee against ghosting. The highest-ranked result is shown beside **Before**, with the detected region outlined and a **What was tested** report. **Play both from the seam** starts a comparison near each loop boundary. Nothing changes until **Apply repair**; **Keep original** or Escape discards the proposal. If no candidate passes, Apply is disabled.

Applying changes one Undo step and opens the already-rendered result as **Loop preview**. Generated patches remain editable in Layers; Undo/Redo preserves their assets. Rejected and cancelled patches release their provisional frames. Source videos, analysis frames, and comparison renders remain local to the browser.

## Repair an existing loop

Open **Repair loop**, select the timeline range (or **Use the full video**), and choose **Analyze loop**. The analysis samples up to 25 framed source images before layers and loop effects. It recommends brightness correction and, only when a small translation improves the boundary reliably, alignment. A better nearby cut may also be suggested; applying it requires a new analysis.

- **Flicker** estimates brightness from relatively stable pixels and smooths its curve across the cycle boundary. It can help slow exposure fluctuations; fast or local flicker and intentional lighting changes still need visual review.
- **Alignment** gradually shifts the ending and applies a small fixed crop throughout the clip to avoid empty borders. This is translation correction, not object tracking, optical flow, or reconstruction of changing shapes.
- **Seam blending** uses the existing forward crossfade. The overlap shortens the cycle and may produce ghosting; it never reverses water, smoke, or other motion.

**Correction strength** controls brightness and alignment; **Overlap** controls blending. **Apply repairs** saves the chosen settings for preview and export. **Preview result** applies them and renders; **Preview original** renders the same selected range and layers without repair or loop effects. Compare several repeats. Source and Composition previews do not show repairs. Changing the range, framing, speed, or frame rate clears the applicable correction; layer edits preserve it. Batch candidate exports do not inherit repairs from a different range.

These tools help with small defects and do not guarantee a seamless result for every clip. Analysis, processing, and media remain local to the browser.

## Make a loop

1. Start with the automatically loaded sample, choose **Open media** for a video, or drop your own video into the editor.
2. Set the in/out points manually, or use **Auto find** to discover candidate ranges.
3. Choose a loop method and configure dimensions and audio in **Video settings**. Select **Video** in **Layers** to adjust framing.
4. Select **Render preview** and use **Inspect seam** to check the join.
5. Export the finished loop and review the downloaded file at full resolution.

**Auto find** ranks loopable clips throughout **Search from / Search to**, including clips beginning later in the video. Those fields and the timeline handles edit the same search area; playback and frame stepping in Auto find also use that area. **Min / Max loop length** constrain each candidate's source duration. Selecting a candidate sets the separate render in/out points, compares all available loop methods, and applies a recommendation while preserving the search area. Method buttons show fit estimates; expand **Method comparison** for duration and transition measurements. You can change the method manually. **Hide similar ranges** is enabled by default and reveals cached alternatives when switched off. Changing other search options clears previous results. Search edits support Undo/Redo.

The **Source** preview keeps the original video's proportions. **Loop preview** shows the rendered output, including its framing, at a smaller resolution. In **Edit loop**, drag the video to open a live **Composition** draft and reposition it within the output frame. Drag a square corner handle to resize it from 25% to 400%, or drag just outside a corner to rotate it freely. Holding Alt while dragging a square also rotates; Shift snaps rotation to 15° increments. Smaller sizes and rotation can expose the border color. Reset restores 100% scale, centered positioning, and 0° rotation. **Video scale** and **Video rotation** in the **Layers → Video** controls accept numeric values. These settings apply to rendered previews and exports. Render again after changing settings.

The editor outline follows the full object, including parts outside the cropped output. **Fit view** fits its real corners and the output frame on screen; the view zoom buttons only change the editor camera. The marked **Output frame** contains the exported pixels. Rotating with the handles keeps that output frame fixed, including when Original aspect was selected. Source and rendered Loop previews retain their normal view.

The **Layers** tab opens a live **Composition** draft with output framing. **Movement speed** chooses 1–10 complete passes per processed loop cycle. The four screen directions follow the frame axes. Rotating a text or image layer adds **Along rotation** and **Against rotation** to **Movement**; these follow the element's angle in either direction. An angled path exits the frame before returning at the opposite end, so it repeats without a visible jump. Resetting Rotation to 0° (or a full turn) converts these choices to Left to right or Right to left. **Render preview** and exports include the same layers and motion; video repeats repeat the entire composed cycle, and GIF **Loop forever** repeats that cycle automatically.

**Rotation animation** spins text or images clockwise or counterclockwise around their center. **Rotation speed** chooses 1–10 complete turns per processed loop. **Rotation** sets the starting angle. Spin can be combined with any **Movement** choice; Along rotation and Against rotation use the starting angle, so the travel path stays straight while the element spins.

Both speed sliders use whole passes or turns so the loop ends at its starting position and angle. Their calculated rates use one processed cycle: movement passes per second and rotation degrees per second. Changing the range, loop method, playback speed, or frame rate updates those rates; video repeats repeat the same animation. Static hides its speed slider and retains the value for when animation is enabled again.

Images are read locally as PNG, JPEG, WebP, or GIF; animated images use their first frame. In **Layers**, click anywhere inside a text or image rectangle to select and move it, including spaces between letters and the outline outside the output frame. Drag a square corner to resize it with its proportions preserved and the opposite corner fixed. Images can be sized from 1% to 400% of the output width, subject to the existing sprite memory limit. Drag just outside a corner to rotate around the visible content center. Its selection outline follows its current movement and rotation; transforms retain the animation settings. Video dragging is locked while Layers is open; select **Video** there to adjust framing controls. Corner handles support arrow keys: squares resize and rotation handles change the angle by 1°, or 15° with Shift. Each drag forms one Undo step. Layers and image assets remain in this page session and support Undo/Redo. Up to eight layers are supported.

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

## Layer placement and alignment

In **Layers**, use the up/down arrows to change the single layer stack. Move an image or text below **Video** in the list to place it behind the source; move it above **Video** to place it in front. The Video row has the same ordering arrows. The highest row is the frontmost layer. Lower layers appear in the space around a fitted, scaled-down, or rotated video. An opaque video filling the entire frame hides them. Select **Video** in the layer list to change its scale, rotation, position, or alignment. Video dragging remains locked in Layers.

**Align to frame** positions the selected layer at the left, center, right, top, or bottom of the output frame, accounting for its rotation. For animated layers this sets the starting position and returns the composition animation to its beginning. **Text alignment** separately controls lines within a text block. Video alignment and framing controls are in the Video row in Layers. Alignment and stack placement support Undo/Redo and are included in rendered previews and exports.
