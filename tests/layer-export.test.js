import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS } from '../js/constants.js';
import { framePlan, videoGraph } from '../js/logic.js';
import { layerOverlayGraph } from '../js/layer-export.js';
import { angleTrajectory, layerPosition } from '../js/layers.js';

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

function sprite(dir, index, color, rotated = true, rotation = 45) {
    const pixels = Buffer.alloc(spriteSide * spriteSide * 4);
    const rect = rotated ? { x: 10, y: 14, width: 12, height: 4 } : { x: 4, y: 4, width: 24, height: 24 };
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            const offset = (y * spriteSide + x) * 4;
            color.forEach((value, channel) => { pixels[offset + channel] = value; });
        }
    }
    const path = join(dir, `layer-${index}.png`);
    run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${spriteSide}x${spriteSide}`, '-i', 'pipe:0', ...(rotated ? ['-vf', `rotate=${rotation}*PI/180:c=none`] : []), '-frames:v', '1', path], { input: pixels });
    return { width: spriteSide, height: spriteSide, png: path };
}

function spinSprite(dir, opacity = 255) {
    const contentWidth = 40, contentHeight = 8, side = Math.ceil(Math.hypot(contentWidth, contentHeight)) + 4;
    const pixels = Buffer.alloc(side * side * 4), left = Math.floor((side - contentWidth) / 2), top = Math.floor((side - contentHeight) / 2);
    for (let y = top; y < top + contentHeight; y++) {
        for (let x = left; x < left + contentWidth; x++) {
            const offset = (y * side + x) * 4;
            pixels[offset + (x >= left + contentWidth - 4 ? 2 : 0)] = 255;
            pixels[offset + 3] = opacity;
        }
    }
    const png = join(dir, 'layer-0.png');
    run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${side}x${side}`, '-i', 'pipe:0', '-frames:v', '1', png], { input: pixels });
    return { width: side, height: side, png };
}

