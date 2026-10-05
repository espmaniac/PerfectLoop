import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextLayer, duplicateLayer, importImageLayer, discardImportedImageLayer, clearLayerAssets, layerPosition, rasterizeLayers, validateLayers, MAX_LAYERS, MAX_TEXT_LENGTH } from '../js/layers.js';

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
