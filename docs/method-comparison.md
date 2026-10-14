# Automatic loop method selection

Selecting an Auto find candidate compares all six loop methods and applies a recommendation. The user can change methods afterward. This is a visual comparison of framed video before layers, repairs, and audio processing. Source fit in the search results describes the unframed source seam; method fit describes the processed comparison, so the values are not interchangeable.

## Measurement

The engine creates reduced-resolution MP4 comparisons at the configured output frame rate and overlap, preserving aspect ratio, framing, speed, and interpolation. Comparison frames use high-quality encoding to avoid hiding small details behind preview compression. Natural cut provides the reference. Source files and user layers remain local and are not modified.

Each method is evaluated at its actual file boundary and at internal cycle positions. Dissolves also check their internal join and blend midpoint, Ping-pong checks its turning point, and Fade checks its dark endpoints. Moving a transition inside the file does not exempt it from comparison.

Fit balances local image and frame-change discontinuities against blend mismatch, edge-detail loss, reduced frame activity near the seam, and the effect's changes to original playback. Reverse methods incur a 12-point effect cost, Fade incurs 8, and forward dissolves incur 2. Additional artifact costs use sampled measurements. These constants are heuristic preferences, not a learned model or a probability of a good loop.

All methods, including reverse and fade effects, may be selected. Unavailable methods show the current output constraint or processing failure. Validation uses full output dimensions and duration, so a reduced-resolution test cannot bypass Spotify Canvas, layer validation, or video-patch memory restrictions. Layer edits keep the cached visual comparison unless they change method eligibility.

When Natural cut has a seam fit of at least 90 and the highest fit differs from it by at most four points, Natural cut is preferred to avoid changing original motion for a small uncertain gain. The comparison explains this choice. With a larger gain, the highest available fit wins.

## Interaction and limits

- Method buttons display estimated fit; the expandable comparison shows duration, seam fit, edge detail, relative frame activity, and blend mismatch.
- Changing source framing, duration, frame rate, overlap, or output requirements hides stale estimates until the user compares again. Manual method selection remains available.
- Comparisons are cached for six configurations per source file. Repeated candidate selection reuses them; changing files clears the cache.
- Selecting a candidate and applying its automatic method is one undoable edit. A cancelled comparison leaves the selected range available for manual editing.
- Comparison renders run serially in the existing engine, with progress and cancellation. The sampled-frame cache is bounded to 96 frames per reader; readers and temporary URLs are released.

This analysis adds processing time when selecting a new candidate. Small details can escape reduced-resolution checks, and frame activity is pixel change rather than object tracking. Inspect the finished preview before export. Batch export continues to use its explicitly labeled natural-loop workflow.

Boundary scoring compares the temporal change on each side independently, preventing opposite changes from cancelling. Excess acceleration is measured relative to adjacent source acceleration to discount normal frame cadence. Recommendations below 85 fit explicitly warn that visible motion changes may remain. Scores remain heuristics, not a guarantee of perceptual smoothness.

Candidate checkboxes are labeled Batch and only select exports. Use this loop applies the displayed source range to the editor and compares methods. A dissolve can shorten the output by its overlap; method comparison reports the resulting duration.
