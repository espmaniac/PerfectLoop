import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../js/constants.js';
import { PreviewEditor } from '../js/preview-editor.js';
import { createTextLayer, importImageLayer, clearLayerAssets, drawLayers, hitTestLayers, layerSelectionGeometry, layerDragPosition } from '../js/layers.js';

const identity = () => [1, 0, 0, 1, 0, 0];
function multiply([a, b, c, d, e, f], [g, h, i, j, k, l]) {
    return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}
function inversePoint([a, b, c, d, e, f], x, y) {
    const determinant = a * d - b * c;
    return { x: (d * (x - e) - c * (y - f)) / determinant, y: (-b * (x - e) + a * (y - f)) / determinant };
}

// This small canvas fixture samples transformed painted rectangles and image
// alpha. Hit tests can fail on transparent pixels, rotation, or wrong placement.
class PixelContext {
    constructor(canvas) { this.canvas = canvas; this.matrix = identity(); this.paints = []; this.stack = []; this.globalAlpha = 1; }
    translate(x, y) { this.matrix = multiply(this.matrix, [1, 0, 0, 1, x, y]); }
    rotate(angle) { this.matrix = multiply(this.matrix, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]); }
    scale(x, y) { this.matrix = multiply(this.matrix, [x, 0, 0, y, 0, 0]); }
    save() { this.stack.push({ matrix: [...this.matrix], globalAlpha: this.globalAlpha }); }
    restore() { Object.assign(this, this.stack.pop()); }
    measureText(text) { return { width: text.length * 10, actualBoundingBoxRight: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; }
    paint(x, y, width, height, alphaAt = () => 255) {
        this.paints.push({ matrix: [...this.matrix], x, y, width, height, alphaAt, alpha: this.globalAlpha });
    }
    fillText(text, x, y) {
        for (const [index, character] of [...text].entries()) if (character !== ' ') this.paint(x + index * 10, y - 8, 8, 10);
    }
    drawImage(image, x, y, width = image.width, height = image.height) {
        this.paint(x, y, width, height, (px, py) => image.getContext
            ? image.getContext('2d').alphaAt(px / width * image.width, py / height * image.height)
            : image.alphaAt?.(px / width * image.width, py / height * image.height) ?? 255);
    }
    alphaAt(x, y) {
        let alpha = 0;
        for (const paint of this.paints) {
            const point = inversePoint(paint.matrix, x, y), dx = point.x - paint.x, dy = point.y - paint.y;
            if (dx >= 0 && dx < paint.width && dy >= 0 && dy < paint.height) alpha = Math.max(alpha, paint.alphaAt(dx, dy) * paint.alpha);
        }
        return alpha;
    }
    getImageData(x, y) { return { data: Uint8ClampedArray.of(0, 0, 0, this.alphaAt(x + 0.5, y + 0.5)) }; }
}

class PixelCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = new PixelContext(this); }
    getContext() { return this.context; }
}

class PointerCanvas extends PixelCanvas {
    constructor() {
        super(200, 100);
        this.style = {};
        this.dataset = {};
        this.listeners = new Map();
        this.captured = new Set();
        this.box = { left: 10, top: 20, width: 400, height: 200 };
    }
    addEventListener(name, callback) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    getBoundingClientRect() { return this.box; }
    setPointerCapture(pointerId) { this.captured.add(pointerId); }
    hasPointerCapture(pointerId) { return this.captured.has(pointerId); }
    releasePointerCapture(pointerId) { this.captured.delete(pointerId); }
    dispatch(name, x = 100, y = 50, partial = {}) {
        const event = {
            pointerId: 1, button: 0, isPrimary: true,
            clientX: this.box.left + x / this.width * this.box.width,
            clientY: this.box.top + y / this.height * this.box.height,
            preventDefault() { this.prevented = true; }, ...partial,
        };
        for (const callback of [...(this.listeners.get(name) || [])]) callback(event);
        return event;
    }
}

