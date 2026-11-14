# Browser and processing notes

This reference covers resource limits and browser behavior. For everyday use, see the [quick start](../README.md) or [detailed user guide](./user-guide.md).

Search scores estimate visual similarity; they do not guarantee a smooth transition. Review candidates and the rendered preview before exporting.

Processing speed and available memory depend on the browser and device. Large resolutions, long clips, ping-pong buffers, and motion interpolation take more resources. Short clips at moderate resolutions work best.

Live Photo encoding uses a bundled multithread FFmpeg core. On a supported HTTPS or localhost page, an app-scoped service worker supplies the cross-origin isolation headers it needs. First use can reload the page once, before the editor, sample, or local files load. The worker also keeps an offline copy of the app (page, styles, scripts, icons, and the sample) and of fonts once they are used. Pages and scripts are fetched from the network first; the stored copy is used when the network fails, and the page itself after 5 seconds without a response. Scripts are never mixed from two site versions. Source and exported media are never stored. Browsers that cannot enable isolation can still use the ordinary single-thread editor; Live Photo HEVC export requires the multithread core.

The video engine downloads from this site's own bundled files. During download, the percentage and bar track the total bytes of all files still needed, from 0% to 100%; changing files does not restart the counter. Files already on the device are excluded. Unpacking and startup show an indicator without a percentage, then video processing shows its own progress.

Downloads survive unreliable connections. A request that stops receiving data for 20 seconds is aborted and retried. An interrupted file continues from the bytes already received with an HTTP Range request; if the server sends the whole file instead, the download restarts cleanly. Retries wait 0.75 seconds, doubling up to 15 seconds, and continue as long as attempts make progress; eight consecutive attempts without new data report an error. While the browser is offline, the download shows that it is waiting for a connection and continues when it returns. Each file is checked against its SHA-256; a damaged file is downloaded again in full, and a second mismatch asks to reload the page because the site has been updated. Cancel also aborts downloads and retry waits.

After you open your own video, the engine downloads in the background while the browser is idle, unless the browser asks to save data or the connection is 2G. An export started during this download joins it. Verified engine files are stored on the device (Cache Storage), so later visits start the engine without a network connection. Files of earlier engine versions are removed. Auto find, seam pause, and repair read the frame rate and video-track duration of MP4 and MOV files directly and do not need the engine; other formats use the engine to read them.

Successfully downloaded engine scripts and the unpacked WASM stay in the current tab's memory. Worker restarts between jobs reuse these files without network requests, including the multithread worker. This in-memory copy contains no source media and disappears when the tab closes; the stored copy described above remains on the device. Worker crashes are reported immediately. Startup has a 60-second inactivity limit, and processing stops after two minutes without any log or progress messages; continuing work renews these deadlines.

Source playback depends on browser codec support. If a file cannot play, use **Create proxy**. Exports still read the original file; retained audio is taken from the original source.

When opening a video, the editor checks a small readable prefix before replacing the current project and repairs missing MIME information for known video containers. An empty or unavailable Photos/iCloud selection keeps the previous project and explains how to retry. Frame readers remain attached to the document while waiting for decoded frames, then are removed after reading or cancellation. These measures improve Safari loading; a Photo Library file may still differ from the file selected through Files because iOS can supply a converted or temporary representation.

## Licenses

Application source: **GPL-3.0-or-later**. Bundled dependencies retain their own licenses. See [LICENSE](../LICENSE) and [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt).

## Background work

Analyses run in the background and never block editing: Auto find, method comparison, seam inspection, pause detection, repair analysis, automatic repair, and Result updates. Starting another analysis, a Result update, or an export stops the running one and says so. Exports, batch exports, proxies, and imports run in the foreground; editing is disabled until they finish or are cancelled. Cancel stops whichever is running.
