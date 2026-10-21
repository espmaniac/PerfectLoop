import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import { EngineAssets, downloadEngineAsset, ENGINE_ASSET_BYTES } from '../js/engine-assets.js';

test('Download size metadata matches every bundled runtime asset', async () => {
    for (const [path, bytes] of Object.entries(ENGINE_ASSET_BYTES))
        assert.equal((await stat(new URL(path, new URL('../js/', import.meta.url)))).size, bytes, path);
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
    const pending = assert.rejects(downloadEngineAsset('engine.gz', { idleTimeout: 100, retryDelay: 0 }), /connection or VPN/);
    for (let attempt = 0; attempt < 3; attempt++) { await flush(); t.mock.timers.tick(100); }
    await pending;
    assert.equal(signals.length, 3); assert(signals.every(signal => signal.aborted));
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
    const value = await downloadEngineAsset('engine.gz', { retryDelay: 0, decode: bytes => {
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

test('Retry replaces the failed attempt byte count and counts only files still needed', async t => {
    const progress = [], controller = new AbortController(), assets = new EngineAssets();
    let wasmAttempts = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        const bytes = await readFile(url);
        if (!url.pathname.endsWith('.gz')) return new Response(bytes);
        if (++wasmAttempts === 1) return new Response(new ReadableStream({ start(stream) {
            stream.enqueue(bytes.subarray(0, Math.floor(bytes.length / 2)));
            setTimeout(() => stream.error(new TypeError('Connection changed')), 0);
        } }));
        return new Response(bytes);
    });
    const options = { signal: controller.signal, onProgress: (fraction, message) => progress.push({ fraction, message }) };
    await assets.load(false, options);
    const scripts = Object.entries(ENGINE_ASSET_BYTES).filter(([path]) => path.startsWith('../vendor/ffmpeg/') && path.endsWith('.js')).reduce((sum, [, bytes]) => sum + bytes, 0);
    const expected = scripts / (scripts + ENGINE_ASSET_BYTES['../vendor/ffmpeg/ffmpeg-core.wasm.gz']);
    const reconnect = progress.find(item => item.message.startsWith('Reconnecting'));
    assert(reconnect); assert.equal(reconnect.fraction, expected);
    assert(progress.every(item => item.fraction >= 0 && item.fraction <= 1));
    assert.equal(wasmAttempts, 2);
    assets.invalidateScripts(); progress.length = 0;
    await assets.load(false, options);
    assert.equal(wasmAttempts, 2, 'The successfully cached WASM is excluded from another download');
    const downloading = progress.filter(item => item.message.startsWith('Downloading'));
    assert.equal(downloading[0].fraction, 0); assert.equal(downloading.at(-1).fraction, 1);
    assert(downloading.some(item => item.fraction === ENGINE_ASSET_BYTES['../vendor/ffmpeg/const.js'] / scripts));
});
