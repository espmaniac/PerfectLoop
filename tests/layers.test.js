import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextLayer, duplicateLayer, importImageLayer, discardImportedImageLayer, clearLayerAssets, angleTrajectory, layerPosition, layerRotation, animationCycles, animationProgress, rasterizeLayers, validateLayers, MAX_LAYERS, MAX_TEXT_LENGTH, MAX_ANIMATION_CYCLES } from '../js/layers.js';
import { importFontFile, clearFonts, fontOptions } from '../js/fonts.js';

test('Layers retain their settings when duplicated and receive independent IDs', () => {
    const original = Object.freeze({ ...createTextLayer(), text: 'Rotating title', rotation: 37, opacity: 65, x: 20, y: 80, motion: 'up' });
    const copy = duplicateLayer(original);
    assert.ok(Object.isFrozen(original) && Object.isFrozen(copy));
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.name, `${original.name} copy`);
    const { id, name, ...originalSettings } = original;
    const { id: copyId, name: copyName, ...copiedSettings } = copy;
    assert.deepEqual(copiedSettings, originalSettings);
    assert.deepEqual(validateLayers([original, copy]), []);

    const image = { ...original, type: 'image', name: 'Photo', assetId: 'shared-photo', width: 30 };
    const imageCopy = duplicateLayer(image);
    assert.notEqual(imageCopy.id, image.id);
    assert.equal(imageCopy.assetId, image.assetId, 'Duplicating an image retains its pixels');
});

test('Duplicated gradient layers own separate fill and stop settings', () => {
    const fill = Object.freeze({ type: 'linear', angle: 37, stops: Object.freeze([
        Object.freeze({ color: '#ff0000', opacity: 50, position: 0 }),
        Object.freeze({ color: '#0000ff', opacity: 100, position: 100 }),
    ]) });
    const original = Object.freeze({ ...createTextLayer(), fill, spin: 'clockwise', motion: 'along-angle', motionCycles: 2, spinCycles: 3 });
    const copy = duplicateLayer(original);
    assert.notEqual(copy.fill, original.fill);
    assert.notEqual(copy.fill.stops, original.fill.stops);
    assert.notEqual(copy.fill.stops[0], original.fill.stops[0]);
    assert.deepEqual(copy.fill, original.fill);
    copy.fill.angle = 90;
    copy.fill.stops[0].color = '#00ff00';
    copy.fill.stops[0].opacity = 0;
    copy.fill.stops.push({ color: '#ffffff', opacity: 100, position: 50 });
    assert.equal(original.fill.angle, 37);
    assert.equal(original.fill.stops[0].color, '#ff0000');
    assert.equal(original.fill.stops[0].opacity, 50);
    assert.equal(original.fill.stops.length, 2);
    assert.equal(copy.motionCycles, 2);
    assert.equal(copy.spinCycles, 3);
    assert.deepEqual(validateLayers([original, copy]), []);
});

test('Text fill validation preserves legacy color settings and protects inactive malformed fills', async () => {
    const initial = createTextLayer();
    assert.deepEqual(validateLayers([initial]), []);
    assert.ok(validateLayers([{ ...initial, color: 'invalid' }]).some(issue => /color/i.test(issue)));
    const solid = { type: 'solid', color: '#0080ff', opacity: 50 };
    assert.deepEqual(validateLayers([{ ...initial, color: 'unused legacy value', fill: solid }]), [], 'An explicit fill controls its own color');
    const withoutLegacyColor = { ...initial, fill: solid };
    delete withoutLegacyColor.color;
    assert.deepEqual(validateLayers([withoutLegacyColor]), []);
    const gradient = { type: 'radial', centerX: 20, centerY: 80, radius: 125, stops: Array.from({ length: 257 }, (_, index) => ({ color: index % 2 ? '#ff0000' : '#0000ff', opacity: index % 2 ? 0 : 100, position: index / 256 * 100 })) };
    assert.deepEqual(validateLayers([{ ...initial, fill: gradient }]), [], 'Layers retain every user-added color stop');
    for (const fill of [null, { ...solid, opacity: NaN }, { ...gradient, radius: 0 }, { ...gradient, stops: [] }, { ...gradient, stops: [{ color: '#ff0000', opacity: 100, position: 0 }, null] }]) {
        const invalid = { ...initial, visible: false, opacity: 0, fill };
        assert.ok(validateLayers([invalid]).length > 0);
        await assert.rejects(rasterizeLayers([invalid], { width: 96, height: 72 }), /fill|color|opacity|gradient/i, 'Export cannot preserve an invalid hidden fill');
    }
});