function render(dir, s, sprites, extraFrames = 0) {
    const frame = Buffer.alloc(s.width * s.height * 3);
    for (let offset = 0; offset < frame.length; offset += 3) {
        frame[offset] = 8;
        frame[offset + 1] = 16;
        frame[offset + 2] = 24;
    }
    const input = Buffer.concat(Array.from({ length: framePlan(s).frames + extraFrames }, () => frame));
    const overlay = layerOverlayGraph(s, sprites);
    const graph = [videoGraph(s), overlay.graph].filter(Boolean).join(';');
    const output = run(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${s.width}x${s.height}`, '-r', String(s.fps), '-i', 'pipe:0', ...overlay.inputs, '-filter_complex', graph, '-map', `[${overlay.outputLabel}]`, '-an', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { input, cwd: dir });
    const bytes = s.width * s.height * 3;
    assert.equal(output.length % bytes, 0);
    return Array.from({ length: output.length / bytes }, (_, index) => output.subarray(index * bytes, (index + 1) * bytes));
}

function redMask(frame, frameWidth = width, frameHeight = height) {
    const mask = new Set();
    for (let y = 0; y < frameHeight; y++) {
        for (let x = 0; x < frameWidth; x++) {
            const offset = (y * frameWidth + x) * 3;
            if (frame[offset] > 100 && frame[offset] > frame[offset + 1] * 1.5 && frame[offset] > frame[offset + 2] * 1.5)
                mask.add(y * frameWidth + x);
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

function blueMask(frame) {
    const mask = new Set();
    for (let index = 0; index < frame.length / 3; index++) {
        const offset = index * 3;
        if (frame[offset + 2] > 100 && frame[offset + 2] > frame[offset] * 1.5 && frame[offset + 2] > frame[offset + 1] * 1.5)
            mask.add(index);
    }
    return mask;
}

function markerDirection(frame) {
    const center = mask => {
        assert.ok(mask.size > 5, 'Both ends of the transparent asymmetric sprite remain visible');
        let x = 0, y = 0;
        for (const value of mask) {
            x += value % width;
            y += Math.floor(value / width);
        }
        return { x: x / mask.size, y: y / mask.size };
    };
    const body = center(redMask(frame)), tip = center(blueMask(frame));
    const dx = tip.x - body.x, dy = tip.y - body.y, distance = Math.hypot(dx, dy);
    return { x: dx / distance, y: dy / distance };
}

function assertSpriteAngle(frame, degrees, message) {
    const direction = markerDirection(frame), radians = degrees * Math.PI / 180;
    assert.ok(direction.x * Math.cos(radians) + direction.y * Math.sin(radians) > 0.99, message);
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

test('FFmpeg exports angle motion in physical pixel directions with invisible re-entry and a continuous cycle', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'layer-angle-motion-'));
    const center = (mask, frameWidth) => {
        assert.ok(mask.size > 15, 'The rotated sprite is visible');
        let x = 0, y = 0;
        for (const value of mask) {
            x += value % frameWidth;
            y += Math.floor(value / frameWidth);
        }
        return { x: x / mask.size, y: y / mask.size };
    };
    try {
        for (const scenario of [
            { width: 96, height: 72, rotation: 37, x: 50, y: 50, type: 'text' },
            { width: 72, height: 96, rotation: 37, x: 30, y: 60, type: 'image' },
            { width: 96, height: 72, rotation: 135, x: 25, y: 35, type: 'image' },
            { width: 72, height: 96, rotation: 90, x: 50, y: 50, type: 'text' },
        ]) {
            const s = { ...settings, width: scenario.width, height: scenario.height };
            const png = sprite(dir, 0, [255, 0, 0, 255], true, scenario.rotation);
            for (const [motion, sign] of [['along-angle', 1], ['against-angle', -1]]) {
                const moving = { ...layer, ...scenario, motion };
                // One additional diagnostic frame observes t=period without
                // changing the period computed from the production settings.
                const frames = render(dir, s, [{ ...png, layer: moving }], 1);
                assert.equal(frames.length, fps + 1);
                assert.deepEqual(frames[fps], frames[0], `${motion}, ${scenario.rotation}°: the exact end of the cycle meets its first frame`);
                const masks = frames.map(frame => redMask(frame, s.width, s.height));
                const first = center(masks[0], s.width), next = center(masks[1], s.width), last = center(masks[fps - 1], s.width);
                const radians = scenario.rotation * Math.PI / 180;
                const direction = { x: sign * Math.cos(radians), y: sign * Math.sin(radians) };
                for (const step of [{ x: next.x - first.x, y: next.y - first.y }, { x: first.x - last.x, y: first.y - last.y }]) {
                    const length = Math.hypot(step.x, step.y);
                    assert.ok(length > 1);
                    const alignment = (step.x * direction.x + step.y * direction.y) / length;
                    assert.ok(alignment > 0.985, `${motion}, ${scenario.width}×${scenario.height}, ${scenario.rotation}°: exported pixels follow the visible rotation`);
                }
                assert.ok(Math.abs(Math.hypot(next.x - first.x, next.y - first.y) - Math.hypot(first.x - last.x, first.y - last.y)) < 1.6, 'The final-to-first motion is one ordinary frame step');
                const trajectory = angleTrajectory(moving, s.width, s.height, png.width, png.height);
                const wrapFrame = (trajectory.min + trajectory.distance) / trajectory.distance * fps;
                for (const index of [Math.floor(wrapFrame), Math.ceil(wrapFrame)])
                    assert.equal(masks[index].size, 0, `${motion}, ${scenario.rotation}°: the sprite is invisible at the expanded-boundary wrap`);
            }
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('FFmpeg spins raw sprites clockwise or counterclockwise from their starting angle without clipping or losing opacity', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'layer-spin-'));
    try {
        for (const type of ['text', 'image']) {
            const png = spinSprite(dir, type === 'image' ? 128 : 255);
            for (const [spin, sign] of [['clockwise', 1], ['counterclockwise', -1]]) {
                const spinning = { ...layer, type, rotation: -67, spin };
                const frames = render(dir, settings, [{ ...png, layer: spinning }], 1);
                assert.equal(frames.length, fps + 1);
                assert.deepEqual(frames[fps], frames[0], `${type}, ${spin}: one full turn returns to the exact first frame`);
                for (const index of [0, 6, 12, 18])
                    assertSpriteAngle(frames[index], -67 + sign * index / fps * 360, `${type}, ${spin}: quarter turns preserve the starting angle and direction`);
                const initialArea = redMask(frames[0]).size + blueMask(frames[0]).size;
                for (const frame of frames) {
                    const area = redMask(frame).size + blueMask(frame).size;
                    assert.ok(Math.abs(area - initialArea) < initialArea * 0.25, `${type}: the entire long sprite remains inside its safe square at every angle`);
                }
                if (type === 'image') {
                    for (const index of [0, 6, 12, 18]) {
                        let maxRed = 0;
                        for (let offset = 0; offset < frames[index].length; offset += 3)
                            maxRed = Math.max(maxRed, frames[index][offset]);
                        assert.ok(maxRed > 110 && maxRed < 170, `Half-opacity pixels survive rotation: maximum red ${maxRed}`);
                    }
                }
            }
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('FFmpeg composes spin independently with screen-axis and angle-path movement', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'layer-spin-movement-'));
    try {
        const png = spinSprite(dir);
        const spinning = { ...layer, rotation: 37, spin: 'clockwise' };
        const stationary = render(dir, settings, [{ ...png, layer: spinning }], 1);
        const right = render(dir, settings, [{ ...png, layer: { ...spinning, motion: 'right' } }], 1);
        for (const index of [1, 6, 12, 18, 23]) {
            const expected = translated(redMask(stationary[index]), index * 4, 0);
            assert.ok(maskOverlap(redMask(right[index]), expected) > 0.85, `Frame ${index}: screen-axis wrapping moves the already-spinning sprite`);
        }
        assert.deepEqual(right[fps], right[0]);

        const moving = { ...spinning, motion: 'along-angle' };
        const diagonal = render(dir, settings, [{ ...png, layer: moving }], 1);
        for (const index of [0, 1, 6, 12, 18, 23]) {
            const point = layerPosition(moving, width, height, index / fps, 1, png);
            const dx = Math.round(point.x - png.width / 2) - Math.round(width / 2 - png.width / 2);
            const dy = Math.round(point.y - png.height / 2) - Math.round(height / 2 - png.height / 2);
            const expected = new Set();
            for (const value of redMask(stationary[index])) {
                const x = value % width + dx, y = Math.floor(value / width) + dy;
                if (x >= 0 && x < width && y >= 0 && y < height)
                    expected.add(y * width + x);
            }
            const actual = redMask(diagonal[index]);
            if (expected.size > 10)
                assert.ok(maskOverlap(actual, expected) > 0.7, `Frame ${index}: angle motion retains the same spin phase with one clipped sprite`);
            else
                assert.ok(actual.size <= 10, 'The spinning sprite is invisible at its expanded diagonal re-entry');
        }
        assert.deepEqual(diagonal[fps], diagonal[0]);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('FFmpeg spin follows the complete processed ping-pong period rather than the forward pass or export repeats', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'layer-spin-period-'));
    try {
        const png = spinSprite(dir);
        const spinning = { ...layer, type: 'image', rotation: 37, spin: 'counterclockwise' };
        const s = { ...settings, method: 'pingpong', format: 'gif', repeats: 7 };
        const frames = render(dir, s, [{ ...png, layer: spinning }]);
        assert.equal(frames.length, 46);
        assertSpriteAngle(frames[0], 37, 'The original starting angle is preserved');
        assertSpriteAngle(frames[23], 37 - 180, 'Half of the forward-and-backward cycle is half of one spin');
        assertSpriteAngle(frames[45], 37 - 360 * 45 / 46, 'The final frame approaches one complete turn');
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
