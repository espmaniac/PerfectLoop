import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EngineAssets, downloadEngineAsset, ENGINE_ASSET_BYTES, ENGINE_ASSET_SHA256 } from '../js/engine-assets.js';

test('Download size and checksum metadata match every bundled runtime asset', async () => {
    assert.deepEqual(Object.keys(ENGINE_ASSET_SHA256), Object.keys(ENGINE_ASSET_BYTES));
    for (const [path, bytes] of Object.entries(ENGINE_ASSET_BYTES)) {
        const file = new URL(path, new URL('../js/', import.meta.url));
        assert.equal((await stat(file)).size, bytes, path);
        assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), ENGINE_ASSET_SHA256[path], path);
    }
});

test('A disconnected download retries with a fresh request and reports bytes received', async t => {
    const requests = [], progress = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push(options);
        if (requests.length === 1) throw new TypeError('Failed to fetch');
        return new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close();
        } }), { headers: { 'content-length': '3' } });
    });
    const bytes = await downloadEngineAsset('engine.gz', { retryDelay: 0, onBytes: (...args) => progress.push(args) });
    assert.deepEqual([...bytes], [1, 2, 3]);
    assert.equal(requests.length, 2); assert.equal(requests[1].cache, 'reload');
    assert(progress.some(([received, total]) => received === 3 && total === 3));
    assert(requests.every(request => request.signal.aborted), 'Finished requests release their fetch resources');
});

for (const stage of ['connection', 'body']) test(`A stalled ${stage} has a bounded timeout and leaves no retry pinned`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const signals = [];
    t.mock.method(globalThis, 'fetch', (_, { signal }) => {
        signals.push(signal);
        return stage === 'connection' ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new Uint8Array([1]));
        } })));
    });
    const pending = assert.rejects(downloadEngineAsset('engine.gz', { idleTimeout: 100, retryDelay: 0, attempts: 3 }), /connection or VPN/);
    for (let attempt = 0; attempt < 4; attempt++) { await flush(); t.mock.timers.tick(100); }
    await pending;
    // A body that delivered its first byte made progress, so it gets one more attempt.
    assert.equal(signals.length, stage === 'connection' ? 3 : 4); assert(signals.every(signal => signal.aborted));
});

test('Continuing download progress renews the idle deadline', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let stream;
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { stream = controller; } })));
    const pending = downloadEngineAsset('engine.gz', { idleTimeout: 100, attempts: 1 });
    await flush();
    for (let frame = 0; frame < 4; frame++) {
        t.mock.timers.tick(90); stream.enqueue(new Uint8Array([frame])); await flush();
    }
    stream.close(); assert.deepEqual([...(await pending)], [0, 1, 2, 3]);
});

for (const stage of ['connection', 'body', 'retry']) test(`Cancel stops the ${stage} immediately without another attempt`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new AbortController();
    let requests = 0, requestSignal;
    t.mock.method(globalThis, 'fetch', (_, { signal }) => {
        requests++; requestSignal = signal;
        if (stage === 'retry') return Promise.reject(new TypeError('Network changed'));
        return stage === 'connection' ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream()));
    });
    const pending = assert.rejects(downloadEngineAsset('engine.gz', { signal: controller.signal }), { name: 'AbortError' });
    await flush(); controller.abort(); await pending;
    t.mock.timers.tick(60_000); await flush();
    assert.equal(requests, 1); assert(requestSignal.aborted);
});

test('Incomplete assets are retried and never become a successful cached download', async t => {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([++requests])));
    const value = await downloadEngineAsset('engine.gz', { retryDelay: 0, attempts: 3, decode: bytes => {
        if (bytes[0] < 3) throw new Error('Incomplete gzip');
        return bytes;
    } });
    assert.equal(value[0], 3); assert.equal(requests, 3);
});

