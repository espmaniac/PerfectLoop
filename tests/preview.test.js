import test from 'node:test';
import assert from 'node:assert/strict';
import { Preview } from '../js/preview.js';
import { DEFAULTS } from '../js/constants.js';

class FakeElement {
    constructor() {
        this.listeners = new Map();
        this.style = { setProperty() {} };
    }
    addEventListener(name, listener) {
        const listeners = this.listeners.get(name) || [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
    }
    dispatch(name) { for (const listener of this.listeners.get(name) || []) listener(); }
    setAttribute() {}
    removeAttribute(name) { delete this[name]; }
}

class FakeVideo extends FakeElement {
    constructor(color) {
        super();
        Object.assign(this, {
            color, videoWidth: 640, videoHeight: 360, readyState: 2,
            currentTime: 1, duration: 3, paused: true, seeking: false,
        });
    }
    pause() { this.paused = true; this.dispatch('pause'); }
    load() { this.readyState = 0; this.videoWidth = this.videoHeight = 0; }
}

class FakeCanvas extends FakeElement {
    constructor() {
        super();
        this._width = this._height = 16;
        this.pixel = null;
        this.context = {
            fillStyle: '#000000',
            fillRect: () => { this.pixel = this.context.fillStyle; },
            clearRect: () => { this.pixel = null; },
            drawImage: video => { this.pixel = video.color; },
            save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
        };
    }
    get width() { return this._width; }
    set width(value) { this._width = value; this.pixel = null; }
    get height() { return this._height; }
    set height(value) { this._height = value; this.pixel = null; }
    getContext() { return this.context; }
}

function fixture(t) {
    const previous = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame']
        .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const source = new FakeVideo('#2468ac'), output = new FakeVideo('#64ac24');
    const canvas = new FakeCanvas(), alternate = new FakeCanvas();
    const elements = new Map([
        ['#source-video', source], ['#loop-video', output], ['#preview-canvas', canvas],
        ['#alternate-canvas', alternate], ['[data-action="play"]', new FakeElement()],
        ['#transport-time', new FakeElement()],
    ]);
    let nextId = 0, now = 101;
    const frames = new Map();
    globalThis.document = { querySelector: selector => elements.get(selector) };
    globalThis.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const state = {
        mode: 'loop', renderURL: 'rendered-loop.mp4',
        render: { width: 640, height: 360, duration: 3, fps: 30 },
        info: { width: 640, height: 360, duration: 3, fps: 30 },
        s: { ...DEFAULTS, start: 0, end: 3 },
    };
    const times = [];
    const preview = new Preview(() => state, mode => { state.mode = mode; }, (time, mode) => times.push({ time, mode }));
    t.after(() => {
        preview.destroy();
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    preview.refresh();
    return {
        preview, state, source, output, canvas, alternate, times,
        tick() {
            const [id, callback] = frames.entries().next().value;
            frames.delete(id);
            callback(now);
            now += 16;
        },
    };
}

test('Loop preview keeps its last decoded frame while the next frame is unavailable', t => {
    const f = fixture(t);
    f.tick();
    assert.equal(f.canvas.pixel, '#64ac24');

    f.output.currentTime = 0;
    f.output.readyState = 1;
    f.output.seeking = true;
    f.output.color = '#000000';
    f.tick();
    assert.equal(f.canvas.pixel, '#64ac24', 'decoder waiting must not blank the canvas');

    f.output.readyState = 2;
    f.tick();
    assert.equal(f.canvas.pixel, '#64ac24', 'a seek must finish before its frame is displayed');

    f.output.seeking = false;
    f.output.color = '#ac2468';
    f.tick();
    assert.equal(f.canvas.pixel, '#ac2468', 'the decoded loop head replaces the retained frame');
});

test('Completing a paused seek refreshes the frame even at the same playback time', t => {
    const f = fixture(t);
    for (const [mode, video] of [['loop', f.output], ['source', f.source]]) {
        f.preview.setMode(mode);
        f.tick();
        video.seeking = true;
        f.tick();
        video.seeking = false;
        video.color = '#ac2468';
        video.dispatch('seeked');
        f.tick();
        assert.equal(f.canvas.pixel, '#ac2468', `${mode} updates after seeking`);
    }
});

test('A valid black frame remains visible in the rendered video', t => {
    const f = fixture(t);
    f.tick();
    f.output.currentTime = 1.1;
    f.output.color = '#000000';
    f.tick();
    assert.equal(f.canvas.pixel, '#000000');
});

test('Replacing active media clears the previous image before the new video loads', t => {
    const f = fixture(t);
    f.tick();
    f.preview.setOutput('replacement-loop.mp4');
    assert.notEqual(f.canvas.pixel, '#64ac24');
    assert.equal(f.alternate.pixel, '#2468ac', 'the source framing preview remains available');

    f.preview.setMode('source');
    f.tick();
    assert.equal(f.canvas.pixel, '#2468ac');
    f.preview.setSource('replacement-source.mp4');
    assert.notEqual(f.canvas.pixel, '#2468ac');
    assert.notEqual(f.alternate.pixel, '#2468ac');
});

test('Refreshing unchanged dimensions preserves the source framing preview', t => {
    const f = fixture(t);
    f.tick();
    assert.equal(f.alternate.pixel, '#2468ac');
    f.preview.refresh();
    assert.equal(f.alternate.pixel, '#2468ac');
});

test('Playback publishes the active media time on every animation frame', t => {
    const f = fixture(t);
    f.source.currentTime = 2;
    f.output.currentTime = 0.25;
    f.tick();
    f.output.currentTime = 0.5;
    f.tick();
    f.preview.setMode('source');
    f.tick();
    assert.deepEqual(f.times, [
        { time: 0.25, mode: 'loop' },
        { time: 0.5, mode: 'loop' },
        { time: 2, mode: 'source' },
    ]);
});

test('Timeline seeking preserves Loop mode while source selection still seeks Source', t => {
    const f = fixture(t);
    f.preview.seek(1.5, 'loop');
    assert.equal(f.state.mode, 'loop');
    assert.equal(f.output.currentTime, 1.5);
    assert.equal(f.source.currentTime, 1);
    assert.deepEqual(f.times.at(-1), { time: 1.5, mode: 'loop' });
    f.preview.seek(10, 'loop');
    assert.equal(f.output.currentTime, 2.999, 'output seeking stops before the rendered end');

    f.preview.seek(2);
    assert.equal(f.state.mode, 'source');
    assert.equal(f.source.currentTime, 2);
    assert.equal(f.output.currentTime, 2.999);
    assert.deepEqual(f.times.at(-1), { time: 2, mode: 'source' });
});
