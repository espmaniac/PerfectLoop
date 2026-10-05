import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline } from '../js/timeline.js';
import { DEFAULTS } from '../js/constants.js';

class FakeElement {
    constructor(dataset = {}) {
        this.dataset = dataset;
        this.style = {};
        this.hidden = false;
        this.listeners = new Map();
        this.attributes = new Map();
        this.children = [];
    }
    addEventListener(name, listener) {
        const listeners = this.listeners.get(name) || [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
    }
    removeEventListener(name, listener) {
        this.listeners.set(name, (this.listeners.get(name) || []).filter(value => value !== listener));
    }
    dispatch(name, values = {}) {
        const event = { target: this, preventDefault() {}, stopPropagation() {}, ...values };
        for (const listener of this.listeners.get(name) || []) listener(event);
    }
    closest(selector) { return selector === '[data-edge]' && this.dataset.edge ? this : null; }
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 100, width: 400 }; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    set src(value) { this.setAttribute('src', value); }
    get src() { return this.getAttribute('src'); }
}

function fixture(t) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const elements = new Map([
        '#filmstrip', '#range-duration', '#ruler-labels', '#shade-left', '#shade-right',
        '#selection-outline', '#filmstrip-images', '#playhead', '#timeline-preview-end',
        '#timeline-preview-duration', '[data-action="zoom"]',
    ].map(selector => [selector, new FakeElement()]));
    const handles = ['start', 'end'].map(edge => new FakeElement({ edge }));
    elements.get('#filmstrip-images').children = Array.from({ length: 10 }, () => new FakeElement());
    globalThis.document = {
        querySelector: selector => elements.get(selector),
        querySelectorAll: selector => selector === '[data-edge]' ? handles : [],
    };
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else delete globalThis.document;
    });
    const state = {
        mode: 'source', info: { duration: 60, fps: 30 },
        s: { ...DEFAULTS, start: 12, end: 18, repeats: 4 },
        filmstrip: Array.from({ length: 12 }, (_, i) => `source-${i}`),
        renderFilmstrip: Array.from({ length: 10 }, (_, i) => `render-${i}`),
        renderURL: 'finished-loop.mp4', render: { duration: 5.5, fps: 30 },
        playhead: 15, renderPlayhead: 1.375,
    };
    const updates = [], seeks = [], remembers = [];
    const timeline = new Timeline(() => state, change => {
        updates.push(change);
        Object.assign(state.s, change);
    }, time => seeks.push(time), () => remembers.push(true));
    return { timeline, state, elements, handles, updates, seeks, remembers };
}

function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`); }

test('Loop timeline uses the rendered duration, thumbnails, and playback position', t => {
    const f = fixture(t);
    f.timeline.toggleZoom();
    f.state.mode = 'loop';
    for (const duration of [5.5, 11.933333, 3]) {
        f.state.render.duration = duration;
        f.state.renderPlayhead = duration / 4;
        f.timeline.render();
        const window = f.timeline.window();
        assert.equal(window.from, 0);
        assert.equal(window.span, duration, 'source zoom and export repeats must not alter the rendered range');
        assert.equal(window.percent(duration), 100);
        assert.equal(f.elements.get('#range-duration').textContent, `0.000–${duration.toFixed(3)}s rendered`);
        assert.equal(f.elements.get('#timeline-preview-end').textContent, duration.toFixed(3));
        assert.equal(f.elements.get('#timeline-preview-duration').textContent, duration.toFixed(3));
        assert.equal(f.elements.get('#selection-outline').style.left, '0%');
        assert.equal(f.elements.get('#selection-outline').style.width, '100%');
        assert.equal(f.elements.get('#playhead').style.left, '25%');
        assert.equal(f.elements.get('#playhead').hidden, false);
        f.timeline.renderPlayhead(duration * 0.75);
        near(parseFloat(f.elements.get('#playhead').style.left), 75);
        assert.deepEqual(f.elements.get('#filmstrip-images').children.map(image => image.src), f.state.renderFilmstrip);
        assert.ok(f.handles.every(handle => handle.hidden), 'source trim handles are unavailable in Loop preview');
    }
});

test('Returning to Source restores the selected range, zoom, and source playback position', t => {
    const f = fixture(t);
    f.timeline.toggleZoom();
    const sourceWindow = f.timeline.window();
    f.state.mode = 'loop';
    f.timeline.render();
    f.state.mode = 'source';
    f.timeline.render();
    near(f.timeline.window().from, sourceWindow.from);
    near(f.timeline.window().span, sourceWindow.span);
    near(parseFloat(f.elements.get('#selection-outline').style.left), sourceWindow.percent(12));
    near(parseFloat(f.elements.get('#selection-outline').style.width), sourceWindow.percent(18) - sourceWindow.percent(12));
    near(parseFloat(f.elements.get('#playhead').style.left), sourceWindow.percent(15));
    assert.ok(f.handles.every(handle => !handle.hidden));
    assert.ok(f.elements.get('#filmstrip-images').children.every(image => image.src.startsWith('source-')));
    assert.equal(f.elements.get('#range-duration').textContent, '6.000s selected');
});

test('Seeking on the Loop timeline uses output coordinates and clamps to the rendered range', t => {
    const f = fixture(t);
    f.timeline.toggleZoom();
    f.state.mode = 'loop';
    f.timeline.render();
    const ruler = f.elements.get('#filmstrip');
    for (const clientX of [50, 300, 550]) ruler.dispatch('pointerdown', { clientX });
    assert.deepEqual(f.seeks, [0, 2.75, 5.5]);
    assert.deepEqual(f.updates, []);
});

test('Loop preview cannot edit source trims or change the saved source zoom', t => {
    const f = fixture(t);
    f.timeline.toggleZoom();
    const selection = { start: f.state.s.start, end: f.state.s.end };
    const zoom = f.timeline.zoom;
    f.state.mode = 'loop';
    f.timeline.render();
    for (const handle of f.handles) {
        handle.dispatch('keydown', { key: 'ArrowRight' });
        f.timeline.drag({ preventDefault() {}, stopPropagation() {}, pointerId: 1 }, handle);
        handle.dispatch('pointermove', { clientX: 400 });
    }
    f.timeline.toggleZoom();
    assert.deepEqual(f.updates, []);
    assert.deepEqual(f.remembers, []);
    assert.deepEqual({ start: f.state.s.start, end: f.state.s.end }, selection);
    assert.equal(f.timeline.zoom, zoom);

    f.state.mode = 'source';
    f.timeline.render();
    f.handles[0].dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(f.updates.length, 1, 'trim editing becomes available again in Source');
    near(f.state.s.start, selection.start + 1 / f.state.info.fps);

    f.timeline.drag({ preventDefault() {}, stopPropagation() {}, pointerId: 2 }, f.handles[0]);
    f.state.mode = 'loop';
    f.handles[0].dispatch('pointermove', { clientX: 400 });
    assert.equal(f.updates.length, 1, 'switching to Loop preview cancels changes from an existing source drag');
});
