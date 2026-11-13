# Loop search

Search has two stages.

**Sampling.** Descriptors (32 × 32 RGB) are taken about ten times per second: every `round(fps / 10)` source frames, up to 1,601 samples for long ranges. A true repeat therefore lands within one or two frames of a sample. The analysis worker ranks sampled pairs by image structure and forward motion and returns a shortlist of up to 48 distinct candidates, plus the complete range when it fits the length limits and scene-cut policy.

**Frame-level verification.** The 32 best shortlisted candidates are verified with real frames at up to 160 pixels on the longest side. The start frame stays fixed, and every exclusive end within half a sampling step of the sampled end is tested. For each end, the seam is measured directly: the first frame of the loop is compared with the source frame after the end, and the last frame with the source frame before the start. In a seamless loop these are the same images.

The comparison uses 12-pixel tiles. Each tile's difference is reduced by its noise level and divided by the tile's normal frame-to-frame change, so the error is measured in frame steps of local motion. Noise is the larger of the quietest tiles' change (even grain) and the tile's own noise, estimated from the fact that motion accumulates over two frames while noise does not. The six worst tiles are averaged, so a small moving object is not hidden by a static background.

| Seam error | Tier | Typical cause |
| --- | --- | --- |
| ≤ 0.15 | Perfect | Exact repeat, including grain and compression noise |
| ≤ 0.35 | Good | Slight drift or a sub-frame phase difference |
| > 0.35 | Not listed | A repeated or skipped frame (about 0.4–0.9), or no repeat |

When neither neighboring frame is inside the selection (the loop is the complete range), only a jump beyond the usual motion can be measured, and the loop is listed as Good at most.

Perfect loops are listed before good loops. Within a tier, **Prefer visible motion** lowers nearly static clips and scene cuts lower the ranking. Neither changes the tier.

`sourceMetadata` obtains the video-track duration before searching. Video duration takes precedence over the container duration, which may include a longer audio tail. Sampling, verification, and exclusive ends stay inside the selected range and the actual video track. The source is not repaired or modified during search.

## Result filtering

**Hide similar ranges** is enabled by default. A weaker result is hidden when it shares at least 75% of the shorter clip with an already retained result. Comparison is with retained clips only, preventing a chain of small shifts from suppressing an unrelated later range.

Turning the switch off reveals the cached alternatives immediately. It does not decode the video again. Changing the filter clears batch selection; Select top 5 operates on visible results. Undo and Redo restore the filter without discarding the search results.

The visible result limit is 16 with filtering enabled or 48 with filtering disabled. Verification caches up to 512 decoded frames.

Selecting an individual result runs [automatic method comparison](method-comparison.md). The tier describes the unframed source; method-fit estimates include framing and processed transition checks.