test('Text and image movement follow all four frame directions independently of rotation', () => {
    const width = 320, height = 180, period = 4;
    const expected = {
        right: { x: 160, y: 135 },
        left: { x: 0, y: 135 },
        down: { x: 80, y: 0 },
        up: { x: 80, y: 90 },
    };
    for (const type of ['text', 'image']) {
        for (const rotation of [0, 37, 90, -135, 360]) {
            for (const motion of ['right', 'left', 'down', 'up']) {
                const layer = { ...createTextLayer(), type, rotation, motion, x: 25, y: 75 };
                assert.deepEqual(layerPosition(layer, width, height, 0, period), { x: 80, y: 135 });
                assert.deepEqual(layerPosition(layer, width, height, 1, period), expected[motion], `${type}, ${rotation}°, ${motion}: quarter-cycle position`);
                assert.deepEqual(layerPosition(layer, width, height, period, period), { x: 80, y: 135 }, `${motion}: the end meets the start`);
                assert.deepEqual(layerPosition(layer, width, height, 5, period), expected[motion], `${motion}: repeated cycles retain the same phase`);
                assert.deepEqual(layerPosition(layer, width, height, -3, period), expected[motion], `${motion}: negative seek time retains periodic coordinates`);
                const nearEnd = layerPosition(layer, width, height, period - 0.001, period);
                assert.ok(Math.abs(nearEnd.x - 80) < 0.081 && Math.abs(nearEnd.y - 135) < 0.046, `${motion}: approaching the boundary approaches the first frame`);
            }
        }
    }
});

test('Static layers and an unavailable cycle preserve their configured position', () => {
    const base = { ...createTextLayer(), x: 100, y: 0, rotation: 45 };
    for (const time of [0, 1, 100, -1])
        assert.deepEqual(layerPosition(base, 640, 360, time, 3), { x: 640, y: 0 });
    for (const period of [0, -1, NaN, Infinity])
        assert.deepEqual(layerPosition({ ...base, motion: 'right' }, 640, 360, 1, period), { x: 640, y: 0 });
    assert.deepEqual(layerPosition({ ...base, motion: 'down' }, 640, 360, NaN, 3), { x: 640, y: 0 });
});

test('Spin completes one turn from the configured angle in either direction and accepts older layers', () => {
    const initial = createTextLayer();
    assert.equal(initial.spin, 'none');
    const legacy = { ...initial, rotation: -37 };
    delete legacy.spin;
    assert.deepEqual(validateLayers([legacy]), []);
    for (const time of [0, 1, 3.999, 4, 100]) {
        assert.equal(layerRotation(legacy, time, 4), 323);
        assert.equal(layerRotation({ ...legacy, spin: 'none' }, time, 4), 323);
    }
    for (const type of ['text', 'image']) {
        for (const [spin, expected] of [['clockwise', [37, 127, 217, 307, 37]], ['counterclockwise', [37, 307, 217, 127, 37]]]) {
            const layer = { ...initial, type, rotation: 37, spin };
            for (const [index, time] of [0, 1, 2, 3, 4].entries())
                assert.equal(layerRotation(layer, time, 4), expected[index]);
            assert.equal(layerRotation(layer, 9, 4), expected[1], 'Repeated cycles retain their phase');
            assert.equal(layerRotation(layer, -3, 4), expected[1], 'Negative seek time retains its periodic angle');
            const before = layerRotation(layer, 3.999, 4), difference = Math.min(Math.abs(before - 37), 360 - Math.abs(before - 37));
            assert.ok(difference < 0.091, 'The final angle approaches the starting angle continuously');
            for (const period of [0, -1, NaN, Infinity])
                assert.equal(layerRotation(layer, 1, period), 37);
            for (const time of [NaN, Infinity, -Infinity])
                assert.equal(layerRotation(layer, time, 4), 37);
        }
    }
    for (const spin of ['clockwise', 'counterclockwise'])
        assert.deepEqual(validateLayers([{ ...initial, spin }]), []);
    assert.ok(validateLayers([{ ...initial, spin: 'random' }]).some(issue => /spin/i.test(issue)));
});

