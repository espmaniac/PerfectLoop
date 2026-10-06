import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextLayer, duplicateLayer, importImageLayer, discardImportedImageLayer, clearLayerAssets, angleTrajectory, layerPosition, rasterizeLayers, validateLayers, MAX_LAYERS, MAX_TEXT_LENGTH } from '../js/layers.js';

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
