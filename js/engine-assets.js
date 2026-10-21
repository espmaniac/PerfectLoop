import { gunzipSync } from '../vendor/fflate.js';

const networkMessage = 'The video engine could not be downloaded. Check your connection or VPN, then try again.';
const cancelled = () => new DOMException('Cancelled', 'AbortError');

function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || cancelled());
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

// A stalled response body is just as important as a stalled connection. Keep an
// idle deadline for both, without timing out a slow download that makes progress.
export async function downloadEngineAsset(url, { signal, onBytes = () => {}, idleTimeout = 20_000, attempts = 3, retryDelay = 750, reload = false, decode = bytes => bytes } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        signal?.throwIfAborted();
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
            const response = await abortable(fetch(url, { signal: controller.signal, ...(attempt || reload ? { cache: 'reload' } : {}) }), controller.signal);
            if (!response.ok) throw new Error(`The video engine file is unavailable (HTTP ${response.status}). Try again after checking your connection or VPN.`);
            const total = Number(response.headers.get('content-length')) || 0;
            const chunks = [];
            let received = 0;
            if (response.body) {
                reader = response.body.getReader();
                while (true) {
                    arm();
                    const { done, value } = await abortable(reader.read(), controller.signal);
                    if (done) break;
                    chunks.push(value);
                    received += value.length;
                    onBytes(received, total, attempt);
                }
            } else {
                const bytes = new Uint8Array(await abortable(response.arrayBuffer(), controller.signal));
                chunks.push(bytes); received = bytes.length;
            }
            controller.signal.throwIfAborted();
            const bytes = new Uint8Array(received);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            arm();
            return await abortable(Promise.resolve().then(() => decode(bytes)), controller.signal);
        } catch (error) {
            signal?.throwIfAborted();
            lastError = controller.signal.aborted ? controller.signal.reason : error;
            if (attempt + 1 < attempts) onBytes(0, 0, attempt + 1);
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            // Do not await cancellation: a broken stream must not block retry.
            if (reader) void reader.cancel().catch(() => {});
            controller.abort();
        }
        if (attempt + 1 < attempts && retryDelay) {
            let delay;
            const delaySignal = signal || new AbortController().signal;
            try { await abortable(new Promise(resolve => { delay = setTimeout(resolve, retryDelay * (attempt + 1)); }), delaySignal); }
            finally { clearTimeout(delay); }
        }
    }
    throw new Error(lastError?.message?.includes('HTTP ') ? lastError.message : networkMessage, { cause: lastError });
}

export class EngineAssets {
    urls = new Map();
    reload = new Set();
    invalidateScripts() {
        for (const [path, url] of this.urls) if (path.endsWith('.js')) {
            URL.revokeObjectURL(url); this.urls.delete(path); this.reload.add(path);
        }
    }
    async asset(path, type, { signal, onProgress }, transform) {
        if (this.urls.has(path)) return this.urls.get(path);
        const bytes = await downloadEngineAsset(new URL(path, import.meta.url), {
            signal,
            reload: this.reload.has(path),
            decode: bytes => {
                if (type === 'text/javascript' && /^\s*</.test(new TextDecoder().decode(bytes)))
                    throw new Error('The connection returned a web page instead of the video engine.');
                return transform ? transform(bytes) : bytes;
            },
            onBytes: (received, total, attempt) => {
                const size = n => (n / 1024 ** 2).toFixed(1);
                const detail = received ? `${size(received)}${total ? ` of ${size(total)}` : ''} MB` : 'connecting';
                onProgress(0.03 * (total ? Math.min(1, received / total) : 0),
                    `${attempt ? `Reconnecting to download the video engine (${attempt + 1}/3)` : 'Downloading the video engine'}: ${detail}…`);
            },
        });
        signal.throwIfAborted();
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        this.urls.set(path, url);
        this.reload.delete(path);
        return url;
    }
    async load(threaded, options) {
        const js = 'text/javascript', wrapper = '../vendor/ffmpeg/', core = threaded ? '../vendor/ffmpeg-mt/' : wrapper;
        const constants = await this.asset(`${wrapper}const.js`, js, options);
        const errors = await this.asset(`${wrapper}errors.js`, js, options);
        const classWorkerURL = await this.asset(`${wrapper}worker.js`, js, options, bytes =>
            new TextDecoder().decode(bytes).replace('from "./const.js"', `from "${constants}"`).replace('from "./errors.js"', `from "${errors}"`));
        const coreURL = await this.asset(`${core}ffmpeg-core.js`, js, options);
        const workerURL = threaded ? await this.asset(`${core}ffmpeg-core.worker.js`, js, options) : undefined;
        const wasmURL = await this.asset(`${core}ffmpeg-core.wasm.gz`, 'application/wasm', options, async bytes => {
            options.onProgress(0.03, 'Unpacking the video engine…');
            const data = typeof DecompressionStream === 'undefined' ? gunzipSync(bytes)
                : new Uint8Array(await abortable(new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(), options.signal));
            if (![0, 97, 115, 109, 1, 0, 0, 0].every((value, index) => data[index] === value))
                throw new Error('The downloaded video engine is incomplete. Check your connection or VPN and try again.');
            return data;
        });
        return { classWorkerURL, coreURL, wasmURL, ...(workerURL ? { workerURL } : {}) };
    }
}