test('All runtime dependencies use tab-local URLs, survive worker resets, and separate the two cores', async t => {
    const requests = [], blobs = new Map(), revoked = [];
    const header = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    t.mock.method(URL, 'createObjectURL', blob => { const url = `blob:test-${blobs.size}`; blobs.set(url, blob); return url; });
    t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url: url.href, options });
        if (url.pathname.endsWith('.gz')) return new Response(gzipSync(header));
        const source = url.pathname.endsWith('/worker.js') ? 'import { x } from "./const.js"; import { y } from "./errors.js";' : 'export const x = 1;';
        return new Response(source);
    });
    const assets = new EngineAssets(), options = { signal: new AbortController().signal, onProgress: () => {} };
    assets.hashes = {}; // Fixture files stand in for the real engine.
    const single = await assets.load(false, options);
    assert.equal(requests.length, 5);
    assert(Object.values(single).every(url => blobs.has(url)));
    const wrapper = await blobs.get(single.classWorkerURL).text();
    assert(!wrapper.includes('./const.js')); assert(!wrapper.includes('./errors.js')); assert(wrapper.includes('blob:test-'));
    assert.deepEqual(new Uint8Array(await blobs.get(single.wasmURL).arrayBuffer()), header);
    assert.deepEqual(await assets.load(false, options), single); assert.equal(requests.length, 5);
    const multi = await assets.load(true, options);
    assert.equal(requests.length, 8); assert.equal(single.classWorkerURL, multi.classWorkerURL);
    assert.notEqual(single.wasmURL, multi.wasmURL); assert(multi.workerURL);
    assets.invalidateScripts();
    assert(revoked.length === 6); assert(!revoked.includes(single.wasmURL));
    const retried = await assets.load(false, options);
    assert.notEqual(retried.classWorkerURL, single.classWorkerURL); assert.equal(retried.wasmURL, single.wasmURL);
    assert(requests.slice(8).every(request => request.options.cache === 'reload'));
});

for (const threaded of [false, true]) test(`${threaded ? 'Multithread' : 'Single-thread'} download progress counts all bytes across files, including missing Content-Length`, async t => {
    const progress = [], requested = [];
    t.mock.method(globalThis, 'fetch', async url => {
        const bytes = await readFile(url); requested.push(url);
        let offset = 0;
        return new Response(new ReadableStream({ pull(controller) {
            if (offset === bytes.length) { controller.close(); return; }
            const end = Math.min(bytes.length, offset + 1024 ** 2);
            controller.enqueue(bytes.subarray(offset, end)); offset = end;
        } }));
    });
    const assets = new EngineAssets(), options = { signal: new AbortController().signal,
        onProgress: (fraction, message, display) => progress.push({ fraction, message, display }) };
    await assets.load(threaded, options);
    const total = requested.reduce((sum, url) => sum + ENGINE_ASSET_BYTES[`../vendor/${url.pathname.split('/vendor/')[1]}`], 0);
    const downloading = progress.filter(item => item.message.startsWith('Downloading'));
    assert.equal(downloading[0].fraction, 0); assert.equal(downloading.at(-1).fraction, 1);
    assert(downloading.every((item, index) => !index || item.fraction >= downloading[index - 1].fraction), 'Changing files does not reset the overall download');
    let loaded = 0;
    for (const url of requested) {
        loaded += ENGINE_ASSET_BYTES[`../vendor/${url.pathname.split('/vendor/')[1]}`];
        assert(downloading.some(item => Math.abs(item.fraction - loaded / total) < 1e-9), `Missing accumulated byte progress for ${url.pathname}`);
    }
    assert(progress.some(item => item.fraction > .4 && item.fraction < .6), 'The large WASM download advances through intermediate percentages');
    assert(progress.some(item => item.message.startsWith('Unpacking') && item.display?.progress === null));
    const requestCount = requested.length;
    progress.length = 0; await assets.load(threaded, options);
    assert.equal(requested.length, requestCount); assert.deepEqual(progress, [], 'Cached assets do not pretend to download again');
});

