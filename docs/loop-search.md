# Loop search

Loops of any length from one second (`SHORTEST_LOOP`) up to the whole search range are considered. Shorter clips are mostly seams. With **Avoid scene cuts**, a loop cannot be longer than its scene.

Search has two stages.

**Sampling.** Descriptors (32 × 32 RGB) are taken about ten times per second: every `round(fps / 10)` source frames, up to 1,601 samples for long ranges. A true repeat therefore lands within one or two frames of a sample. The analysis worker ranks sampled pairs by image structure and forward motion. It returns the strongest match of every stretch of the source first (each stretch at least as long as the shortest match), then the remaining strongest matches, so a long video is covered throughout rather than around its few strongest moments. The complete range is also returned when it fits the length limits and scene-cut policy.

**Frame-level verification.** Shortlisted candidates are verified — one for every 2 seconds of search range, between 32 and 240 — with real frames at up to 160 pixels on the longest side. The shortlist is chosen the same way, so different moments of the video are checked before near-duplicates of the strongest match. Every start and exclusive end within half a sampling step of the sampled boundaries is tested. For each end, the seam is measured directly: the first frame of the loop is compared with the source frame after the end, and the last frame with the source frame before the start. In a seamless loop these are the same images.

The comparison uses 12-pixel tiles. Each tile's difference is reduced by its noise level and divided by the tile's normal frame-to-frame change, so the error is measured in frame steps of local motion. Noise is the larger of the quietest tiles' change (even grain) and the tile's own noise, estimated from the fact that motion accumulates over two frames while noise does not. The six worst tiles are averaged, so a small moving object is not hidden by a static background.

| Seam error | Tier | Typical cause |
| --- | --- | --- |
| ≤ 0.15 | Perfect | Exact repeat, including grain and compression noise |
| ≤ 0.35 | Good | Slight drift or a sub-frame phase difference |
| ≤ 1 | Fair | A repeated or skipped frame (about 0.4–0.9) |
| > 1 | Rough | A visible jump; no repeat |

When neither neighboring frame is inside the selection (the loop is the complete range), only a jump beyond the usual motion can be measured, and the loop is listed as Good at most.

Every loop found is listed, including repeats of the same motion and overlapping ranges; loops refined to the same range appear once. Rough loops are hidden only when the source has a perfect or good loop, so a search never comes back empty. A scene cut is a sampled step where the whole frame changes, or where one of sixteen regions changes abruptly — far more than in the neighboring steps — such as an edit that keeps the composition but replaces a face. Cleaner tiers are listed first. Within a tier, **Prefer visible motion** lowers nearly static clips and scene cuts lower the ranking. Neither changes the tier.

`sourceMetadata` obtains the video-track duration before searching. Video duration takes precedence over the container duration, which may include a longer audio tail. Sampling, verification, and exclusive ends stay inside the selected range and the actual video track. The source is not repaired or modified during search.

## Result list

The result list has no fixed length. Verification caches up to 512 decoded frames.

Selecting a result sets the loop range with Natural cut and plays it on repeat at once, without encoding. **Compare & choose method** runs the [method comparison](method-comparison.md) on request; it renders every method, so it takes longer. The tier describes the unframed source; method-fit estimates include framing and processed transition checks.