test('Spin is independent of movement and duplication preserves both animation settings', () => {
    const initial = Object.freeze({ ...createTextLayer(), rotation: 37, spin: 'clockwise', motion: 'along-angle' });
    const copy = duplicateLayer(initial);
    assert.notEqual(copy.id, initial.id);
    assert.equal(copy.spin, initial.spin);
    assert.equal(copy.motion, initial.motion);
    const edited = Object.freeze({ ...copy, spin: 'counterclockwise', motion: 'up' });
    assert.equal(initial.spin, 'clockwise');
    assert.equal(initial.motion, 'along-angle');
    assert.equal(copy.spin, 'clockwise', 'Editing a duplicated layer leaves the stored original settings intact');
    assert.equal(edited.rotation, 37);
    for (const motion of ['none', 'right', 'left', 'down', 'up', 'along-angle', 'against-angle']) {
        const moving = { ...initial, motion };
        assert.equal(layerRotation(moving, 1, 4), 127, 'Movement never changes the spin phase');
        const bounds = { width: 45, height: 45 };
        const position = layerPosition(moving, 320, 180, 1, 4, bounds);
        assert.deepEqual(layerPosition({ ...moving, spin: 'counterclockwise' }, 320, 180, 1, 4, bounds), position);
        assert.deepEqual(layerPosition({ ...moving, spin: 'none' }, 320, 180, 1, 4, bounds), position, 'Spin never changes the movement phase for the same safe sprite bounds');
    }
});

test('Movement and spin cycle counts default independently, survive duplication, and reject invalid inactive settings', async () => {
    const initial = createTextLayer();
    assert.equal(initial.motionCycles, 1);
    assert.equal(initial.spinCycles, 1);
    const legacy = { ...initial };
    delete legacy.motionCycles;
    delete legacy.spinCycles;
    assert.equal(animationCycles(legacy, 'motion'), 1);
    assert.equal(animationCycles(legacy, 'spin'), 1);
    assert.deepEqual(validateLayers([legacy]), []);
    const original = Object.freeze({ ...initial, motion: 'right', spin: 'clockwise', motionCycles: 2, spinCycles: 3 });
    const copy = duplicateLayer(original);
    assert.equal(copy.motionCycles, 2);
    assert.equal(copy.spinCycles, 3);
    const edited = Object.freeze({ ...copy, motionCycles: 3, spinCycles: 10 });
    assert.equal(original.motionCycles, 2);
    assert.equal(original.spinCycles, 3);
    assert.equal(copy.motionCycles, 2);
    assert.equal(edited.spinCycles, MAX_ANIMATION_CYCLES);
    for (const field of ['motionCycles', 'spinCycles']) {
        for (const count of [1, 2, 3, MAX_ANIMATION_CYCLES])
            assert.deepEqual(validateLayers([{ ...initial, [field]: count }]), []);
        for (const value of [null, '2', '', NaN, Infinity, -Infinity, 0, -1, 1.5, MAX_ANIMATION_CYCLES + 1]) {
            const invalid = { ...initial, [field]: value, visible: false, opacity: 0 };
            assert.equal(animationCycles(invalid, field === 'motionCycles' ? 'motion' : 'spin'), 1, 'Partially edited settings preserve a valid preview rate');
            assert.ok(validateLayers([invalid]).some(issue => /cycles must be a whole number/i.test(issue)));
            await assert.rejects(rasterizeLayers([invalid], { width: 96, height: 72 }), /cycles must be a whole number/i, 'Inactive hidden layers still receive export validation');
        }
    }
});