function fixture(t) {
    const keys = ['OffscreenCanvas', 'createImageBitmap'];
    const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    globalThis.OffscreenCanvas = PixelCanvas;
    globalThis.createImageBitmap = async file => file.image;
    const canvas = new PointerCanvas();
    const state = {
        s: { ...DEFAULTS, width: 200, height: 100, start: 0, end: 4, method: 'natural', zoom: 100 },
        file: {}, info: { width: 400, height: 100, duration: 4 }, sourceURL: 'source.mp4',
        mode: 'composition', tab: 'edit', wallpaperScreen: 'editor', job: null, activeLayerId: '',
    };
    const calls = { begins: 0, history: 0, videos: [], layers: [], selections: [], changes: 0 };
    let time = 0;
    const editor = new PreviewEditor(canvas, () => state, {
        beginEdit() { calls.begins++; state.mode = 'composition'; },
        editVideo(partial) { calls.videos.push(partial); state.s = { ...state.s, ...partial }; editor.refresh(); },
        selectLayer(id) { calls.selections.push(id); state.activeLayerId = id; },
        editLayer(id, partial) {
            calls.layers.push({ id, partial });
            state.s = { ...state.s, layers: state.s.layers.map(layer => layer.id === id ? { ...layer, ...partial } : layer) };
            editor.refresh();
        },
        remember() { calls.history++; }, getTime: () => time, onChange() { calls.changes++; },
    });
    t.after(() => {
        editor.destroy(); clearLayerAssets();
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    return { canvas, state, editor, calls, setTime(value) { time = value; } };
}

async function imageLayer(partial = {}, alphaAt) {
    const layer = await importImageLayer({ name: 'shape.png', type: 'image/png', size: 1, image: { width: 80, height: 20, alphaAt } });
    return { ...layer, width: 40, ...partial };
}

test('Video drag uses canvas pixels, clamps framing, and saves one undo entry after movement', t => {
    const { canvas, state, editor, calls } = fixture(t);
    assert.equal(canvas.dataset.editable, 'true');
    assert.equal(canvas.style.touchAction, 'none');
    canvas.dispatch('pointerdown', 100, 50);
    assert.ok(canvas.hasPointerCapture(1));
    assert.equal(calls.history, 0, 'Pointerdown is only a selection/pause operation');
    canvas.dispatch('pointermove', 120, 70);
    assert.equal(state.s.cropX, 40);
    assert.equal(state.s.cropY, 50, 'An axis with no extra room cannot move');
    canvas.dispatch('pointermove', 1000, 50);
    assert.equal(state.s.cropX, 0);
    assert.equal(calls.history, 1);
    assert.equal(canvas.dataset.dragging, 'true');
    canvas.dispatch('pointerup');
    assert.equal(editor.dragging, null);
    assert.equal(canvas.hasPointerCapture(1), false);
    assert.equal(canvas.listeners.get('pointermove').size, 0);
    assert.equal(canvas.dataset.dragging, 'false');
});

test('Contain and zoomed stretch video dragging follows the available output room', t => {
    const { canvas, state, calls } = fixture(t);
    state.s.fit = 'contain';
    canvas.dispatch('pointerdown', 100, 50);
    canvas.dispatch('pointermove', 120, 60);
    assert.equal(state.s.cropX, 50);
    assert.equal(state.s.cropY, 70);
    canvas.dispatch('pointerup');
    state.s = { ...state.s, fit: 'stretch', zoom: 200, cropX: 50, cropY: 50 };
    canvas.dispatch('pointerdown', 100, 50);
    canvas.dispatch('pointermove', 120, 60);
    assert.equal(state.s.cropX, 40);
    assert.equal(state.s.cropY, 40);
    assert.equal(calls.history, 2);
});

test('Source and Loop enter Composition before measuring the resized preview', t => {
    const { canvas, state, editor, calls } = fixture(t);
    for (const mode of ['source', 'loop']) {
        state.mode = mode;
        state.s.cropX = 50;
        canvas.width = 400;
        editor.beginEdit = () => { calls.begins++; state.mode = 'composition'; canvas.width = 200; };
        canvas.dispatch('pointerdown', 200, 50);
        assert.equal(editor.dragging.width, 200);
        canvas.dispatch('pointermove', 120, 50);
        assert.equal(state.s.cropX, 40);
        canvas.dispatch('pointerup');
    }
    assert.equal(calls.history, 2);
});

test('A pointer on the old preview remains a video gesture when Composition shrinks the canvas', t => {
    const { canvas, state, editor, calls } = fixture(t);
    state.mode = 'source';
    editor.beginEdit = () => {
        state.mode = 'composition';
        canvas.box = { ...canvas.box, width: 100 };
    };
    const down = canvas.dispatch('pointerdown', 190, 50);
    assert.ok(editor.dragging, 'The original canvas received the event even though its new bounds exclude the pointer');
    canvas.dispatch('pointermove', 100, 50, { clientX: down.clientX + 10, clientY: down.clientY });
    assert.equal(state.s.cropX, 40);
    canvas.dispatch('pointerup');
    assert.equal(calls.history, 1);
});

test('Unavailable files, jobs, other tabs, wallpaper screens, and secondary pointers cannot edit', t => {
    const { canvas, state, editor, calls } = fixture(t);
    const invalidStates = [
        { tab: 'find' }, { tab: 'inspect' }, { wallpaperScreen: 'lock' }, { wallpaperScreen: 'home' },
        { job: {} }, { file: null }, { info: { width: 0, height: 100, duration: 4 } },
    ];
    for (const partial of invalidStates) {
        const previous = { ...state };
        Object.assign(state, partial);
        editor.refresh();
        assert.equal(canvas.dataset.editable, 'false');
        canvas.dispatch('pointerdown');
        assert.equal(editor.dragging, null);
        Object.assign(state, previous);
    }
    canvas.dispatch('pointerdown', 100, 50, { button: 2 });
    canvas.dispatch('pointerdown', 100, 50, { isPrimary: false });
    assert.equal(calls.begins, 0);
    assert.equal(calls.history, 0);
});

test('Clicking or moving a fitted video without changing framing leaves undo untouched', t => {
    const { canvas, state, calls } = fixture(t);
    state.s.fit = 'stretch';
    canvas.dispatch('pointerdown');
    canvas.dispatch('pointermove', 130, 60);
    canvas.dispatch('pointerup');
    assert.equal(calls.history, 0);
    assert.deepEqual(calls.videos, []);
});

test('Resizing the displayed canvas cancels a drag before stale coordinates change settings', t => {
    const { canvas, editor, state, calls } = fixture(t);
    canvas.dispatch('pointerdown');
    canvas.box = { ...canvas.box, width: 200, height: 100 };
    canvas.dispatch('pointermove', 120, 50);
    assert.equal(editor.dragging, null);
    assert.equal(canvas.hasPointerCapture(1), false);
    assert.equal(state.s.cropX, 50);
    assert.equal(calls.history, 0);
});

test('Changing context and cancelling capture terminate gestures without later edits', t => {
    const { canvas, state, editor, calls } = fixture(t);
    const mutations = [
        () => { state.tab = 'find'; }, () => { state.mode = 'source'; }, () => { state.file = {}; },
        () => { state.sourceURL = 'replacement.mp4'; }, () => { state.job = {}; },
        () => { state.wallpaperScreen = 'lock'; }, () => { state.s = { ...state.s, zoom: 150 }; },
    ];
    for (const mutate of mutations) {
        const previous = { ...state, s: { ...state.s } };
        canvas.dispatch('pointerdown'); mutate(); editor.refresh();
        assert.equal(editor.dragging, null);
        assert.equal(canvas.hasPointerCapture(1), false);
        canvas.dispatch('pointermove', 130, 50);
        Object.assign(state, previous);
    }
    for (const event of ['pointercancel', 'lostpointercapture']) {
        canvas.dispatch('pointerdown'); canvas.dispatch(event);
        assert.equal(editor.dragging, null);
        assert.equal(canvas.hasPointerCapture(1), false);
    }
    assert.equal(calls.history, 0);
});

test('Layers are dragged only on the Layers tab and retain animation settings', async t => {
    const { canvas, state, calls, setTime } = fixture(t);
    const layer = await imageLayer({ x: 25, y: 50, motion: 'right', motionCycles: 2, spin: 'clockwise', spinCycles: 3 });
    state.s.layers = [layer];
    setTime(0.5);
    canvas.dispatch('pointerdown', 100, 50);
    canvas.dispatch('pointermove', 120, 50);
    canvas.dispatch('pointerup');
    assert.equal(calls.selections.length, 0);
    assert.equal(calls.layers.length, 0);
    assert.equal(state.s.layers[0].x, 25);
    assert.equal(state.s.cropX, 40);
    state.tab = 'layers';
    canvas.dispatch('pointerdown', 100, 50);
    assert.equal(state.activeLayerId, layer.id);
    const beforeHistory = calls.history;
    canvas.dispatch('pointermove', 120, 60);
    canvas.dispatch('pointermove', 130, 70);
    canvas.dispatch('pointerup');
    assert.equal(state.s.layers[0].x, 40, 'Drag starts from the stored anchor without snapping the animated position');
    assert.equal(state.s.layers[0].y, 70);
    assert.equal(state.s.layers[0].motion, 'right');
    assert.equal(state.s.layers[0].spin, 'clockwise');
    assert.equal(state.s.layers[0].motionCycles, 2);
    assert.equal(state.s.layers[0].spinCycles, 3);
    assert.equal(calls.history, beforeHistory + 1);
    assert.equal(state.s.cropX, 40, 'Moving a layer does not move its video');
});

test('A Layers click selects without history; removing or changing the selected layer ends capture', async t => {
    const { canvas, state, editor, calls } = fixture(t);
    const layer = await imageLayer();
    state.tab = 'layers'; state.s.layers = [layer];
    canvas.dispatch('pointerdown'); canvas.dispatch('pointerup');
    assert.equal(state.activeLayerId, layer.id);
    assert.equal(calls.history, 0);
    for (const change of [() => { state.s.layers = []; }, () => { state.activeLayerId = 'another'; }]) {
        state.s.layers = [layer]; state.activeLayerId = layer.id;
        canvas.dispatch('pointerdown'); change(); editor.refresh();
        assert.equal(editor.dragging, null);
        assert.equal(canvas.hasPointerCapture(1), false);
    }
});

test('Layer hit testing chooses painted topmost pixels and passes through image transparency', async t => {
    const { state } = fixture(t);
    const below = await imageLayer();
    const above = await imageLayer({}, (x) => x >= 40 ? 255 : 0);
    const hit = (x, layers = [below, above]) => hitTestLayers(layers, state.s, 0, 4, x, 50)?.layer.id;
    assert.equal(hit(110), above.id);
    assert.equal(hit(90), below.id);
    assert.equal(hit(110, [below, { ...above, visible: false }]), below.id);
    assert.equal(hit(110, [below, { ...above, opacity: 0 }]), below.id);
    assert.equal(hit(10), undefined);
});

test('Rotated and spinning hit targets exclude the transparent bounding square', async t => {
    const { state } = fixture(t);
    const layer = await imageLayer({ rotation: 45 });
    assert.equal(hitTestLayers([layer], state.s, 0, 4, 122, 72)?.layer.id, layer.id);
    assert.equal(hitTestLayers([layer], state.s, 0, 4, 125, 25), null, 'An empty corner in the rotated sprite is not content');
    const spinning = { ...layer, rotation: 0, spin: 'clockwise' };
    assert.equal(hitTestLayers([spinning], state.s, 1, 4, 100, 80)?.layer.id, layer.id);
    assert.equal(hitTestLayers([spinning], state.s, 1, 4, 130, 50), null);
    assert.equal(hitTestLayers([spinning], state.s, 0, 4, 100, 80), null, 'Hit geometry follows the displayed rotation');
    const [outline] = layerSelectionGeometry(spinning, state.s, 1, 4);
    assert.equal(outline.width, 80);
    assert.equal(outline.height, 20);
    assert.equal(outline.rotation, 90);
    assert.equal(outline.corners.length, 4);
});

test('Wrapped motion copies share placement with canvas drawing and selection outlines', async t => {
    const { state } = fixture(t);
    const layer = await imageLayer({ x: 90, motion: 'right' });
    const settings = { ...state.s, layers: [layer] }, output = new PixelCanvas(200, 100);
    drawLayers(output.getContext('2d'), [layer], settings, 0.2, 4);
    for (const point of [{ x: 2, y: 50 }, { x: 190, y: 50 }]) {
        assert.ok(output.getContext('2d').alphaAt(point.x, point.y) > 0);
        assert.equal(hitTestLayers([layer], settings, 0.2, 4, point.x, point.y)?.layer.id, layer.id);
    }
    const outlines = layerSelectionGeometry(layer, settings, 0.2, 4);
    assert.equal(outlines.length, 2);
    assert.deepEqual(outlines.map(copy => copy.centerX), [-10, 190]);
});

test('Text is draggable at glyph pixels, with transparent spaces passing through', t => {
    const { canvas, state, calls } = fixture(t);
    const layer = { ...createTextLayer(state.s), text: 'A A', fontSize: 10 };
    state.tab = 'layers'; state.s.layers = [layer];
    assert.equal(hitTestLayers([layer], state.s, 0, 4, 88, 50)?.layer.id, layer.id);
    assert.equal(hitTestLayers([layer], state.s, 0, 4, 100, 50), null);
    canvas.dispatch('pointerdown', 88, 50);
    canvas.dispatch('pointermove', 108, 50);
    canvas.dispatch('pointerup');
    assert.equal(state.s.layers[0].x, 60);
    assert.equal(calls.layers.length, 1);
    assert.equal(calls.history, 1);
});

test('Selection geometry is gated to the Layers composition and uses preview dimensions', async t => {
    const { canvas, state, editor } = fixture(t);
    const layer = await imageLayer({ spin: 'clockwise' });
    state.s.layers = [layer]; state.activeLayerId = layer.id;
    assert.deepEqual(editor.selection(), []);
    state.tab = 'layers';
    assert.equal(editor.selection()[0].width, 80);
    canvas.width = 100; canvas.height = 50;
    assert.equal(editor.selection()[0].width, 40);
    state.mode = 'loop';
    assert.deepEqual(editor.selection(), []);
    state.mode = 'composition'; state.s.layers = [{ ...layer, visible: false }];
    assert.deepEqual(editor.selection(), []);
});

test('Dragging angled animation at a paused phase solves the anchor so displayed content follows the pointer', async t => {
    const { state } = fixture(t);
    const image = await imageLayer({ width: 20 });
    for (const motion of ['along-angle', 'against-angle']) {
        for (const rotation of [0, 37, 90, -47, 180]) {
            for (const time of [0.3, 3.7]) {
                const layer = { ...image, motion, rotation, motionCycles: 2, spin: 'clockwise' };
                const [before] = layerSelectionGeometry(layer, state.s, time, 4);
                assert.ok(before, `${motion}/${rotation}/${time} has visible content`);
                const partial = layerDragPosition(layer, state.s, time, 4, 8, -4);
                assert.ok(partial.x >= 0 && partial.x <= 100 && partial.y >= 0 && partial.y <= 100);
                const [after] = layerSelectionGeometry({ ...layer, ...partial }, state.s, time, 4);
                assert.ok(after);
                assert.ok(Math.abs(after.centerX - before.centerX - 8) <= 1, `${motion}/${rotation}/${time} horizontal pointer tracking`);
                assert.ok(Math.abs(after.centerY - before.centerY + 4) <= 1, `${motion}/${rotation}/${time} vertical pointer tracking`);
                assert.equal(after.rotation, before.rotation);
            }
        }
    }
});

test('An angled layer gesture keeps the composition phase and a single undo snapshot', async t => {
    const { canvas, state, editor, calls, setTime } = fixture(t);
    const layer = await imageLayer({ motion: 'along-angle', rotation: 37, width: 20 });
    state.tab = 'layers'; state.s.layers = [layer]; setTime(0.3);
    state.activeLayerId = layer.id;
    const [before] = editor.selection();
    canvas.dispatch('pointerdown', before.centerX, before.centerY);
    assert.equal(editor.dragging.layerId, layer.id);
    canvas.dispatch('pointermove', before.centerX + 8, before.centerY - 4);
    const [after] = editor.selection();
    assert.ok(Math.abs(after.centerX - before.centerX - 8) <= 1);
    assert.ok(Math.abs(after.centerY - before.centerY + 4) <= 1);
    canvas.dispatch('pointerup');
    assert.equal(calls.history, 1);
    assert.equal(state.s.layers[0].motion, layer.motion);
    assert.equal(state.s.layers[0].rotation, layer.rotation);
});
