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
- **Six loop methods** — use a natural cut, dissolve, rebound, or fade depending on the footage.
- **Flexible framing** — choose Original, 16:9, 9:16, 1:1, or Custom; adjust crop position, fit, rotation, mirroring, and background color.
- **Motion controls** — change playback speed, overlap, dissolve curve, seam position, and optional motion interpolation.
- **Seam inspection** — compare boundary frames, inspect their difference, use composition guides, and watch a rendered loop preview.
- **Audio control** — mute playback independently, export without an audio track, or retain audio with smoothing options.
- **Export options** — download MP4, WebM, or an infinitely repeating GIF; adjust quality, frame rate, repeats, and an approximate file-size target. Export selected loop candidates together as a ZIP.
- **Included sample** — try the editor with a repeating animation and audio before opening your own video.

## Loop methods

| Method | How it works |
| --- | --- |
| Natural cut | Joins the selected end directly to the start. Best when the source motion already repeats. |
| Crossfade | Blends the end into the start using an adjustable overlap. |
| Offset dissolve | Uses the dissolve cycle and moves the transition inside the clip. |
| Rebound | Plays forward and backward without duplicating the turning-point frames. |
| Eased rebound | Slows the video into each turn for a softer reversal. |
| Fade through black | Hides the boundary with matching black frames and a visible fade. |

Dissolves can introduce ghosting, and rebound methods reverse motion. Choose the method that suits the footage, then check the join in motion.

## Make a loop

1. Choose **Open video**, drop a file into the editor, or select **Load sample**.
2. Set the in/out points manually, or use **Auto find** to discover candidate ranges.
3. Choose a loop method and configure the output dimensions, framing, and audio.
4. Select **Render preview** and use **Inspect seam** to check the join.
5. Export the finished loop and review the downloaded file at full resolution.

The **Source** preview keeps the original video's proportions. **Loop preview** shows the rendered output, including its framing, at a smaller resolution. Render again after changing settings.

The displayed **Finished loop** duration includes the loop method, speed, overlap, and repeats. In/out points describe the source range; a dissolve shortens it, while a rebound extends it.

## Output presets

| Preset | Intended use |
| --- | --- |
| Spotify Canvas | Silent MP4 at 576 × 1024 and 30 fps, with checks for the finished 3–8 second loop. |
| Vertical music visual | Short portrait visuals, with a suggested duration of up to 15 seconds. |
| Custom | Your own output dimensions, format, timing, and frame rate. |

Select **Custom** under **Aspect ratio** to enter Width and Height directly. Use even dimensions from **16 to 3840 pixels**.

MP4 uses H.264 with optional AAC audio. WebM uses VP8 with optional Opus audio. GIF exports are silent.

**Muting the preview does not remove export audio.** Choose the audio-removal option in Output to create a video with no audio stream.

Review [Spotify's Canvas guidelines](https://support.spotify.com/us/artists/article/canvas-guidelines/) before submitting a Canvas.

## Browser and processing notes

Search scores estimate visual similarity; they do not guarantee a smooth transition. Review candidates and the rendered preview before exporting.

Processing speed and available memory depend on the browser and device. Large resolutions, long clips, rebound buffers, and motion interpolation take more resources. Short clips at moderate resolutions work best.

Source playback depends on browser codec support. If a file cannot play, use **Create proxy**. Exports still read the original file; retained audio is taken from the original source.

## License

Application source: **GPL-3.0-or-later**. Bundled dependencies retain their own licenses. See [LICENSE](./LICENSE) and [THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt).