test('Multiple movement and spin cycles complete their subcycles independently and preserve the full-period boundary', () => {
    const close = (actual, expected) => Math.abs(actual.x - expected.x) < 1e-7 && Math.abs(actual.y - expected.y) < 1e-7;
    const angleDifference = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    const period = 6, bounds = { width: 45, height: 45 };
    for (const type of ['text', 'image']) {
        for (const count of [2, 3, 10]) {
            for (const motion of ['right', 'left', 'down', 'up', 'along-angle', 'against-angle']) {
                const single = { ...createTextLayer(), type, motion, rotation: 37, x: 35, y: 65, motionCycles: 1 };
                const faster = { ...single, motionCycles: count, spinCycles: 3, spin: 'clockwise' };
                const initial = layerPosition(faster, 320, 180, 0, period, bounds);
                const subcycle = period / count;
                assert.ok(close(layerPosition(faster, 320, 180, subcycle, period, bounds), initial), `${type}, ${motion}, ${count} cycles: one subcycle returns to its start`);
                assert.deepEqual(layerPosition(faster, 320, 180, period, period, bounds), initial);
                for (const time of [subcycle / 4, period / 5, period - 0.0001, -subcycle / 4, period * 2 + subcycle / 4]) {
                    const actual = layerPosition(faster, 320, 180, time, period, bounds);
                    const expected = layerPosition(single, 320, 180, time * count, period, bounds);
                    assert.ok(close(actual, expected), `${type}, ${motion}, ${count} cycles: phase agrees with repeated traversal`);
                    assert.deepEqual(layerPosition({ ...faster, spinCycles: 10 }, 320, 180, time, period, bounds), actual, 'Changing rotation rate never changes movement');
                }
                const before = layerPosition(faster, 320, 180, period - 0.0001, period, bounds);
                assert.ok(Math.hypot(before.x - initial.x, before.y - initial.y) < 0.08, 'The last traversal still approaches the first frame continuously');
            }
            for (const [spin, direction] of [['clockwise', 1], ['counterclockwise', -1]]) {
                const faster = { ...createTextLayer(), type, rotation: 37, spin, spinCycles: count, motionCycles: 2, motion: 'right' };
                const subcycle = period / count;
                assert.ok(angleDifference(layerRotation(faster, subcycle / 4, period), (37 + direction * 90 + 360) % 360) < 1e-7);
                assert.ok(angleDifference(layerRotation(faster, subcycle, period), 37) < 1e-7);
                assert.equal(layerRotation(faster, period, period), 37);
                assert.ok(angleDifference(layerRotation(faster, -subcycle / 4, period), (37 - direction * 90 + 360) % 360) < 1e-7);
                assert.ok(angleDifference(layerRotation(faster, period - 0.0001, period), 37) < 0.061);
                assert.equal(layerRotation({ ...faster, motionCycles: 10 }, subcycle / 4, period), layerRotation(faster, subcycle / 4, period), 'Changing movement rate never changes rotation');
            }
        }
    }
});

test('Exact thirds restore the identical phase and odd sprite position without freezing nearby movement', () => {
    const bounds = { width: 45, height: 45 };
    for (const period of [1, 17 / 24, 118 / 60, 1.23456789]) {
        for (const time of [period / 3, 2 * period / 3, -period / 3, period])
            assert.equal(animationProgress(time, period, 3), 0, 'Exact subcycle boundaries eliminate floating-point residue');
        const after = animationProgress(period / 3 + period * 1e-10 / 3, period, 3);
        const before = animationProgress(period / 3 - period * 1e-10 / 3, period, 3);
        assert.ok(after > 5e-11 && after < 1.5e-10, 'Movement outside the narrow precision tolerance continues');
        assert.ok(before > 1 - 1.5e-10 && before < 1 - 5e-11);
        for (const motion of ['right', 'left', 'down', 'up', 'along-angle', 'against-angle']) {
            for (const spin of ['clockwise', 'counterclockwise']) {
                const layer = { ...createTextLayer(), rotation: 37, motion, spin, motionCycles: 3, spinCycles: 3 };
                const initial = layerPosition(layer, 96, 72, 0, period, bounds);
                for (const time of [period / 3, 2 * period / 3, -period / 3, period]) {
                    const point = layerPosition(layer, 96, 72, time, period, bounds);
                    assert.deepEqual(point, initial, 'Every exact subcycle uses the identical geometry coefficients');
                    assert.equal(Math.round(point.x - bounds.width / 2), Math.round(initial.x - bounds.width / 2));
                    assert.equal(Math.round(point.y - bounds.height / 2), Math.round(initial.y - bounds.height / 2));
                    assert.equal(layerRotation(layer, time, period), 37);
                }
            }
        }
    }
});

