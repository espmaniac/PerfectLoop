import { gunzipSync } from '../vendor/fflate.js';

const networkMessage = 'The video engine could not be downloaded. Check your connection or VPN, then try again.';
const damagedMessage = 'The downloaded video engine is damaged. Check your connection or VPN and try again.';
const updatedMessage = 'PerfectLoop has been updated. Reload the page to download the new video engine.';
const cancelled = () => new DOMException('Cancelled', 'AbortError');

// Decoded response-body sizes for the pinned assets. Knowing the whole download
// size avoids extra HEAD requests and works when Content-Length is unavailable
// or describes HTTP compression. Tests keep this list in sync with the files.
export const ENGINE_ASSET_BYTES = {
    '../vendor/ffmpeg/const.js': 1016,
    '../vendor/ffmpeg/errors.js': 332,
    '../vendor/ffmpeg/worker.js': 5085,
    '../vendor/ffmpeg/ffmpeg-core.js': 111804,
    '../vendor/ffmpeg/ffmpeg-core.wasm.gz': 10257774,
    '../vendor/ffmpeg-mt/ffmpeg-core.js': 128947,
    '../vendor/ffmpeg-mt/ffmpeg-core.worker.js': 2115,
    '../vendor/ffmpeg-mt/ffmpeg-core.wasm.gz': 10231143,
};

// SHA-256 of each pinned asset. A truncated, corrupted, or substituted file
// (for example a proxy error page) is downloaded again instead of starting.
export const ENGINE_ASSET_SHA256 = {
    '../vendor/ffmpeg/const.js': '9e3bc9dd84781c81daf459e2c46eeec815edac35089832681d9a9a0f383060d0',
    '../vendor/ffmpeg/errors.js': '619310d7ef5fe5fefa0a31927db862b7c291713cfef4d71753fa8aafd18f4db6',
    '../vendor/ffmpeg/worker.js': 'feff0ac937ea225e997e1fae997a74f8b8d572423a526da59eb56624b1f3cde7',
    '../vendor/ffmpeg/ffmpeg-core.js': '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
    '../vendor/ffmpeg/ffmpeg-core.wasm.gz': '5cad620edc871739fd6f2cb6fdde1b9750cbef9abdfee2403b899fca439cb510',
    '../vendor/ffmpeg-mt/ffmpeg-core.js': '270a2e6ff945e173238610669a3f7132df5f9c52698a9bf708cf5c2ab6bda0de',
    '../vendor/ffmpeg-mt/ffmpeg-core.worker.js': 'f77898d631dc010b45c29c23cb4379c611a7d7b131bf591d08a656bb729a4ca3',
    '../vendor/ffmpeg-mt/ffmpeg-core.wasm.gz': '6a556a4096e2248df3c92163cc29013dc074a4de83435f7647b668fb4767e875',
};

