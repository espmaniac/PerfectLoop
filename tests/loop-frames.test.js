import test from 'node:test';
import assert from 'node:assert/strict';
import { blendWeight, easedFrame, needsEncoding, outputFrame } from '../js/loop-frames.js';
import { DEFAULTS } from '../js/constants.js';
import { framePlan } from '../js/logic.js';

const settings = (method, extra = {}) => ({ ...DEFAULTS, start: 0, end: 2, speed: 1, fps: 10, transition: 0.4, shift: 0, curve: 'linear', method, ...extra });
const cycle = s => Array.from({ length: framePlan(s).outputFrames }, (_, j) => outputFrame(s, j));

test('Natural cut shows each source frame once, in order', () => {
    assert.deepEqual(cycle(settings('natural')).map(f => f.a), Array.from({ length: 20 }, (_, i) => i));
});

test('Crossfade plays the middle, then blends the tail into the head from 0 to 1', () => {
    const s = settings('crossfade'), frames = cycle(s), { frames: n, overlap: k } = framePlan(s);
    assert.equal(frames.length, n - k);
    assert.deepEqual(frames.slice(0, n - 2 * k).map(f => f.a), Array.from({ length: n - 2 * k }, (_, i) => i + k));
    const blend = frames.slice(n - 2 * k);
    assert.deepEqual(blend.map(f => [f.a, f.b]), Array.from({ length: k }, (_, m) => [n - k + m, m]));
    assert.equal(blend[0].weight, 0); assert.equal(blend.at(-1).weight, 1);
    assert.equal(frames[0].a, blend.at(-1).b + 1, 'After the last blended frame the cycle continues with the next head frame');
});

test('Ping-pong goes forward, then back without repeating either turning frame', () => {
    const order = cycle(settings('pingpong')).map(f => f.a);
    assert.deepEqual(order, [...Array.from({ length: 20 }, (_, i) => i), ...Array.from({ length: 18 }, (_, i) => 18 - i)]);
});

test('Smooth ping-pong lingers at both turns and still reaches the last frame', () => {
    const order = cycle(settings('smooth-pingpong')).map(f => f.a);
    assert.equal(order.length, 38); assert.equal(order[0], 0); assert.equal(order[19], 19);
    assert.ok(order[1] - order[0] < order[10] - order[9], 'Slower near the start than in the middle');
    assert.equal(easedFrame(19, 20), 19);
});

test('Fade goes through black at both ends of the cycle', () => {
    const levels = cycle(settings('fade')).map(f => f.level);
    assert.equal(levels[0], 0); assert.equal(levels.at(-1), 0); assert.equal(levels[10], 1);
});

test('Seam position rotates the cycle without changing its frames', () => {
    const plain = cycle(settings('pingpong')), shifted = cycle(settings('pingpong', { shift: 25 }));
    const offset = Math.round(plain.length * 0.25);
    assert.deepEqual(shifted, [...plain.slice(offset), ...plain.slice(0, offset)]);
});

test('Blend curves stay within 0 and 1 and are symmetric', () => {
    for (const curve of ['linear', 'smooth', 'cosine']) {
        assert.equal(blendWeight(curve, 0, 7), 0); assert.equal(blendWeight(curve, 6, 7), 1);
        assert.ok(Math.abs(blendWeight(curve, 3, 7) - 0.5) < 1e-9);
    }
});

test('Only repairs and motion interpolation need an encoded preview', () => {
    assert.equal(needsEncoding(settings('crossfade')), false);
    assert.equal(needsEncoding(settings('natural', { interpolate: true })), true);
    assert.equal(needsEncoding(settings('natural', { repair: { mode: 'alignment' } })), true);
});