test('Image validation reserves the full diagonal for every angle of a spinning sprite', async () => {
    const previousDecoder = globalThis.createImageBitmap;
    let closes = 0;
    globalThis.createImageBitmap = async () => ({ width: 4000, height: 2000, close() { closes++; } });
    try {
        const image = await importImageLayer({ name: 'wide.png', type: 'image/png', size: 100 });
        assert.equal(image.spin, 'none');
        const settings = { width: 3840, height: 2160 };
        const staticImage = { ...image, width: 100 };
        assert.deepEqual(validateLayers([staticImage], settings), [], 'The unrotated image fits within the sprite limit');
        for (const spin of ['clockwise', 'counterclockwise']) {
            const spinning = { ...staticImage, spin };
            assert.ok(validateLayers([spinning], settings).some(issue => /too large/i.test(issue)), 'A full turn must fit its diagonal, even when the starting angle fits');
            await assert.rejects(rasterizeLayers([spinning], settings), /too large/i);
        }
        assert.deepEqual(validateLayers([{ ...staticImage, width: 80, spin: 'clockwise' }], settings), [], 'Reducing the layer size makes the full rotation safe');
    }
    finally {
        clearLayerAssets();
        if (previousDecoder === undefined)
            delete globalThis.createImageBitmap;
        else
            globalThis.createImageBitmap = previousDecoder;
    }
    assert.equal(closes, 1);
});

test('Along-angle and against-angle movement use the physical angle for text and images in every aspect ratio', () => {
    for (const type of ['text', 'image']) {
        for (const [width, height] of [[320, 180], [180, 320], [640, 360], [360, 640]]) {
            for (const rotation of [0, 37, 135, 90, 89.9999, 90.0001, -37, 180]) {
                for (const [motion, direction] of [['along-angle', 1], ['against-angle', -1]]) {
                    const layer = { ...createTextLayer(), type, rotation, motion, x: 35, y: 65 };
                    const bounds = { width: width / 10, height: height / 10 };
                    const trajectory = angleTrajectory(layer, width, height, bounds.width, bounds.height);
                    assert.ok(trajectory && trajectory.distance > 0 && Number.isFinite(trajectory.distance));
                    const radians = rotation * Math.PI / 180;
                    assert.ok(Math.abs(trajectory.dx - direction * Math.cos(radians)) < 1e-11);
                    assert.ok(Math.abs(trajectory.dy - direction * Math.sin(radians)) < 1e-11);
                    assert.ok(Math.abs(Math.hypot(trajectory.dx, trajectory.dy) - 1) < 1e-11, 'The travel direction is a pixel-space unit vector');
                    const initial = layerPosition(layer, width, height, 0, 4, bounds);
                    const next = layerPosition(layer, width, height, 0.04, 4, bounds);
                    const step = { x: next.x - initial.x, y: next.y - initial.y };
                    const length = Math.hypot(step.x, step.y);
                    assert.ok(length > 0);
                    assert.ok(Math.abs(step.x / length - direction * Math.cos(radians)) < 1e-10 && Math.abs(step.y / length - direction * Math.sin(radians)) < 1e-10, `${type}, ${width}×${height}, ${rotation}°, ${motion}: movement follows the visible angle`);
                }
            }
        }
    }
});

