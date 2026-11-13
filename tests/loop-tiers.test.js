import test from 'node:test';
import assert from 'node:assert/strict';
import { SEAM_LIMITS, bestLoops, cutAtBoundary, diverseShortlist, filterSimilarRanges, loopTier, seamError } from '../js/ranking.js';

const seamless = error => ['perfect', 'good'].includes(loopTier(error));
import { searchSamplePlan, searchVideo } from '../js/media.js';

const W = 160, H = 90;
// A bright square moves around an ellipse with a period of `period` frames.
function scene(index, period, { noise = 0, drift = 0 } = {}) {
    const phase = 2 * Math.PI * index / period;
    const cx = 80 + 45 * Math.sin(phase) + drift * index, cy = 45 + 25 * Math.cos(phase);
    let seed = index * 7919 + 13;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Float32Array.from({ length: W * H }, (_, p) => {
        const x = p % W, y = Math.floor(p / W);
        return (Math.abs(x - cx) < 9 && Math.abs(y - cy) < 9 ? 220 : 40 + x * .3) + (random() - .5) * noise;
    });
}
function seam(a, b, period, options) {
    const frame = index => scene(index, period, options);
    return seamError({ start: frame(a), startNext: frame(a + 1), startNext2: frame(a + 2), end: frame(b - 1), endPrevious: frame(b - 2), endPrevious2: frame(b - 3), after: frame(b), before: frame(a - 1) }, W, H);
}

test('An exact repeat is perfect, while a repeated or skipped seam frame is rejected', () => {
    assert.equal(loopTier(seam(10, 82, 36).error), 'perfect');
    assert.ok(seam(10, 82, 36).error < 1e-9);
    assert.ok(!seamless(seam(10, 83, 36).error), 'One extra frame repeats the start');
    assert.ok(!seamless(seam(10, 81, 36).error), 'One missing frame skips motion');
});

test('A loop whose first or last frame belongs to another scene is recognized', () => {
    const frames = index => ({ luma: scene(index, 36) });
    const other = { luma: new Float32Array(W * H).fill(200) };
    const loop = { start: frames(10), startNext: frames(11), startNext2: frames(12), end: frames(81), endPrevious: frames(80), endPrevious2: frames(79) };
    assert.equal(cutAtBoundary(loop), false, 'Ordinary motion is not a cut');
    assert.equal(cutAtBoundary({ ...loop, start: other }), true);
    assert.equal(cutAtBoundary({ ...loop, end: other }), true);
});

test('Grain does not prevent a repeat from being perfect', () => {
    const error = seam(10, 82, 36, { noise: 24 }).error;
    assert.ok(error <= SEAM_LIMITS.perfect, `error ${error}`);
    assert.ok(!seamless(seam(10, 83, 36, { noise: 24 }).error));
});

test('A slight drift is good rather than perfect, and a larger drift is rough', () => {
    assert.equal(loopTier(seam(10, 82, 36, { drift: .03 }).error), 'good');
    assert.equal(loopTier(seam(10, 82, 36, { drift: .2 }).error), 'rough');
});

test('Without a neighboring frame a loop is at most good', () => {
    assert.equal(loopTier(0, false), 'good');
    assert.equal(loopTier(SEAM_LIMITS.good + .01, false), 'fair');
});

test('Every perfect and good loop is listed; otherwise fair loops, otherwise the closest matches', () => {
    const clip = (id, seamError) => ({ id, seamError, tier: loopTier(seamError) });
    assert.deepEqual(bestLoops([clip(0, .01), clip(1, .34), clip(2, .5), clip(3, 2)]).map(c => c.id), [0, 1], 'A good loop far from the best is still listed');
    assert.deepEqual(bestLoops([clip(0, .5), clip(1, .9), clip(2, 1.2)]).map(c => c.id), [0, 1]);
    assert.deepEqual(bestLoops([1.2, 1.5, 1.8, 3, 6].map((e, i) => clip(i, e))).map(c => c.id), [0, 1, 2]);
});

