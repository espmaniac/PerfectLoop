import test from 'node:test';
import assert from 'node:assert/strict';
import { captureWallpaperStill } from '../js/wallpaper-still.js';

const videoBlob = new Blob(['completed encoded video'], { type: 'video/mp4' });
const jpegBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
const metadata = { time: 1.5, fps: 30, width: 1170, height: 2532 };

function fixture(t, options = {}) {
    const previous = new Map(['document', 'window', 'URL', 'clearTimeout']
        .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    const f = { videos: [], canvases: [], children: new Set(), timers: new Map(), created: [], revoked: [], seeks: [], draws: [], encodes: [], callbacks: [] };
    let nextTimer = 0;
    const clear = id => f.timers.delete(id);
    globalThis.clearTimeout = clear;
    globalThis.window = {
        setTimeout: (callback, delay) => { f.timers.set(++nextTimer, { callback, delay }); return nextTimer; },
        clearTimeout: clear,
    };
    globalThis.URL = {
        createObjectURL(blob) { const url = `blob:wallpaper-${f.created.length}`; f.created.push({ url, blob }); return url; },
        revokeObjectURL: url => f.revoked.push(url),
    };
    globalThis.document = {
        body: { append: video => f.children.add(video) },
        createElement(tag) {
            if (tag === 'video') {
                const listeners = new Map();
                let time = 0;
                const video = {
                    style: {}, duration: 3, videoWidth: options.width || metadata.width, videoHeight: options.height || metadata.height,
                    readyState: 0, seeking: false,
                    setAttribute() {}, removeAttribute() { this.src = ''; }, pause() {}, remove() { f.children.delete(this); },
                    addEventListener(name, listener) { const set = listeners.get(name) || new Set(); set.add(listener); listeners.set(name, set); },
                    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
                    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
                    dispatch(name) { for (const listener of [...(listeners.get(name) || [])]) listener(); },
                    load() {
                        if (!this.src || options.open === 'pending') return;
                        queueMicrotask(() => {
                            if (options.open === 'error') this.dispatch('error');
                            else { this.readyState = 2; this.dispatch('loadeddata'); }
                        });
                    },
                    get currentTime() { return time; },
                    set currentTime(value) {
                        f.seeks.push(value);
                        if (options.seek === 'throw') throw new Error('Seeking failed synchronously');
                        time = value; this.seeking = true;
                        if (options.seek === 'pending') return;
                        queueMicrotask(() => { this.seeking = false; this.dispatch('seeked'); });
                    },
                };
                f.videos.push(video);
                return video;
            }
            assert.equal(tag, 'canvas');
            const canvas = {
                width: 0, height: 0,
                getContext() {
                    if (options.context === 'null') return null;
                    return { drawImage(video, x, y, width, height) {
                        f.draws.push({ video, x, y, width, height, canvasWidth: canvas.width, canvasHeight: canvas.height, time: video.currentTime });
                        if (options.draw === 'throw') throw new Error('Drawing failed synchronously');
                    } };
                },
                toBlob(callback, type, quality) {
                    f.encodes.push({ type, quality, width: this.width, height: this.height });
                    f.callbacks.push(callback);
                    if (options.encode === 'throw') throw new Error('JPEG encoding failed synchronously');
                    if (options.encode !== 'pending') queueMicrotask(() => callback(Object.hasOwn(options, 'jpeg') ? options.jpeg : jpegBlob));
                },
            };
            f.canvases.push(canvas);
            return canvas;
        },
    };
    f.flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    f.assertReleased = () => {
        assert.equal(f.children.size, 0, 'Temporary decoders are detached');
        assert.equal(f.timers.size, 0, 'Pending media and encoding timers are cleared');
        assert.ok(f.videos.every(video => video.listenerCount() === 0), 'Media listeners are removed');
        assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0), 'Large canvas backing stores are released');
        assert.deepEqual(f.revoked, f.created.map(item => item.url), 'Every temporary object URL is revoked');
    };
    return f;
}

test('Wallpaper stills capture frame centers at full encoded resolution for first, middle, and final frames', async t => {
    const f = fixture(t);
    for (const time of [0, 1.5, 89 / 30]) {
        const jpeg = await captureWallpaperStill(videoBlob, { ...metadata, time });
        assert.equal(jpeg, jpegBlob);
        const draw = f.draws.at(-1);
        assert.equal(draw.time, time + 0.5 / metadata.fps);
        assert.deepEqual([draw.x, draw.y, draw.width, draw.height], [0, 0, 1170, 2532]);
        assert.deepEqual([draw.canvasWidth, draw.canvasHeight], [1170, 2532]);
        assert.deepEqual(f.encodes.at(-1), { type: 'image/jpeg', quality: 0.95, width: 1170, height: 2532 });
        f.assertReleased();
    }
});

