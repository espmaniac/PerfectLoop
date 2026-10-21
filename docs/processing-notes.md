# Browser and processing notes

This reference covers resource limits and browser behavior. For everyday use, see the [quick start](../README.md) or [detailed user guide](./user-guide.md).

Search scores estimate visual similarity; they do not guarantee a smooth transition. Review candidates and the rendered preview before exporting.

Processing speed and available memory depend on the browser and device. Large resolutions, long clips, ping-pong buffers, and motion interpolation take more resources. Short clips at moderate resolutions work best.

Live Photo encoding uses a bundled multithread FFmpeg core. On a supported HTTPS or localhost page, an app-scoped service worker supplies the cross-origin isolation headers it needs. First use can reload the page once, before the editor, sample, or local files load. The worker fetches network responses without caching media or creating an offline copy. Browsers that cannot enable isolation can still use the ordinary single-thread editor; Live Photo HEVC export requires the multithread core.

The video engine downloads from this site's own bundled files, with byte progress. A request that stops receiving data for 20 seconds is aborted and retried, with at most three attempts per file. Cancel also aborts downloads and retry waits. If a connection or VPN change prevents loading, the editor reports an error and the same action can be retried without reloading the page.

Successfully downloaded engine scripts and the unpacked WASM stay in the current tab's memory. Worker restarts between jobs reuse these files without network requests, including the multithread worker. This cache contains no source media and disappears when the tab closes; opening or reloading the site still needs a connection. Worker crashes are reported immediately. Startup has a 60-second inactivity limit, and processing stops after two minutes without any log or progress messages; continuing work renews these deadlines.

Source playback depends on browser codec support. If a file cannot play, use **Create proxy**. Exports still read the original file; retained audio is taken from the original source.

When opening a video, the editor checks a small readable prefix before replacing the current project and repairs missing MIME information for known video containers. An empty or unavailable Photos/iCloud selection keeps the previous project and explains how to retry. Frame readers remain attached to the document while waiting for decoded frames, then are removed after reading or cancellation. These measures improve Safari loading; a Photo Library file may still differ from the file selected through Files because iOS can supply a converted or temporary representation.

## Licenses

Application source: **GPL-3.0-or-later**. Bundled dependencies retain their own licenses. See [LICENSE](../LICENSE) and [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt).
