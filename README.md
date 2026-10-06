<p align="center">
  <img src="./favicon.svg" width="72" height="72" alt="PerfectLoop logo">
</p>

# PerfectLoop

A browser-based video loop studio for Spotify Canvas, music visuals, and short clips. Find repeating moments in longer footage, choose how to join them, and export a loop in portrait, landscape, square, or custom dimensions.

Video processing happens on your device; your source videos are never uploaded.

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

1. Start with the automatically loaded sample, choose **Open video**, or drop your own file into the editor.
2. Set the in/out points manually, or use **Auto find** to discover candidate ranges.
3. Choose a loop method and configure dimensions, framing, and audio in **Video settings**.
4. Select **Render preview** and use **Inspect seam** to check the join.
5. Export the finished loop and review the downloaded file at full resolution.

The **Source** preview keeps the original video's proportions. **Loop preview** shows the rendered output, including its framing, at a smaller resolution. Render again after changing settings.

The **Layers** tab opens a live **Composition** draft with output framing. Each moving layer completes one pass per processed loop cycle. The four screen directions follow the frame axes. Rotating a text or image layer adds **Along rotation** and **Against rotation** to **Movement**; these follow the element's angle in either direction. An angled path exits the frame before returning at the opposite end, so it repeats without a visible jump. Resetting Rotation to 0° (or a full turn) converts these choices to Left to right or Right to left. **Render preview** and exports include the same layers and motion; video repeats repeat the entire composed cycle, and GIF **Loop forever** repeats that cycle automatically.

Images are read locally as PNG, JPEG, WebP, or GIF; animated images use their first frame. Layers and image assets remain in this page session and support Undo/Redo. Up to eight layers are supported.

The displayed **Finished loop** duration includes the loop method, speed, overlap, and repeats. In/out points describe the source range; a dissolve shortens it, while ping-pong extends it.

## Output presets

| Preset | Intended use |
| --- | --- |
| Spotify Canvas | Silent MP4 at 576 × 1024 and 30 fps, with checks for the finished 3–8 second loop. |
| Vertical music visual | Short portrait visuals, with a suggested duration of up to 15 seconds. |
| Custom | Your own output dimensions, format, timing, and frame rate. |

Select **Custom** under **Aspect ratio** to enter Width and Height directly. Use even dimensions from **16 to 3840 pixels**.

MP4 uses H.264 with optional AAC audio. WebM uses VP8 with optional Opus audio. GIF exports are silent and contain one loop cycle; **Loop forever** controls whether playback repeats continuously or stops after that cycle. Video cycle counts and file-size targets do not apply to GIF.

**Muting the preview does not remove export audio.** Choose the audio-removal option in **Video settings** to create a video with no audio stream.

Review [Spotify's Canvas guidelines](https://support.spotify.com/us/artists/article/canvas-guidelines/) before submitting a Canvas.

## Browser and processing notes

Search scores estimate visual similarity; they do not guarantee a smooth transition. Review candidates and the rendered preview before exporting.

Processing speed and available memory depend on the browser and device. Large resolutions, long clips, ping-pong buffers, and motion interpolation take more resources. Short clips at moderate resolutions work best.

Source playback depends on browser codec support. If a file cannot play, use **Create proxy**. Exports still read the original file; retained audio is taken from the original source.

## License

Application source: **GPL-3.0-or-later**. Bundled dependencies retain their own licenses. See [LICENSE](./LICENSE) and [THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt).