for (const honorsRange of [true, false]) test(`An interrupted engine download ${honorsRange ? 'continues from the received bytes' : 'restarts cleanly when the server ignores Range'}`, async t => {
    const progress = [], controller = new AbortController(), assets = new EngineAssets(), wasmRequests = [];
    let served = 0;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        const bytes = await readFile(url);
        if (!url.pathname.endsWith('.gz')) return new Response(bytes);
        const range = options.headers?.Range;
        wasmRequests.push(range);
        if (wasmRequests.length === 1) return new Response(new ReadableStream({ start(stream) {
            stream.enqueue(bytes.subarray(0, Math.floor(bytes.length / 2))); served += Math.floor(bytes.length / 2);
            setTimeout(() => stream.error(new TypeError('Connection changed')), 0);
        } }));
        if (range && honorsRange) {
            const from = Number(/bytes=(\d+)-/.exec(range)[1]);
            served += bytes.length - from;
            return new Response(bytes.subarray(from), { status: 206, headers: { 'content-range': `bytes ${from}-${bytes.length - 1}/${bytes.length}` } });
        }
        served += bytes.length;
        return new Response(bytes);
    });
    const options = { signal: controller.signal, onProgress: (fraction, message) => progress.push({ fraction, message }) };
    await assets.load(false, options);
    const wasm = ENGINE_ASSET_BYTES['../vendor/ffmpeg/ffmpeg-core.wasm.gz'];
    const scripts = Object.entries(ENGINE_ASSET_BYTES).filter(([path]) => path.startsWith('../vendor/ffmpeg/') && path.endsWith('.js')).reduce((sum, [, bytes]) => sum + bytes, 0);
    assert.deepEqual(wasmRequests, [undefined, `bytes=${Math.floor(wasm / 2)}-`]);
    const reconnect = progress.find(item => item.message.startsWith('Reconnecting'));
    assert(reconnect); assert.equal(reconnect.fraction, (scripts + Math.floor(wasm / 2)) / (scripts + wasm), 'Received bytes are kept while reconnecting');
    assert(progress.every(item => item.fraction >= 0 && item.fraction <= 1));
    assert.equal(served, honorsRange ? wasm : wasm + Math.floor(wasm / 2));
    assets.invalidateScripts(); progress.length = 0;
    await assets.load(false, options);
    assert.equal(wasmRequests.length, 2, 'The successfully cached WASM is excluded from another download');
    const downloading = progress.filter(item => item.message.startsWith('Downloading'));
    assert.equal(downloading[0].fraction, 0); assert.equal(downloading.at(-1).fraction, 1);
    assert(downloading.some(item => item.fraction === ENGINE_ASSET_BYTES['../vendor/ffmpeg/const.js'] / scripts));
});

test('A damaged download is fetched again in full, and a changed engine asks for a reload', async t => {
    const good = new Uint8Array([1, 2, 3, 4]), hash = createHash('sha256').update(good).digest('hex'), requests = [];
    let responses = [new Uint8Array([1, 2, 9, 4]), good];
    t.mock.method(globalThis, 'fetch', async (_, options) => { requests.push(options.headers?.Range); return new Response(responses.shift()); });
    assert.deepEqual([...await downloadEngineAsset('engine.gz', { retryDelay: 0, size: 4, hash })], [1, 2, 3, 4]);
    assert.deepEqual(requests, [undefined, undefined], 'Damaged bytes are not reused for a Range request');
    responses = [new Uint8Array([5, 5, 5, 5]), new Uint8Array([5, 5, 5, 5]), good];
    await assert.rejects(downloadEngineAsset('engine.gz', { retryDelay: 0, size: 4, hash }), /Reload the page/);
});

test('While the browser is offline the download waits and continues when the connection returns', async t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), target = new EventTarget(), waits = [];
    let onLine = false;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return onLine; } } });
    globalThis.addEventListener = (...args) => target.addEventListener(...args);
    globalThis.removeEventListener = (...args) => target.removeEventListener(...args);
    t.after(() => {
        previous ? Object.defineProperty(globalThis, 'navigator', previous) : delete globalThis.navigator;
        delete globalThis.addEventListener; delete globalThis.removeEventListener;
    });
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(new Uint8Array([7])); });
    const pending = downloadEngineAsset('engine.gz', { onWait: state => waits.push(state) });
    await flush(); await flush();
    assert.equal(requests, 0); assert.deepEqual(waits, ['offline']);
    onLine = true; target.dispatchEvent(new Event('online'));
    assert.deepEqual([...await pending], [7]); assert.equal(requests, 1);
});

test('Retries back off and keep going while each attempt gets further', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const delays = [];
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        let sent = false;
        if (requests <= 12) return new Response(new ReadableStream({ pull(stream) {
            if (sent) stream.error(new TypeError('Dropped'));
            else { stream.enqueue(new Uint8Array([requests])); sent = true; }
        } }), requests > 1 ? { status: 206, headers: { 'content-range': `bytes ${requests - 1}-12/13` } } : {});
        return new Response(new Uint8Array([13]), { status: 206, headers: { 'content-range': 'bytes 12-12/13' } });
    });
    const pending = downloadEngineAsset('engine.gz', { attempts: 2, retryDelay: 100, size: 13, onWait: state => state === 'retry' && delays.push(requests) });
    for (let i = 0; i < 40; i++) { await flush(); t.mock.timers.tick(100); }
    assert.deepEqual([...await pending], Array.from({ length: 13 }, (_, i) => i + 1), 'Twelve interruptions with progress never exhaust two failures');
    assert.equal(delays.length, 12);
});