function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || cancelled());
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener('abort', abort); resolve(); }
    function abort() { clearTimeout(timer); reject(signal.reason || cancelled()); }
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});
// Resolves when the browser reports a connection. Only an explicit offline
// state waits; a connected but unreachable network is handled by retries.
function online(signal) {
    if (globalThis.navigator?.onLine !== false || typeof globalThis.addEventListener !== 'function') return Promise.resolve();
    return new Promise((resolve, reject) => {
        const done = () => { clean(); resolve(); }, abort = () => { clean(); reject(signal.reason || cancelled()); };
        const clean = () => { globalThis.removeEventListener('online', done); signal?.removeEventListener('abort', abort); };
        globalThis.addEventListener('online', done, { once: true });
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
}
async function sha256(bytes) {
    const digest = await globalThis.crypto?.subtle?.digest('SHA-256', bytes);
    return digest && [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function join(chunks, length) {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

// A stalled response body is just as important as a stalled connection. Keep an
// idle deadline for both, without timing out a slow download that makes progress.
// Interrupted downloads continue from the bytes already received when the server
// honors a Range request. Retries back off and continue while attempts make
// progress; `attempts` limits consecutive attempts that receive nothing new.
export async function downloadEngineAsset(url, { signal, onBytes = () => {}, onWait = () => {}, idleTimeout = 20_000, attempts = 8, retryDelay = 750, maxRetryDelay = 15_000, reload = false, size, hash, decode = bytes => bytes } = {}) {
    let lastError, chunks = [], received = 0, furthest = 0, failures = 0, retry = 0, mismatches = 0;
    const restart = () => { chunks = []; received = 0; };
    while (true) {
        signal?.throwIfAborted();
        if (globalThis.navigator?.onLine === false) { onWait('offline', received, size || 0); await online(signal); }
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason || cancelled());
        let timer, reader;
        const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(() => controller.abort(new Error(networkMessage)), idleTimeout);
        };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            arm();
            const headers = received ? { Range: `bytes=${received}-` } : undefined;
            const response = await abortable(fetch(url, { signal: controller.signal, ...(retry || reload ? { cache: 'reload' } : {}), ...(headers ? { headers } : {}) }), controller.signal);
            const range = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(response.headers.get('content-range') || '');
            if (response.status === 416 && size && received === size) {
                // Everything had arrived before the interruption.
            } else if (!response.ok) {
                throw new Error(`The video engine file is unavailable (HTTP ${response.status}). Try again after checking your connection or VPN.`);
            } else if (response.status !== 206 || Number(range?.[1]) !== received) {
                restart(); // The server sent the whole file.
            }
            const total = size || (response.status === 206 ? Number(range?.[2]) || 0 : Number(response.headers.get('content-length')) || 0);
            if (response.status !== 416) {
                if (response.body) {
                    reader = response.body.getReader();
                    while (true) {
                        arm();
                        const { done, value } = await abortable(reader.read(), controller.signal);
                        if (done) break;
                        chunks.push(value);
                        received += value.length;
                        onBytes(received, total, retry);
                    }
                } else {
                    const bytes = new Uint8Array(await abortable(response.arrayBuffer(), controller.signal));
                    chunks.push(bytes); received += bytes.length;
                }
            }
            onBytes(received, total, retry);
            controller.signal.throwIfAborted();
            const bytes = join(chunks, received);
            arm();
            const actual = hash && await abortable(sha256(bytes), controller.signal);
            if (actual && actual !== hash) {
                restart();
                // A second complete, mismatching download means the site has been updated.
                if (++mismatches >= 2) throw Object.assign(new Error(updatedMessage), { final: true });
                throw new Error(damagedMessage);
            }
            try { return await abortable(Promise.resolve().then(() => decode(bytes)), controller.signal); }
            catch (error) { if (!controller.signal.aborted) restart(); throw error; }
        } catch (error) {
            signal?.throwIfAborted();
            if (error.final) throw error;
            lastError = controller.signal.aborted ? controller.signal.reason : error;
            failures = received > furthest ? 0 : failures + 1;
            furthest = Math.max(furthest, received);
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            // Do not await cancellation: a broken stream must not block retry.
            if (reader) void reader.cancel().catch(() => {});
            controller.abort();
        }
        if (failures >= attempts) break;
        retry++;
        onBytes(received, size || 0, retry);
        onWait('retry', received, size || 0);
        if (retryDelay) await sleep(Math.min(maxRetryDelay, retryDelay * 2 ** Math.max(0, failures - 1)), signal);
    }
    throw new Error(lastError?.message?.includes('HTTP ') || lastError?.message === damagedMessage ? lastError.message : networkMessage, { cause: lastError });
}

// Verified engine files are kept in Cache Storage, keyed by their SHA-256, so a
// later visit starts without the network. Storage can be unavailable or full;
// the engine then simply downloads again.
const STORE = 'perfectloop-engine';
const storeKey = (path, hash) => new URL(`${path}?sha256=${hash}`, import.meta.url).href;
async function openStore() {
    try { return await globalThis.caches?.open(STORE); } catch { return undefined; }
}

export class EngineAssets {
    urls = new Map();
    reload = new Set();
    hashes = ENGINE_ASSET_SHA256;
    downloads = new Map();
    invalidateScripts() {
        for (const [path, url] of this.urls) if (path.endsWith('.js')) {
            URL.revokeObjectURL(url); this.urls.delete(path); this.reload.add(path);
        }
    }
    async stored(path) {
        const hash = this.hashes[path], store = hash && await openStore();
        try {
            const response = await store?.match(storeKey(path, hash));
            if (!response) return undefined;
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (await sha256(bytes) === hash) return bytes;
            await store.delete(storeKey(path, hash));
        } catch { /* Fall back to the network. */ }
        return undefined;
    }
    async isStored(path) {
        const hash = this.hashes[path], store = hash && await openStore();
        try { return Boolean(await store?.match(storeKey(path, hash))); } catch { return false; }
    }
    // Remove files of earlier engine versions.
    async prune() {
        const store = await openStore();
        try {
            const current = new Set(Object.entries(this.hashes).map(([path, hash]) => storeKey(path, hash)));
            for (const request of await store?.keys() || []) if (!current.has(request.url)) await store.delete(request);
        } catch { /* Pruning is best effort. */ }
    }
    // One download per file, shared by every caller (a background preload and an
    // export that needs the engine). It stops only when every caller has cancelled.
    download(path, type, { signal, onBytes, onWait }) {
        let entry = this.downloads.get(path);
        if (!entry) {
            const controller = new AbortController(), subscribers = new Set();
            entry = { subscribers, controller, received: 0 };
            entry.promise = downloadEngineAsset(new URL(path, import.meta.url), {
                signal: controller.signal,
                reload: this.reload.has(path),
                size: ENGINE_ASSET_BYTES[path],
                hash: this.hashes[path],
                onWait: state => { for (const s of subscribers) s.onWait?.(path, state); },
                onBytes: received => { entry.received = received; for (const s of subscribers) s.onBytes?.(path, received); },
                decode: bytes => {
                    if (type === 'text/javascript' && /^\s*</.test(new TextDecoder().decode(bytes)))
                        throw new Error('The connection returned a web page instead of the video engine.');
                    return bytes;
                },
            }).then(async bytes => {
                const hash = this.hashes[path], store = hash && await openStore();
                try { await store?.put(storeKey(path, hash), new Response(bytes)); } catch { /* Quota or private mode. */ }
                return bytes;
            }).finally(() => this.downloads.delete(path));
            this.downloads.set(path, entry);
        }
        const subscriber = { onBytes, onWait };
        entry.subscribers.add(subscriber);
        if (entry.received) onBytes?.(path, entry.received);
        const leave = () => {
            entry.subscribers.delete(subscriber);
            if (!entry.subscribers.size) entry.controller.abort(signal.reason || cancelled());
        };
        signal.addEventListener('abort', leave, { once: true });
        return abortable(entry.promise, signal).finally(() => { signal.removeEventListener('abort', leave); entry.subscribers.delete(subscriber); });
    }
    async asset(path, type, options, transform) {
        if (this.urls.has(path)) return this.urls.get(path);
        const stored = await this.stored(path);
        const bytes = stored || await this.download(path, type, options);
        options.signal.throwIfAborted();
        let value;
        try { value = transform ? await transform(bytes) : bytes; }
        catch (error) {
            // Never keep a stored file that fails to unpack.
            if (stored) { const store = await openStore(); try { await store?.delete(storeKey(path, this.hashes[path])); } catch { /* Ignore. */ } }
            throw error;
        }
        options.signal.throwIfAborted();
        if (this.urls.has(path)) return this.urls.get(path);
        const url = URL.createObjectURL(new Blob([value], { type }));
        this.urls.set(path, url);
        this.reload.delete(path);
        return url;
    }
    async load(threaded, options) {
        const js = 'text/javascript', wrapper = '../vendor/ffmpeg/', core = threaded ? '../vendor/ffmpeg-mt/' : wrapper;
        const paths = [`${wrapper}const.js`, `${wrapper}errors.js`, `${wrapper}worker.js`, `${core}ffmpeg-core.js`,
            ...(threaded ? [`${core}ffmpeg-core.worker.js`] : []), `${core}ffmpeg-core.wasm.gz`];
        const pending = paths.filter(path => !this.urls.has(path));
        if (!this.pruned) { this.pruned = true; void this.prune(); }
        const stored = new Set((await Promise.all(pending.map(async path => await this.isStored(path) && path))).filter(Boolean));
        options.signal.throwIfAborted();
        const downloading = pending.filter(path => !stored.has(path));
        const total = downloading.reduce((sum, path) => sum + ENGINE_ASSET_BYTES[path], 0), received = new Map();
        let waiting;
        const report = (path, bytes) => {
            if (bytes > (received.get(path) || 0)) waiting = undefined; // Data is flowing again.
            received.set(path, Math.min(bytes, ENGINE_ASSET_BYTES[path]));
            const downloaded = [...received.values()].reduce((sum, value) => sum + value, 0);
            const size = n => (n / 1024 ** 2).toFixed(1);
            const action = waiting === 'offline' ? 'Waiting for a connection to continue the video engine download'
                : waiting ? 'Reconnecting to continue the video engine download' : 'Downloading the video engine';
            options.onProgress(total ? downloaded / total : 1, `${action}: ${size(downloaded)} of ${size(total)} MB…`);
        };
        const wait = (path, kind) => { waiting = kind; report(path, received.get(path) || 0); };
        if (downloading.length) report(downloading[0], 0);
        else if (pending.length) options.onProgress(0, 'Loading the video engine from this device…', { progress: null });
        const downloadOptions = { ...options, onBytes: report, onWait: wait };
        const constants = await this.asset(`${wrapper}const.js`, js, downloadOptions);
        const errors = await this.asset(`${wrapper}errors.js`, js, downloadOptions);
        const classWorkerURL = await this.asset(`${wrapper}worker.js`, js, downloadOptions, bytes =>
            new TextDecoder().decode(bytes).replace('from "./const.js"', `from "${constants}"`).replace('from "./errors.js"', `from "${errors}"`));
        const coreURL = await this.asset(`${core}ffmpeg-core.js`, js, downloadOptions);
        const workerURL = threaded ? await this.asset(`${core}ffmpeg-core.worker.js`, js, downloadOptions) : undefined;
        const wasmURL = await this.asset(`${core}ffmpeg-core.wasm.gz`, 'application/wasm', downloadOptions, async bytes => {
            options.onProgress(1, 'Unpacking the video engine…', { progress: null });
            const data = typeof DecompressionStream === 'undefined' ? gunzipSync(bytes)
                : new Uint8Array(await abortable(new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(), options.signal));
            if (![0, 97, 115, 109, 1, 0, 0, 0].every((value, index) => data[index] === value))
                throw new Error('The downloaded video engine is incomplete. Check your connection or VPN and try again.');
            return data;
        });
        return { classWorkerURL, coreURL, wasmURL, ...(workerURL ? { workerURL } : {}) };
    }
}
