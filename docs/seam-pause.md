# Seam pause repair

For the controls and workflow, see [Remove a seam pause](./user-guide.md#remove-a-seam-pause).

## Detection

The analyzer reads framed source pixels before layers or loop effects. It samples consecutive boundary frames over at most 20% of the selection on either side (at least two transitions for short clips), capped at one second and 120 frames per side, plus five interior frame pairs. It retains at most 258 small luminance images and releases its decoder on completion, error, or cancellation.

Activity is the mean of the strongest 20% of 12-pixel tiles after subtracting uniform brightness drift. The median interior activity supplies a reference. Three-transition median screening discounts isolated duplicated frames from FPS conversion; a boundary run below 45% of the reference is considered slow. Nearly identical frames can count as a hold even when compression noise or slight lighting changes remain.

A proposal removes at most 20% of source frames. Static footage, runs reaching the scan limit, and insufficient samples produce no automatic proposal. The detector examines neighboring trim boundaries and checks both sides of the temporal join, including acceleration and excess pixel change. It rejects materially worse sampled continuity. This is a screening heuristic, not optical flow, object tracking, or semantic direction recognition.

Manual controls can trim beyond the detector's limit while leaving valid video. Values are measured using the displayed frame step; detection uses the probed source frame rate. Applying a trim clears timing-dependent brightness/alignment analysis. Keeping duration recalculates playback speed to retain the exact processed frame count for the current loop method. Output constraints, including minimum playback speed, still apply. The trim records its original range and speed for reset and Undo/Redo. Changing the range or speed outside this tool starts a new trim basis.

## Automatic repair

Unshifted Natural cut loops are checked for a source pause even if their endpoint pixels already match. Automatic analysis uses the real video-track end, excluding an audio-only container tail. Before/After comparisons use high-quality reduced-resolution encoding so compression noise does not overwhelm small motion. Reverse, shifted, and dissolve methods are not silently converted to Natural cut.

The pause candidate uses the same trim model as manual repair. Its rendered held duration or low-activity deficit must improve by at least 30%, without excessive detail loss, slower interior motion, a materially worse join, or an invalid duration change. Rendered activity is sampled no faster than the source frame rate to avoid mistaking output FPS duplication for a pause. When temporal discontinuity dominates the original positional mismatch, an accepted pause trim is preferred over adding a dissolve. Other corrections remain available through the normal review flow.

Before and After are reviewed explicitly; changes are applied only through Apply repair. The review describes boundary activity improvement separately from endpoint-error reduction. Rejected candidates and temporary decoder URLs are released. User media is never uploaded.

## Seam playback

Preview seam applies the current manual values, renders when needed, and loops the tail and head while skipping the middle. Each window is at most one second, or one third of a short cycle. Stopping, seeking, changing mode, or starting another render clears this playback mode. The full processed clip remains available in Result; no shortened preview file is created.