test('Verification covers different moments before near-duplicates of the strongest match', () => {
    const early = Array.from({ length: 5 }, (_, i) => ({ id: `early-${i}`, start: i * .1, end: 4 + i * .1, score: 99 - i }));
    const late = { id: 'late', start: 12, end: 16, score: 80 };
    assert.deepEqual(diverseShortlist([...early, late], 2).map(c => c.id), ['early-0', 'late']);
});

test('Perfect loops are listed before good loops regardless of motion preference', () => {
    const visible = filterSimilarRanges([
        { id: 'good', start: 0, end: 4, score: 99, tier: 'good' },
        { id: 'perfect', start: 10, end: 14, score: 85, tier: 'perfect' },
    ]);
    assert.deepEqual(visible.map(c => c.id), ['perfect', 'good']);
});

test('Sampling uses about ten frames per second regardless of frame rate', () => {
    const at = fps => searchSamplePlan({ from: 0, to: 18, min: 3, max: 8 }, fps, 20);
    assert.equal(at(30).times[1] * 30, 3);
    assert.equal(at(24).times[1] * 24, 2);
    assert.equal(at(60).times[1] * 60, 6);
    assert.equal(at(8).times[1] * 8, 1);
});

test('Search finds the exact period of a repeating video and never a frame more or less', async t => {
    const previous = new Map(['document', 'window', 'Worker'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    const { rankFrames } = await import('../js/ranking.js');
    const fps = 30, period = 72, listeners = new Map();
    let currentTime = 0;
    const video = {
        duration: 20, videoWidth: 320, videoHeight: 180, readyState: 2,
        style: {}, setAttribute() {}, remove() {},
        set src(value) { queueMicrotask(() => { for (const callback of [...(listeners.get('loadeddata') || [])]) callback(); }); },
        get currentTime() { return currentTime; },
        set currentTime(value) {
            currentTime = value;
            queueMicrotask(() => { for (const callback of [...(listeners.get('seeked') || [])]) callback(); });
        },
        addEventListener(name, callback) {
            const callbacks = listeners.get(name) || new Set();
            callbacks.add(callback);
            listeners.set(name, callbacks);
        },
        removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
        pause() {}, removeAttribute() {}, load() {},
    };
    // Canvases resample the current source frame to their own size.
    const context = canvas => ({
        drawImage() {},
        getImageData: (x, y, width, height) => {
            const frame = scene(Math.floor(currentTime * fps), period), data = new Uint8ClampedArray(width * height * 4);
            for (let p = 0; p < width * height; p++) {
                const value = frame[Math.floor(Math.floor(p / width) * H / height) * W + Math.floor(p % width * W / width)];
                data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = value;
                data[p * 4 + 3] = 255;
            }
            return { data };
        },
    });
    globalThis.document = { body: { append() {} }, createElement: tag => {
        if (tag === 'video') return video;
        const canvas = { toDataURL: () => 'data:image/jpeg;base64,fixture' };
        canvas.getContext = () => context(canvas);
        return canvas;
    } };
    globalThis.window = { setTimeout, clearTimeout };
    globalThis.Worker = class {
        postMessage({ frames, options }) {
            queueMicrotask(() => this.onmessage({ data: { candidates: rankFrames(frames, options) } }));
        }
        terminate() {}
    };
    const result = await searchVideo('fixture.mp4', { from: 0, to: 18, min: 3, max: 8, preferMotion: true, avoidCuts: true }, fps, new AbortController().signal, () => {});
    assert.ok(result.candidates.length);
    for (const candidate of result.candidates) {
        const frames = Math.round((candidate.end - candidate.start) * fps);
        assert.ok(frames === 2 * period || frames === 3 * period, `${frames} frames`);
        assert.equal(candidate.tier, 'perfect');
    }
});
