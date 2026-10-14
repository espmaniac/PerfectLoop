# Loop search

Search uses coarse descriptors to discover repeating phases throughout the selected source range, then refines the strongest candidates at source-frame precision. The complete frame-aligned range is also retained when its length meets the requested bounds and scene-cut policy.

Before ranking results, each shortlisted candidate is checked using its actual first and last adjacent video frames at up to 160 pixels on the longest side. The local tile checks from `auto-repair-core.js` measure boundary discontinuity and motion changes so a largely static scene cannot hide a small moving defect. The displayed fit is capped by this local boundary check (`100 * exp(-boundaryError / 25)`); it is a heuristic estimate, not a quality percentage or guarantee. The source is not repaired or modified during search.

`sourceMetadata` obtains the video-track duration before searching. Video duration takes precedence over the container duration, which may include a longer audio tail. Sampling and exclusive ends stay inside the selected range and the actual video track.

## Result filtering

**Hide similar ranges** is enabled by default. Results are sorted by verified fit, then a weaker result is hidden when it shares at least 75% of the shorter clip with an already retained result. Comparison is with retained clips only, preventing a chain of small shifts from suppressing an unrelated later range.

Turning the switch off reveals the cached alternatives immediately. It does not decode the video again. Changing the filter clears batch selection; Select top 5 operates on visible results. Undo and Redo restore the filter without discarding the search results.

Search uses a bounded coarse shortlist of up to 48 alternatives plus the complete range. Near-identical timestamp variations are consolidated, and the visible result limit is 16 with filtering enabled or 48 with filtering disabled. This is a candidate search, not an exhaustive list of every possible frame pair. Boundary-frame caching is capped at 256 decoded descriptors.

Selecting an individual result runs [automatic method comparison](method-comparison.md). The source-fit estimate in the search list describes the unframed source; method-fit estimates include framing and processed transition checks.