function memoryCaches() {
    const entries = new Map();
    const cache = {
        async match(key) { const bytes = entries.get(typeof key === 'string' ? key : key.url); return bytes && new Response(bytes); },
        async put(key, response) { entries.set(key, new Uint8Array(await response.arrayBuffer())); },
        async delete(key) { return entries.delete(typeof key === 'string' ? key : key.url); },
        async keys() { return [...entries.keys()].map(url => ({ url })); },
    };
    return { entries, caches: { open: async () => cache } };
}
const realFiles = t => {
    const requested = [];
    t.mock.method(globalThis, 'fetch', async url => { requested.push(url.pathname); return new Response(await readFile(url)); });
    return requested;
};

test('A verified engine is stored on the device and the next visit starts without the network', async t => {
    const { entries, caches } = memoryCaches();
    globalThis.caches = caches; t.after(() => delete globalThis.caches);
    entries.set(new URL('../vendor/ffmpeg/const.js?sha256=old', new URL('../js/', import.meta.url)).href, new Uint8Array([1]));
    const requested = realFiles(t), options = () => ({ signal: new AbortController().signal, onProgress: (fraction, message) => messages.push(message) });
    let messages = [];
    await new EngineAssets().load(false, options());
    assert.equal(requested.length, 5);
    await flush(); await flush();
    assert(![...entries.keys()].some(key => key.endsWith('sha256=old')), 'Files of an earlier engine version are removed');
    messages = [];
    const urls = await new EngineAssets().load(false, options());
    assert.equal(requested.length, 5, 'Nothing is downloaded again');
    assert(urls.wasmURL);
    assert(messages[0].startsWith('Loading the video engine from this device'));
    assert(!messages.some(message => message.startsWith('Downloading')));
});

test('A damaged stored file is discarded and downloaded again', async t => {
    const { entries, caches } = memoryCaches();
    globalThis.caches = caches; t.after(() => delete globalThis.caches);
    const requested = realFiles(t);
    await new EngineAssets().load(false, { signal: new AbortController().signal, onProgress: () => {} });
    const key = [...entries.keys()].find(url => url.includes('ffmpeg-core.wasm.gz'));
    entries.get(key)[100] ^= 255;
    await new EngineAssets().load(false, { signal: new AbortController().signal, onProgress: () => {} });
    assert.deepEqual(requested.slice(5), ['/vendor/ffmpeg/ffmpeg-core.wasm.gz'].map(path => new URL(`..${path}`, new URL('../js/', import.meta.url)).pathname));
});

test('A background preload and an export share one download, and one cancelling does not stop the other', async t => {
    const requested = realFiles(t), assets = new EngineAssets();
    const background = new AbortController(), user = new AbortController();
    const preload = assets.load(false, { signal: background.signal, onProgress: () => {} });
    const cancelled = assets.load(false, { signal: new AbortController().signal, onProgress: () => {} });
    const needed = assets.load(false, { signal: user.signal, onProgress: () => {} });
    const [a, b] = await Promise.all([preload, needed, cancelled]);
    assert.equal(requested.length, 5, 'Each file is requested once');
    assert.equal(a.wasmURL, b.wasmURL);
});

test('A download stops when every caller cancels', async t => {
    let requestSignal;
    t.mock.method(globalThis, 'fetch', (_, { signal }) => { requestSignal = signal; return new Promise(() => {}); });
    const assets = new EngineAssets(), first = new AbortController(), second = new AbortController();
    const options = signal => ({ signal, onBytes: () => {}, onWait: () => {} });
    const a = assert.rejects(assets.download('../vendor/ffmpeg/const.js', 'text/javascript', options(first.signal)), { name: 'AbortError' });
    const b = assert.rejects(assets.download('../vendor/ffmpeg/const.js', 'text/javascript', options(second.signal)), { name: 'AbortError' });
    await flush();
    first.abort(); await a; assert.equal(requestSignal.aborted, false);
    second.abort(); await b; assert.equal(requestSignal.aborted, true);
});