test('Angle paths wrap only beyond the entire rotated sprite, including off-center and oversized layers', () => {
    const overlaps = (point, bounds, width, height) => point.x + bounds.width / 2 > 1e-8 && point.x - bounds.width / 2 < width - 1e-8 && point.y + bounds.height / 2 > 1e-8 && point.y - bounds.height / 2 < height - 1e-8;
    for (const [width, height] of [[320, 180], [180, 320]]) {
        for (const [x, y] of [[50, 50], [20, 80], [80, 25]]) {
            for (const bounds of [{ width: 40, height: 24 }, { width: width * 3, height: height * 2 }]) {
                for (const rotation of [37, 135, 90, 89.9999, 90.0001]) {
                    const forward = { ...createTextLayer(), x, y, rotation, motion: 'along-angle' };
                    const reverse = { ...forward, motion: 'against-angle' };
                    const path = angleTrajectory(forward, width, height, bounds.width, bounds.height);
                    const backwards = angleTrajectory(reverse, width, height, bounds.width, bounds.height);
                    assert.ok(Math.abs(path.distance - backwards.distance) < 1e-7, 'Reversing preserves the same visible line interval');
                    const start = { x: path.x + path.dx * path.min, y: path.y + path.dy * path.min };
                    const end = { x: path.x + path.dx * (path.min + path.distance), y: path.y + path.dy * (path.min + path.distance) };
                    assert.equal(overlaps(start, bounds, width, height), false, 'The entire sprite has exited before re-entry');
                    assert.equal(overlaps(end, bounds, width, height), false, 'The outgoing sprite is outside before the scalar wrap');
                    const inside = { x: path.x + path.dx * (path.min + path.distance / 2), y: path.y + path.dy * (path.min + path.distance / 2) };
                    assert.equal(overlaps(inside, bounds, width, height), true);
                    const initial = layerPosition(forward, width, height, 0, 4, bounds);
                    assert.ok(Math.abs(initial.x - x / 100 * width) < 1e-8 && Math.abs(initial.y - y / 100 * height) < 1e-8);
                    const fullCycle = layerPosition(forward, width, height, 4, 4, bounds);
                    assert.deepEqual(fullCycle, initial);
                    const before = layerPosition(forward, width, height, 4 - 0.001, 4, bounds);
                    assert.ok(Math.hypot(before.x - initial.x, before.y - initial.y) < path.distance * 0.000251, 'Movement approaches the first frame continuously');
                    const forwardStep = layerPosition(forward, width, height, 0.04, 4, bounds);
                    const reverseStep = layerPosition(reverse, width, height, 0.04, 4, bounds);
                    assert.ok(Math.abs(forwardStep.x + reverseStep.x - 2 * initial.x) < 1e-7 && Math.abs(forwardStep.y + reverseStep.y - 2 * initial.y) < 1e-7, 'Against-angle moves along the same line in the opposite direction');
                }
            }
        }
    }
});

test('Angle paths retain their pixel geometry when output and sprite dimensions scale together', () => {
    const layer = { ...createTextLayer(), x: 20, y: 80, rotation: 37, motion: 'along-angle' };
    const bounds = { width: 40, height: 24 }, doubled = { width: 80, height: 48 };
    const path = angleTrajectory(layer, 320, 180, bounds.width, bounds.height);
    const expanded = angleTrajectory(layer, 320, 180, 0, 0);
    assert.ok(path.distance > expanded.distance, 'Sprite dimensions extend the exit and re-entry beyond center-only clipping');
    for (const time of [0, 0.5, 1.5, 2.7, 3.999, 4, 8]) {
        const small = layerPosition(layer, 320, 180, time, 4, bounds);
        const large = layerPosition(layer, 640, 360, time, 4, doubled);
        assert.ok(Math.abs(large.x - 2 * small.x) < 1e-7 && Math.abs(large.y - 2 * small.y) < 1e-7);
    }
    for (const motion of ['none', 'right', 'left', 'up', 'down'])
        assert.equal(angleTrajectory({ ...layer, motion }, 320, 180, 40, 24), null, 'Screen-axis motions retain their existing path');
    for (const motion of ['along-angle', 'against-angle'])
        assert.deepEqual(validateLayers([{ ...createTextLayer(), motion }]), [], 'Both angle directions can be exported');
});

