import test from 'node:test';
import assert from 'node:assert/strict';
import { openVideo, releaseVideo, thumbnails } from '../js/media.js';

class FakeVideo {
    constructor(document) {
        this.document = document;
        this.listeners = new Map();
        this.attributes = new Map();
        this.style = {};
        this.readyState = 0;
        this.duration = NaN;
        this.videoWidth = this.videoHeight = 0;
        this.currentTime = 0;
        this.loads = this.pauses = 0;
    }
    addEventListener(name, listener) {
        const listeners = this.listeners.get(name) || new Set();
        listeners.add(listener);
        this.listeners.set(name, listeners);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    dispatch(name) { for (const listener of [...(this.listeners.get(name) || [])]) listener(); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
    pause() { this.pauses++; }
    load() { this.loads++; this.onLoad?.(); }
    remove() { this.document.children.delete(this); }
    decoded() { Object.assign(this, { readyState: 2, duration: 3, videoWidth: 640, videoHeight: 360 }); }
    listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function fixture(t) {
    const previous = new Map(['document', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    const videos = [], timers = new Map(), children = new Set();
    let nextTimer = 0;
    const document = {
        children,
        body: { append: video => children.add(video) },
        createElement(tag) {
            assert.equal(tag, 'video');
            const video = new FakeVideo(document);
            videos.push(video);
            return video;
        },
    };
    globalThis.document = document;
    globalThis.window = {
        setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
        clearTimeout: id => timers.delete(id),
    };
    return { document, videos, timers, children };
}

test('Media readers are attached before loading and wait for decoded frames without relying on loadeddata', async t => {
    const f = fixture(t);
    const create = f.document.createElement;
    f.document.createElement = tag => {
        const video = create(tag);
        video.onLoad = () => {
            if (!video.src) return;
            assert.ok(f.children.has(video), 'The decoder is attached before load()');
            assert.equal(video.preload, 'auto');
            assert.equal(video.muted, true);
            assert.equal(video.playsInline, true);
            assert.equal(video.attributes.get('muted'), '');
            assert.equal(video.attributes.get('playsinline'), '');
            assert.equal(video.attributes.get('aria-hidden'), 'true');
            assert.equal(video.tabIndex, -1);
            assert.equal(video.style.width, '1px');
            assert.equal(video.style.height, '1px');
            assert.notEqual(video.style.display, 'none');
            assert.notEqual(video.style.visibility, 'hidden');
        };
        return video;
    };
    let settled = false;
    const pending = openVideo('blob:photos-library').then(video => { settled = true; return video; });
    const video = f.videos[0];
    Object.assign(video, { duration: 3, videoWidth: 640, videoHeight: 360, readyState: 1 });
    video.dispatch('loadedmetadata');
    await Promise.resolve();
    assert.equal(settled, false, 'Metadata does not establish a usable canvas frame');
    video.decoded(); video.dispatch('canplay');
    assert.equal(await pending, video);
    assert.equal(video.listenerCount(), 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.children.size, 1, 'The returned decoder remains available to its caller');
    releaseVideo(video);
    assert.equal(f.children.size, 0);
    assert.equal(video.src, '');
    assert.equal(video.pauses, 1);
    assert.equal(video.loads, 2);
});

test('Premature loadeddata cannot resolve a reader, while seeked can confirm a ready frame', async t => {
    const f = fixture(t);
    let settled = false;
    const pending = openVideo('blob:video').then(video => { settled = true; return video; });
    const video = f.videos[0];
    video.dispatch('loadeddata');
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(f.timers.size, 1);
    video.decoded(); video.dispatch('seeked');
    assert.equal(await pending, video);
    assert.equal(video.listenerCount(), 0);
    releaseVideo(video);
});

test('A synchronously ready reader is usable even if no readiness event is dispatched', async t => {
    const f = fixture(t);
    const create = f.document.createElement;
    f.document.createElement = tag => {
        const video = create(tag);
        video.onLoad = () => { if (video.src) video.decoded(); };
        return video;
    };
    const video = await openVideo('blob:cached-video');
    assert.equal(f.timers.size, 0);
    assert.equal(video.listenerCount(), 0);
    releaseVideo(video);
    assert.equal(f.children.size, 0);
});

test('Cancellation before and during media loading leaves no decoder, listener, or timer', async t => {
    const f = fixture(t);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(openVideo('blob:video', cancelled.signal), { name: 'AbortError' });
    assert.equal(f.videos.length, 0);
    const controller = new AbortController();
    const pending = openVideo('blob:video', controller.signal), video = f.videos[0];
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(f.children.size, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(video.listenerCount(), 0);
    assert.equal(video.src, '');
    video.decoded(); video.dispatch('canplay');
    assert.equal(f.children.size, 0, 'A late event cannot revive a cancelled decoder');
});

test('Cancellation immediately after a synchronous ready frame still releases the reader', async t => {
    const f = fixture(t), controller = new AbortController();
    const create = f.document.createElement;
    f.document.createElement = tag => {
        const video = create(tag);
        video.onLoad = () => { if (video.src) video.decoded(); };
        return video;
    };
    const pending = openVideo('blob:video', controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(f.children.size, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.videos[0].listenerCount(), 0);
});

test('Unsupported media and unreadable duration errors release their attached readers', async t => {
    const f = fixture(t);
    for (const [properties, event, message] of [
        [{}, 'error', /cannot play the source codec/],
        [{ videoWidth: 0, videoHeight: 0 }, 'canplay', /cannot decode the video track/],
        [{ duration: NaN }, 'loadeddata', /readable duration/],
        [{ duration: Infinity }, 'canplay', /readable duration/],
        [{ duration: 0 }, 'seeked', /readable duration/],
    ]) {
        const pending = openVideo('blob:bad-video'), video = f.videos.at(-1);
        video.decoded(); Object.assign(video, properties); video.dispatch(event);
        await assert.rejects(pending, message);
        assert.equal(f.children.size, 0);
        assert.equal(f.timers.size, 0);
        assert.equal(video.listenerCount(), 0);
        assert.equal(video.src, '');
    }
});

test('The decode timeout releases its reader and preserves the actionable decoding error', async t => {
    const f = fixture(t);
    const pending = openVideo('blob:never-decoded'), video = f.videos[0];
    const timer = [...f.timers.values()][0];
    assert.equal(timer.delay, 20_000);
    timer.callback();
    await assert.rejects(pending, /could not be decoded.*compatible proxy/);
    assert.equal(f.children.size, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(video.listenerCount(), 0);
});

test('Synchronous load failures are cleaned up without masking the original error', async t => {
    const f = fixture(t), failure = new Error('Reader failed to start');
    const create = f.document.createElement;
    f.document.createElement = tag => {
        const video = create(tag);
        video.onLoad = () => { throw failure; };
        return video;
    };
    await assert.rejects(openVideo('blob:video'), error => error === failure);
    assert.equal(f.children.size, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.videos[0].listenerCount(), 0);
});

test('Releasing an existing preview video never removes it from the page', t => {
    const f = fixture(t), video = f.document.createElement('video');
    f.children.add(video);
    video.src = 'blob:preview';
    releaseVideo(video);
    assert.equal(f.children.has(video), true);
    assert.equal(video.src, '');
    assert.equal(video.pauses, 1);
});

test('Thumbnail preparation releases its helper after capture success and capture failure', async t => {
    const f = fixture(t);
    const create = f.document.createElement;
    let failCapture = false;
    f.document.createElement = tag => {
        if (tag === 'canvas') return {
            getContext: () => ({ drawImage() { if (failCapture) throw new Error('Frame capture failed'); } }),
            toDataURL: () => 'data:image/jpeg;base64,thumbnail',
        };
        const video = create(tag);
        video.onLoad = () => { if (video.src) video.decoded(); };
        return video;
    };
    assert.deepEqual(await thumbnails('blob:video', 1), ['data:image/jpeg;base64,thumbnail']);
    assert.equal(f.children.size, 0);
    failCapture = true;
    await assert.rejects(thumbnails('blob:video', 1), /Frame capture failed/);
    assert.equal(f.children.size, 0);
    assert.equal(f.timers.size, 0);
    assert.ok(f.videos.every(video => video.listenerCount() === 0));
});