test('Invalid source blobs, dimensions, positions, and frame rates are rejected before allocating media resources', async t => {
    const f = fixture(t);
    for (const blob of [undefined, new Blob([]), { size: 10 }])
        await assert.rejects(captureWallpaperStill(blob, metadata), /video is not ready/);
    for (const change of [{ width: 0 }, { width: 1170.5 }, { height: 3841 }, { width: NaN }, { time: -1 }, { time: Infinity }, { fps: 0 }, { fps: NaN }])
        await assert.rejects(captureWallpaperStill(videoBlob, { ...metadata, ...change }), /valid wallpaper/);
    await assert.rejects(captureWallpaperStill(videoBlob), /valid wallpaper dimensions/);
    assert.equal(f.created.length, 0);
    assert.equal(f.videos.length, 0);
    f.assertReleased();
});

test('Dimension mismatch and an out-of-video frame are rejected without silently rescaling or clamping', async t => {
    const f = fixture(t);
    await assert.rejects(captureWallpaperStill(videoBlob, { ...metadata, width: 1080 }), /dimensions do not match/);
    for (const time of [3, 3 - 0.25 / 30])
        await assert.rejects(captureWallpaperStill(videoBlob, { ...metadata, time }), /outside the finished video/);
    assert.equal(f.draws.length, 0);
    f.assertReleased();
});

test('Null, empty, and non-JPEG encoder output is rejected and all resources are released', async t => {
    for (const [name, jpeg] of [['null', null], ['empty', new Blob([], { type: 'image/jpeg' })], ['wrong type', new Blob(['pixels'], { type: 'image/png' })]]) {
        await t.test(name, async t => {
            const f = fixture(t, { jpeg });
            await assert.rejects(captureWallpaperStill(videoBlob, metadata), /could not create a JPEG wallpaper still/);
            f.assertReleased();
        });
    }
});

test('Missing canvas context, synchronous drawing, and synchronous JPEG encoding failures release the canvas backing', async t => {
    for (const [name, options, message] of [
        ['context', { context: 'null' }, /could not prepare the wallpaper still/],
        ['drawing', { draw: 'throw' }, /Drawing failed synchronously/],
        ['encoding', { encode: 'throw' }, /JPEG encoding failed synchronously/],
    ]) {
        await t.test(name, async t => {
            const f = fixture(t, options);
            await assert.rejects(captureWallpaperStill(videoBlob, metadata), message);
            f.assertReleased();
        });
    }
});

test('A stalled JPEG encoder has a bounded timeout and late callbacks cannot return a result', async t => {
    const f = fixture(t, { encode: 'pending' });
    const pending = captureWallpaperStill(videoBlob, metadata);
    await f.flush();
    assert.equal(f.callbacks.length, 1);
    assert.equal(f.timers.size, 1);
    const timer = [...f.timers.values()][0];
    assert.equal(timer.delay, 10_000);
    timer.callback();
    await assert.rejects(pending, /could not be encoded in time/);
    f.assertReleased();
    f.callbacks[0](jpegBlob);
    await f.flush();
    f.assertReleased();
});

test('Cancellation before starting and while loading the completed video releases every resource', async t => {
    const f = fixture(t, { open: 'pending' });
    const before = new AbortController(); before.abort();
    await assert.rejects(captureWallpaperStill(videoBlob, metadata, before.signal), { name: 'AbortError' });
    assert.equal(f.created.length, 0);
    const during = new AbortController();
    const pending = captureWallpaperStill(videoBlob, metadata, during.signal);
    assert.equal(f.children.size, 1);
    during.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    f.assertReleased();
});

test('Cancellation while seeking and a synchronous seek failure clean up media listeners and timers', async t => {
    await t.test('cancel', async t => {
        const f = fixture(t, { seek: 'pending' }), controller = new AbortController();
        const pending = captureWallpaperStill(videoBlob, metadata, controller.signal);
        await f.flush();
        assert.equal(f.seeks.length, 1);
        controller.abort();
        await assert.rejects(pending, { name: 'AbortError' });
        f.assertReleased();
    });
    await t.test('throw', async t => {
        const f = fixture(t, { seek: 'throw' });
        await assert.rejects(captureWallpaperStill(videoBlob, metadata), /Seeking failed synchronously/);
        f.assertReleased();
    });
});

test('Cancellation while encoding rejects immediately and ignores the noncancellable encoder callback', async t => {
    const f = fixture(t, { encode: 'pending' }), controller = new AbortController();
    const pending = captureWallpaperStill(videoBlob, metadata, controller.signal);
    await f.flush();
    assert.equal(f.callbacks.length, 1);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    f.assertReleased();
    f.callbacks[0](jpegBlob);
    await f.flush();
    f.assertReleased();
});

test('A native decoder failure revokes the completed video URL without preparing a still', async t => {
    const f = fixture(t, { open: 'error' });
    await assert.rejects(captureWallpaperStill(videoBlob, metadata), /cannot play the source codec/);
    assert.equal(f.encodes.length, 0);
    f.assertReleased();
});