test('Hidden or zero-opacity layers produce no export sprites; invalid edits cannot be exported', async () => {
    const settings = { width: 640, height: 360 };
    const hidden = { ...createTextLayer(), visible: false };
    const transparent = { ...createTextLayer(), opacity: 0 };
    assert.deepEqual(await rasterizeLayers([hidden, transparent], settings), []);
    assert.deepEqual(await rasterizeLayers([], settings), []);
    for (const update of [{ text: '' }, { text: 'a'.repeat(MAX_TEXT_LENGTH + 1) }, { rotation: NaN }, { motion: 'diagonal' }, { fontSize: 257 }, { opacity: -1 }, { x: Infinity }]) {
        const invalid = { ...hidden, ...update };
        assert.ok(validateLayers([invalid]).length > 0);
        await assert.rejects(rasterizeLayers([invalid], settings), Error, 'Validation also protects inactive layers from being saved as an invalid export');
    }
    const unavailable = { ...createTextLayer(), type: 'image', assetId: 'removed-asset', width: 30 };
    await assert.rejects(rasterizeLayers([unavailable], settings), /unavailable/i);
});

test('Validation prevents duplicate layer IDs, excessive layer counts and unsupported image imports', async () => {
    const first = createTextLayer();
    assert.ok(validateLayers([first, { ...first }]).some(issue => /unique/i.test(issue)));
    assert.ok(validateLayers(Array.from({ length: MAX_LAYERS + 1 }, () => createTextLayer())).some(issue => /no more than/i.test(issue)));
    assert.deepEqual(validateLayers([{ ...first, fontSize: 8, x: 0, y: 100, opacity: 0, rotation: -360 }]), []);
    assert.deepEqual(validateLayers([{ ...first, fontSize: 256, opacity: 100, rotation: 360, text: 'a'.repeat(MAX_TEXT_LENGTH) }]), []);
    await assert.rejects(importImageLayer({ name: 'vector.svg', type: 'image/svg+xml', size: 10 }), /PNG, JPEG, WebP, or GIF/i);
    await assert.rejects(importImageLayer({ name: 'huge.png', type: 'image/png', size: 21 * 1024 ** 2 }), /smaller than 20 MB/i);
});

test('Text layers accept registered fonts through duplication and reject unavailable font IDs', async () => {
    const previousFace = Object.getOwnPropertyDescriptor(globalThis, 'FontFace'), previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    class Face {
        constructor(family) { this.family = family; }
        async load() { return this; }
    }
    Object.defineProperty(globalThis, 'FontFace', { configurable: true, writable: true, value: Face });
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { fonts: { add() {}, delete() {} } } });
    clearFonts();
    try {
        for (const option of fontOptions())
            assert.deepEqual(validateLayers([{ ...createTextLayer(), fontFamily: option.id }]), [], 'Known generic and bundled IDs remain valid settings before decoding');
        const font = await importFontFile({ name: 'Layer title.woff2', size: 4, arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer });
        const original = Object.freeze({ ...createTextLayer(), fontFamily: font.id });
        const copy = duplicateLayer(original);
        assert.equal(copy.fontFamily, original.fontFamily);
        assert.deepEqual(validateLayers([original, copy]), [], 'The retained registry supports original and duplicated layer settings');
        assert.ok(validateLayers([{ ...original, fontFamily: 'unregistered-family' }]).some(issue => /font/i.test(issue)));
        assert.ok(validateLayers([{ ...original, fontFamily: 'serif; url(example)' }]).some(issue => /font/i.test(issue)));
        clearFonts();
        assert.ok(validateLayers([original]).some(issue => /font/i.test(issue)), 'A stale font reference cannot silently select a fallback');
        assert.deepEqual(validateLayers([createTextLayer()]), [], 'Legacy generic defaults remain usable after cleanup');
    }
    finally {
        clearFonts();
        if (previousFace)
            Object.defineProperty(globalThis, 'FontFace', previousFace);
        else
            delete globalThis.FontFace;
        if (previousDocument)
            Object.defineProperty(globalThis, 'document', previousDocument);
        else
            delete globalThis.document;
    }
});

