import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextLayer, importImageLayer, clearLayerAssets, drawLayers, hitTestLayers, layerSelectionGeometry, layerResize } from '../js/layers.js';

const settings = { width: 400, height: 240 };
const identity = () => [1, 0, 0, 1, 0, 0];
const multiply = ([a, b, c, d, e, f], [g, h, i, j, k, l]) => [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
const point = ([a, b, c, d, e, f], x, y) => ({ x: a * x + c * y + e, y: b * x + d * y + f });

// Glyph metrics and painted rectangles agree, while advances include whitespace
// and the descender varies by character. This catches loose typographic boxes.
class MetricContext {
    constructor(canvas) { this.canvas = canvas; this.matrix = identity(); this.paints = []; this.font = '20px sans-serif'; this.stack = []; }
    translate(x, y) { this.matrix = multiply(this.matrix, [1, 0, 0, 1, x, y]); }
    rotate(angle) { this.matrix = multiply(this.matrix, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]); }
    save() { this.stack.push([...this.matrix]); }
    restore() { this.matrix = this.stack.pop(); }
    glyph(character) {
        const size = parseFloat(this.font);
        const values = character === ' ' ? [0.4, 0, 0, 0, 0] : character === 'g' ? [0.55, 0.02, 0.53, 0.5, 0.2]
            : character === 'j' ? [0.35, 0.2, 0.3, 0.75, 0.23] : [0.65, 0.05, 0.62, 0.7, 0];
        return values.map(value => value * size);
    }
    measureText(text) {
        let width = 0, left = Infinity, right = -Infinity, ascent = 0, descent = 0;
        for (const character of text) {
            const [advance, bearing, end, up, down] = this.glyph(character);
            if (up + down) { left = Math.min(left, width - bearing); right = Math.max(right, width + end); }
            ascent = Math.max(ascent, up); descent = Math.max(descent, down); width += advance;
        }
        return { width, actualBoundingBoxLeft: Number.isFinite(left) ? -left : 0, actualBoundingBoxRight: Number.isFinite(right) ? right : 0,
            actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent };
    }
    paint(x, y, width, height, source) { this.paints.push({ x, y, width, height, source, matrix: [...this.matrix] }); }
    fillText(text, x, y) {
        for (const character of text) {
            const [advance, left, right, ascent, descent] = this.glyph(character);
            if (ascent + descent) this.paint(x - left, y - ascent, left + right, ascent + descent);
            x += advance;
        }
    }
    drawImage(image, x, y, width = image.width, height = image.height) { this.paint(x, y, width, height, image); }
}
class MetricCanvas {
    constructor(width, height) { this.width = width; this.height = height; this.context = new MetricContext(this); }
    getContext() { return this.context; }
}
function fixture(t) {
    const keys = ['OffscreenCanvas', 'createImageBitmap'];
    const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    globalThis.OffscreenCanvas = MetricCanvas;
    globalThis.createImageBitmap = async file => file.image;
    t.after(() => {
        clearLayerAssets();
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
}
async function image(partial = {}) {
    const layer = await importImageLayer({ name: 'transparent.png', type: 'image/png', size: 1, image: { width: 80, height: 40 } });
    return { ...layer, width: 20, ...partial };
}
const text = (partial = {}) => ({ ...createTextLayer(settings), text: 'A g', fontSize: 20, ...partial });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function resize(layer, shape, cornerIndex, factor, time = 0, dimensions = settings) {
    const anchor = { ...shape.corners[cornerIndex], cornerIndex, copyIndex: shape.copyIndex, shape };
    const partial = layerResize(layer, settings, time, 4, factor, anchor, dimensions);
    const next = { ...layer, ...partial };
    const copies = layerSelectionGeometry(next, settings, time, 4, dimensions);
    const residual = Math.min(...copies.map(copy => distance(copy.corners[cornerIndex], anchor)));
    return { partial, next, copies, residual };
}

test('Text selection excludes fallback ascent, descent, padding and leading/trailing blank lines while retaining line gaps', t => {
    fixture(t);
    const layer = text({ text: '\nA\n\ng\n' });
    const [shape] = layerSelectionGeometry(layer, settings, 0, 4);
    assert.equal(shape.width, 14, 'The rectangle includes advance width and the left glyph overhang');
    assert.equal(shape.height, 66, 'Only glyph heights and the two baseline steps between painted lines contribute');
    const output = new MetricCanvas(settings.width, settings.height);
    drawLayers(output.context, [layer], settings, 0, 4);
    const raster = output.context.paints[0].source;
    assert.equal(raster.width, 18);
    assert.equal(raster.height, 126, 'Existing raster padding and empty line spacing are unchanged');
    const glyphCorners = raster.context.paints.flatMap(paint => [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => point(paint.matrix, paint.x + x * paint.width, paint.y + y * paint.height)));
    const top = Math.min(...glyphCorners.map(corner => corner.y)), bottom = Math.max(...glyphCorners.map(corner => corner.y));
    assert.equal(shape.corners[0].y, output.context.paints[0].y + top);
    assert.equal(shape.corners[2].y, output.context.paints[0].y + bottom);
    assert.equal(hitTestLayers([layer], settings, 0, 4, shape.centerX, shape.centerY)?.layer.id, layer.id, 'The blank interior line is part of the text rectangle');
    assert.equal(hitTestLayers([layer], settings, 0, 4, shape.centerX, shape.corners[0].y - 2), null);
});

test('Aligned italic text outlines and hit rectangles share the actual rotated content offset', t => {
    fixture(t);
    for (const align of ['left', 'center', 'right']) {
        for (const rotation of [0, 45, 90]) {
            const layer = text({ text: 'j A\ng', align, rotation, spin: 'clockwise' });
            const [shape] = layerSelectionGeometry(layer, settings, 1, 4);
            assert.equal(shape.rotation, (rotation + 90) % 360);
            assert.ok(shape.height < 54, 'Content bounds omit raster-leading and fallback descent');
            assert.equal(hitTestLayers([layer], settings, 1, 4, shape.centerX, shape.centerY)?.layer.id, layer.id);
            const radians = shape.rotation * Math.PI / 180;
            assert.equal(hitTestLayers([layer], settings, 1, 4, shape.centerX + Math.cos(radians) * (shape.width / 2 + 2), shape.centerY + Math.sin(radians) * (shape.width / 2 + 2)), null);
            assert.ok(distance({ x: shape.centerX, y: shape.centerY }, { x: shape.spriteCenterX, y: shape.spriteCenterY }) > 0, 'The content center is distinct from the unchanged sprite anchor');
        }
    }
});

test('Topmost visible rectangles include text spaces and transparent images, with wrapped and spinning copies aligned', async t => {
    fixture(t);
    const below = await image({ width: 40 });
    const above = text({ text: 'A A' });
    const [shape] = layerSelectionGeometry(above, settings, 0, 4);
    assert.equal(hitTestLayers([below, above], settings, 0, 4, shape.centerX, shape.centerY)?.layer.id, above.id);
    assert.equal(hitTestLayers([below, { ...above, visible: false }], settings, 0, 4, shape.centerX, shape.centerY)?.layer.id, below.id);
    assert.equal(hitTestLayers([below, { ...above, opacity: 0 }], settings, 0, 4, shape.centerX, shape.centerY)?.layer.id, below.id);
    const wrapped = { ...below, x: 95, motion: 'right', spin: 'clockwise', rotation: 20 };
    const copies = layerSelectionGeometry(wrapped, settings, 0.1, 4);
    assert.equal(copies.length, 2);
    for (const copy of copies) {
        const x = Math.max(1, Math.min(settings.width - 1, copy.centerX));
        assert.equal(hitTestLayers([wrapped], settings, 0.1, 4, x, copy.centerY)?.layer.id, wrapped.id);
    }
});

test('Every text and image corner resizes around its fixed opposite corner in output and preview dimensions', async t => {
    fixture(t);
    for (const layer of [text({ text: 'j A\ng', rotation: 37 }), await image({ rotation: -47 })]) {
        for (const dimensions of [settings, { width: 200, height: 120 }]) {
            for (const cornerIndex of [0, 1, 2, 3]) {
                for (const factor of [0.5, 1.6]) {
                    const [shape] = layerSelectionGeometry(layer, settings, 0, 4, dimensions);
                    const result = resize(layer, shape, cornerIndex, factor, 0, dimensions);
                    assert.ok(result.residual <= 1, `${layer.type}/${cornerIndex}/${factor}: fixed corner residual ${result.residual}`);
                    assert.equal(result.next.rotation, layer.rotation);
                    assert.equal(result.next[layer.type === 'text' ? 'fontSize' : 'width'], layer[layer.type === 'text' ? 'fontSize' : 'width'] * factor);
                }
            }
        }
    }
});

test('Resizing preserves spin and movement phase, including wrapped copies and size-dependent angled paths', async t => {
    fixture(t);
    const source = await image();
    for (const motion of ['none', 'right', 'left', 'up', 'down', 'along-angle', 'against-angle']) {
        for (const rotation of [0, 37, 90, -47]) {
            for (const time of [0.3, 3.7]) {
                const layer = { ...source, motion, rotation, motionCycles: 2, spin: 'counterclockwise', spinCycles: 3 };
                const shapes = layerSelectionGeometry(layer, settings, time, 4);
                for (const shape of shapes) {
                    const result = resize(layer, shape, 2, 1.25, time);
                    assert.ok(result.partial.x >= 0 && result.partial.x <= 100 && result.partial.y >= 0 && result.partial.y <= 100);
                    if (result.partial.x > 0 && result.partial.x < 100 && result.partial.y > 0 && result.partial.y < 100)
                        assert.ok(result.residual <= 1, `${motion}/${rotation}/${time}: fixed corner residual ${result.residual}`);
                    assert.equal(result.next.spin, layer.spin);
                    assert.equal(result.next.motion, motion);
                    assert.equal(result.copies[0]?.rotation, shape.rotation);
                }
            }
        }
    }
});

test('Size limits retain the fixed corner when possible and clamp layer positions when the anchor cannot fit', async t => {
    fixture(t);
    for (const layer of [text(), await image()]) {
        const [shape] = layerSelectionGeometry(layer, settings, 0, 4);
        const key = layer.type === 'text' ? 'fontSize' : 'width';
        for (const [factor, expected] of [[0, layer.type === 'text' ? 8 : 1], [100, layer.type === 'text' ? 256 : 100]]) {
            const result = resize(layer, shape, 0, factor);
            assert.equal(result.partial[key], expected);
            assert.ok(result.partial.x >= 0 && result.partial.x <= 100 && result.partial.y >= 0 && result.partial.y <= 100);
        }
        assert.deepEqual(resize(layer, shape, 0, 1).partial, { [key]: layer[key], x: layer.x, y: layer.y }, 'No size change leaves position untouched');
        assert.deepEqual(layerResize(layer, settings, 0, 4, NaN, { ...shape.corners[0], cornerIndex: 0 }), {});
    }
    const edge = await image({ x: 0, y: 0 });
    const [shape] = layerSelectionGeometry(edge, settings, 0, 4);
    const result = resize(edge, shape, 2, 2);
    assert.equal(result.partial.x, 0);
    assert.equal(result.partial.y, 0);
});
