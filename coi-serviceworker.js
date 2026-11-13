const scopeURL = new URL(self.registration.scope);
// The app shell is kept for offline use and unreliable connections. The video
// engine core has its own verified store, and fonts are kept once they are used.
const CACHE = 'perfectloop-app';
const PRECACHE = [
    './', 'index.html', 'style.css', 'sample.mp4', 'site.webmanifest', 'favicon.svg', 'favicon.ico',
    'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'vendor/fflate.js',
    'vendor/ffmpeg/index.js', 'vendor/ffmpeg/classes.js', 'vendor/ffmpeg/types.js',
    'vendor/ffmpeg/const.js', 'vendor/ffmpeg/utils.js', 'vendor/ffmpeg/errors.js',
    'js/alignment.js', 'js/app.js', 'js/aspect.js', 'js/auto-repair-core.js',
    'js/auto-repair-dialog.js', 'js/auto-repair.js', 'js/background-patch.js',
    'js/background-repair.js', 'js/color.js', 'js/constants.js', 'js/container-metadata.js',
    'js/engine-assets.js', 'js/engine.js', 'js/fonts.js', 'js/framing.js', 'js/icons.js',
    'js/layer-export.js', 'js/layer-order.js', 'js/layer-panel.js', 'js/layer-timeline.js',
    'js/layer-timing.js', 'js/layers.js', 'js/live-photo-motion.js', 'js/live-photo.js',
    'js/logic.js', 'js/media.js', 'js/method-comparison.js', 'js/method-fit.js',
    'js/patch-editor.js', 'js/patch.js', 'js/preview-editor.js', 'js/preview-playback.js',
    'js/preview-viewport.js', 'js/preview.js', 'js/ranking.js', 'js/repair-analysis.js',
    'js/repair.js', 'js/seam-pause-analysis.js', 'js/seam-pause.js', 'js/search.worker.js',
    'js/source-file.js', 'js/source-metadata.js', 'js/start.js', 'js/text-fill-editor.js',
    'js/text-fill.js', 'js/timeline.js', 'js/ui.js', 'js/video-patch-capture.js',
    'js/video-patch.js', 'js/wallpaper-export.js', 'js/wallpaper-preview.js',
    'js/wallpaper-still.js', 'js/wallpaper.js',
];
// After this long without a response, the stored page opens while the network
// request continues in the background. Other files use a stored copy only when
// the network fails, so modules of two site versions are never mixed.
const PAGE_TIMEOUT = 5000;

function isolate(response) {
    if (response.type === 'opaque' || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        // A flaky connection must not prevent installation; missing files are
        // stored the next time they load.
        try {
            const cache = await caches.open(CACHE);
            await Promise.allSettled(PRECACHE.map(async path => {
                const url = new URL(path, scopeURL), response = await fetch(url, { cache: 'no-cache' });
                if (response.ok) await cache.put(url, isolate(response));
            }));
        } catch { /* Storage may be unavailable. */ }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

async function networkFirst(event) {
    const { request } = event, cache = await caches.open(CACHE).catch(() => undefined);
    const network = fetch(request).then(async response => {
        const isolated = isolate(response);
        if (cache && response.ok && response.type === 'basic') await cache.put(request, isolated.clone()).catch(() => {});
        return isolated;
    });
    let timer;
    const timeout = new Promise(resolve => { if (request.mode === 'navigate') timer = setTimeout(resolve, PAGE_TIMEOUT); });
    try {
        const response = await Promise.race([network, timeout]);
        if (response) return response;
    } catch { /* Offline or the connection dropped. */ }
    finally { clearTimeout(timer); }
    const stored = await cache?.match(request, { ignoreSearch: true })
        || (request.mode === 'navigate' ? await cache?.match(scopeURL.href) : undefined);
    if (!stored) return network;
    event.waitUntil(network.catch(() => {}));
    return stored;
}

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== scopeURL.origin || !url.pathname.startsWith(scopeURL.pathname)) return;
    // Work around unsupported cache-only requests without changing their mode.
    if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
    const relative = url.pathname.slice(scopeURL.pathname.length);
    if (event.request.method !== 'GET' || event.request.headers.has('range') || relative.includes('ffmpeg-core')) {
        event.respondWith(fetch(event.request).then(isolate));
        return;
    }
    event.respondWith(networkFirst(event));
});