test('Export awaits font decoding before measuring text and a failed decode cannot cache fallback pixels', async () => {
    const previousFace = Object.getOwnPropertyDescriptor(globalThis, 'FontFace'), previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    let rejectDecode, notifyStarted, measurements = 0, installed = false, retry = false;
    const decoding = new Promise((resolve, reject) => { rejectDecode = reject; });
    const started = new Promise(resolve => { notifyStarted = resolve; });
    class Face {
        async load() {
            notifyStarted();
            if (!retry)
                await decoding;
            return this;
        }
    }
    Object.defineProperty(globalThis, 'FontFace', { configurable: true, writable: true, value: Face });
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: {
        fonts: { add() { installed = true; }, delete() {} },
        createElement() {
            measurements++;
            assert.ok(installed, 'Text metrics are requested only after the font is installed');
            throw new Error('This test does not provide a canvas');
        },
    } });
    clearFonts();
    try {
        const id = fontOptions().find(option => option.source === 'bundled').id;
        const text = { ...createTextLayer(), fontFamily: id };
        const exportPromise = rasterizeLayers([text], { width: 96, height: 72 });
        const rejected = assert.rejects(exportPromise, /font.*could not be loaded/i);
        await started;
        assert.equal(measurements, 0, 'Pending decoding does not measure a fallback font');
        rejectDecode(new SyntaxError('Corrupt font bytes'));
        await rejected;
        assert.equal(measurements, 0, 'A failed font cannot create a sprite or cache fallback metrics');
        retry = true;
        await assert.rejects(rasterizeLayers([text], { width: 96, height: 72 }), /canvas/i);
        assert.ok(measurements > 0, 'A successful retry reaches text measurement instead of reusing fallback pixels');
    }
    finally {
        clearFonts();
        clearLayerAssets();
        if (previousFace)
            Object.defineProperty(globalThis, 'FontFace', previousFace);
        else
            delete globalThis.FontFace;
        if (previousDocument)
            Object.defineProperty(globalThis, 'document', previousDocument);
        else
            delete globalThis.document;
    }
});

test('Cancelled image imports release their bitmap once while retained duplicates share their asset', async () => {
    const previousDecoder = globalThis.createImageBitmap;
    const closes = { cancelled: 0, retained: 0 };
    globalThis.createImageBitmap = async file => ({ width: 20, height: 20, close() { closes[file.name]++; } });
    try {
        const cancelled = await importImageLayer({ name: 'cancelled', type: 'image/png', size: 100 });
        assert.deepEqual(validateLayers([cancelled]), []);
        discardImportedImageLayer(cancelled);
        discardImportedImageLayer(cancelled);
        assert.equal(closes.cancelled, 1, 'Repeated cancellation does not close an already-released bitmap');
        assert.ok(validateLayers([cancelled]).some(issue => /unavailable/i.test(issue)));

        const retained = await importImageLayer({ name: 'retained', type: 'image/png', size: 100 });
        const copy = duplicateLayer(retained);
        assert.equal(copy.assetId, retained.assetId);
        assert.deepEqual(validateLayers([retained, copy]), []);
        assert.equal(closes.retained, 0, 'The original and duplicate retain their shared bitmap');
        clearLayerAssets();
        assert.deepEqual(closes, { cancelled: 1, retained: 1 }, 'Clearing all assets closes the shared retained bitmap exactly once');
    }
    finally {
        clearLayerAssets();
        if (previousDecoder === undefined)
            delete globalThis.createImageBitmap;
        else
            globalThis.createImageBitmap = previousDecoder;
    }
});
