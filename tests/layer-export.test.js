import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS } from '../js/constants.js';
import { framePlan, videoGraph } from '../js/logic.js';
import { layerOverlayGraph } from '../js/layer-export.js';

let native = true;
try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
}
catch {
    native = false;
}

const width = 96, height = 72, fps = 24, spriteSide = 32;
const settings = { ...DEFAULTS, preset: 'custom', width, height, fps, start: 0, end: 1, method: 'natural', repeats: 5 };
const layer = { type: 'text', x: 50, y: 50, visible: true, opacity: 100, rotation: 45, motion: 'none' };
const run = (args, options = {}) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args], { maxBuffer: 8 * 1024 ** 2, ...options });

function sprite(dir, index, color, rotated = true) {
    const pixels = Buffer.alloc(spriteSide * spriteSide * 4);
    const rect = rotated ? { x: 10, y: 14, width: 12, height: 4 } : { x: 4, y: 4, width: 24, height: 24 };
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const offset = (y * spriteSide + x) * 4;
            color.forEach((value, channel) => { pixels[offset + channel] = value; });
        }
    }
    const path = join(dir, `layer-${index}.png`);
    run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${spriteSide}x${spriteSide}`, '-i', 'pipe:0', ...(rotated ? ['-vf', 'rotate=PI/4:c=none'] : []), '-frames:v', '1', path], { input: pixels });
    return { width: spriteSide, height: spriteSide, png: path };
}

function render(dir, s, sprites) {
    const frame = Buffer.alloc(width * height * 3);
    for (let offset = 0; offset < frame.length; offset += 3) {
        frame[offset] = 8;
        frame[offset + 1] = 16;
        frame[offset + 2] = 24;
    }
    const input = Buffer.concat(Array.from({ length: framePlan(s).frames }, () => frame));
    const overlay = layerOverlayGraph(s, sprites);
    const graph = [videoGraph(s), overlay.graph].filter(Boolean).join(';');
    const output = run(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0', ...overlay.inputs, '-filter_complex', graph, '-map', `[${overlay.outputLabel}]`, '-an', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { input, cwd: dir });
    const bytes = width * height * 3;
    assert.equal(output.length % bytes, 0);
    return Array.from({ length: output.length / bytes }, (_, index) => output.subarray(index * bytes, (index + 1) * bytes));
}

function redMask(frame) {
    const mask = new Set();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 3;
            if (frame[offset] > 100 && frame[offset] > frame[offset + 1] * 1.5 && frame[offset] > frame[offset + 2] * 1.5)
                mask.add(y * width + x);
        }
    }
    return mask;
}

function translated(mask, dx, dy) {
    const result = new Set();
    for (const value of mask) {
        const x = ((value % width + dx) % width + width) % width;
        const y = ((Math.floor(value / width) + dy) % height + height) % height;
        result.add(y * width + x);
    }
    return result;
}

function maskOverlap(actual, expected) {
    let intersection = 0;
    for (const value of actual)
        if (expected.has(value))
            intersection++;
    return intersection / (actual.size + expected.size - intersection);
}

test('No prepared layers preserve the original video graph and inputs', () => {
    assert.deepEqual(layerOverlayGraph(settings, []), { graph: '', inputs: [], outputLabel: 'outv' });
    assert.deepEqual(layerOverlayGraph(settings, [], 'cycle', 'composite'), { graph: '', inputs: [], outputLabel: 'cycle' });
});

test('FFmpeg moves rotated transparent layers in all four directions and wraps without disappearing', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'layer-directions-'));
    try {
        const png = sprite(dir, 0, [255, 0, 0, 255]);
        for (const [motion, dx, dy] of [['right', 4, 0], ['left', -4, 0], ['down', 0, 3], ['up', 0, -3]]) {
            const frames = render(dir, settings, [{ ...png, layer: { ...layer, motion } }]);
            assert.equal(frames.length, fps, `${motion}: one complete output cycle`);
            const initial = redMask(frames[0]);
            assert.ok(initial.size > 20, `${motion}: rotated sprite is visible`);
            const xs = [...initial].map(value => value % width), ys = [...initial].map(value => Math.floor(value / width));
            assert.ok(Math.max(...xs) - Math.min(...xs) > 6 && Math.max(...ys) - Math.min(...ys) > 6, 'The fixture is rotated, with extent on both axes');
            for (const index of [1, 6, 12, 18, 23]) {
                const actual = redMask(frames[index]), expected = translated(initial, dx * index, dy * index);
                assert.ok(maskOverlap(actual, expected) > 0.7, `${motion}: frame ${index} follows the requested direction and wraps at the canvas edge`);
                assert.ok(Math.abs(actual.size - initial.size) < initial.size * 0.25, `${motion}: no layer disappears at the wrap`);
            }
            const final = translated(redMask(frames[23]), dx, dy);
            assert.ok(maskOverlap(final, initial) > 0.7, `${motion}: advancing the final frame meets the first frame`);
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Layer animation uses the processed ping-pong duration instead of the source or export repeat duration', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'layer-period-'));
    try {
        const png = sprite(dir, 0, [255, 0, 0, 255]);
        const s = { ...settings, method: 'pingpong', format: 'gif', repeats: 7 };
        const frames = render(dir, s, [{ ...png, layer: { ...layer, motion: 'right' } }]);
        assert.equal(frames.length, 46, 'Ping-pong includes both directions of the source');
        const initial = redMask(frames[0]), midpoint = redMask(frames[23]);
        assert.ok(maskOverlap(midpoint, translated(initial, width / 2, 0)) > 0.85, 'The layer moves half a canvas over half of the complete ping-pong cycle');
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('FFmpeg preserves transparent corners, opacity and the visible layer order', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'layer-composite-'));
    try {
        const blue = sprite(dir, 0, [0, 0, 255, 255], false);
        const red = sprite(dir, 1, [255, 0, 0, 128]);
        const sprites = [{ ...blue, layer: { ...layer, type: 'image', rotation: 0 } }, { ...red, layer: { ...layer, opacity: 50 } }];
        const frames = render(dir, settings, sprites);
        const pixel = (x, y) => [...frames[0].subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
        const center = pixel(width / 2, height / 2);
        assert.ok(center[0] > 100 && center[2] > 100 && center[1] < 20, `The half-opacity red layer blends over the blue image: ${center}`);
        const lowerOnly = pixel(width / 2 + 9, height / 2 + 9);
        assert.ok(lowerOnly[2] > 220 && lowerOnly[0] < 20, `Transparent rotated corners retain the lower layer: ${lowerOnly}`);
        const background = pixel(width / 2 + 15, height / 2 + 15);
        assert.ok(background.every((value, channel) => Math.abs(value - [8, 16, 24][channel]) <= 3), `Transparent corners retain the video: ${background}`);
        assert.deepEqual(frames[23], frames[0], 'Static layers remain still across the cycle');
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Sprites wider or taller than two video frames retain every periodic copy', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'layer-long-sprite-'));
    try {
        for (const horizontal of [true, false]) {
            const spriteWidth = horizontal ? width * 5 : 16, spriteHeight = horizontal ? 16 : height * 5;
            const pixels = Buffer.alloc(spriteWidth * spriteHeight * 4);
            const left = horizontal ? 10 : 4, top = horizontal ? 4 : 10;
            for (let y = top; y < top + (horizontal ? 8 : 12); y++) {
                for (let x = left; x < left + (horizontal ? 12 : 8); x++) {
                    const offset = (y * spriteWidth + x) * 4;
                    pixels[offset] = 255;
                    pixels[offset + 3] = 255;
                }
            }
            const png = join(dir, 'layer-0.png');
            run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${spriteWidth}x${spriteHeight}`, '-i', 'pipe:0', '-frames:v', '1', png], { input: pixels });
            const motion = horizontal ? 'right' : 'down';
            const frames = render(dir, settings, [{ width: spriteWidth, height: spriteHeight, png, layer: { ...layer, motion, rotation: 0 } }]);
            assert.equal(frames.length, fps);
            const initial = redMask(frames[0]);
            assert.ok(initial.size > 40, `${motion}: a distant glyph in a long sprite remains visible through periodic copies`);
            for (const index of [6, 12, 18, 23]) {
                const expected = translated(initial, horizontal ? index * 4 : 0, horizontal ? 0 : index * 3);
                assert.ok(maskOverlap(redMask(frames[index]), expected) > 0.75, `${motion}: long sprites remain periodic at frame ${index}`);
            }
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
