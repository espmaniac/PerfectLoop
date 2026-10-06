import test from 'node:test';
import assert from 'node:assert/strict';
import { distinctCandidates, pairScore, rankFrames } from '../js/ranking.js';
import { searchSamplePlan, searchVideo } from '../js/media.js';

const options = { from: 0, to: 60, min: 3, max: 8, precision: 'balanced', preferMotion: false, avoidCuts: true };
const frame = (time, level) => ({ time, pixels: new Float32Array(32 * 32 * 3).fill(level) });

test('Equal-quality repeats remain discoverable throughout a video instead of filling an early raw shortlist', () => {
    const frames = Array.from({ length: 241 }, (_, i) => frame(i / 4, 0.4));
    const candidates = rankFrames(frames, options);
    assert.equal(candidates.length, 16);
    assert.ok(candidates.some(c => c.start >= 45), 'Late clips must survive a crowd of identical early pairs');
    assert.ok(candidates.some(c => c.start >= 20 && c.start < 40), 'The middle of the video must also be represented');
    for (const c of candidates) {
        assert.ok(c.end - c.start >= options.min && c.end - c.start <= options.max);
        assert.ok(Math.abs(c.score - 100) < 1e-8);
    }
});

test('The strongest natural repeat can start after forty seconds', () => {
    const frames = Array.from({ length: 121 }, (_, i) => {
        const time = i / 2;
        return frame(time, time < 40 ? 0.1 + time * 0.006 : 0.5 + 0.08 * Math.sin((time - 40) * Math.PI / 2));
    });
    const candidates = rankFrames(frames, { ...options, avoidCuts: false, preferMotion: true });
    assert.ok(candidates.length);
    assert.ok(candidates[0].start >= 40, 'A weaker earlier match must not displace the best late repeat');
    assert.ok(candidates[0].score > 99.9);
    assert.ok(candidates.every(c => c.start >= 0 && c.end <= 60));
});

test('Ranking enforces a nonzero selected range even when given descriptors from the entire source', () => {
    const frames = Array.from({ length: 241 }, (_, i) => frame(i / 4, 0.4));
    const opts = { ...options, from: 40.1, to: 56.2 };
    const candidates = rankFrames(frames, opts);
    assert.ok(candidates.length);
    assert.ok(candidates.every(c => c.start >= opts.from && c.end <= opts.to));
    assert.ok(candidates.some(c => c.start >= 49));
});

test('The exclusive end of a selection uses its real final frame and actual boundary motion', () => {
    const frames = [frame(0, 0.3), frame(0.5, 0.32), frame(1, 0.34), frame(1.5, 0.36), frame(2, 0.37), frame(2.5, 0.38), frame(2.9, 0.4)];
    const candidates = rankFrames(frames, { ...options, to: 3, min: 3, max: 3, endBoundary: 3 });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].start, 0);
    assert.equal(candidates[0].end, 3);
    const actual = pairScore(frames[0], frames[1], frames.at(-2), frames.at(-1), false);
    assert.equal(candidates[0].score, actual.score, 'The endpoint must not invent a duplicate continuation frame');
});

test('Temporal spread breaks equal-quality ties without promoting weaker loops', () => {
    const strong = Array.from({ length: 16 }, (_, i) => ({ id: `strong-${i}`, start: i * 0.7, end: i * 0.7 + 4, score: 99 - i / 100 }));
    const candidates = distinctCandidates([...strong, { id: 'late', start: 50, end: 54, score: 80 }], options);
    assert.equal(candidates.length, 16);
    assert.ok(candidates.every(c => c.id.startsWith('strong-')));
    assert.ok(candidates.every((c, i) => !i || c.score <= candidates[i - 1].score));
});

test('Coarse sampling covers both ends of a long range within the 1601-frame budget', () => {
    const opts = { ...options, from: 40, to: 7240, precision: 'detailed' };
    const plan = searchSamplePlan(opts, 30, 7300);
    assert.equal(plan.times.length, 1601);
    assert.equal(plan.times[0], 40);
    assert.equal(plan.times.at(-1), 7240 - 1 / 30);
    assert.equal(plan.end, 7240);
    for (let i = 0; i < plan.times.length; i++) {
        const time = plan.times[i];
        assert.ok(time >= opts.from && time + 0.5 / 30 < opts.to);
        assert.ok(Math.abs(time * 30 - Math.round(time * 30)) < 1e-7);
        if (i) assert.ok(time > plan.times[i - 1]);
    }
});

test('Sampling and terminal boundaries stay inside fractional nonzero source selections', () => {
    const opts = { ...options, from: 40.03, to: 56.07, precision: 'detailed' };
    const plan = searchSamplePlan(opts, 30, 60);
    assert.equal(plan.first, 1201 / 30);
    assert.equal(plan.end, 1682 / 30);
    assert.equal(plan.last, 1681 / 30);
    assert.equal(plan.times.at(-1), plan.last);
    assert.ok(plan.times.every(time => time + 0.5 / 30 >= opts.from && time + 0.5 / 30 < opts.to));
    assert.ok(plan.times.length <= 1601);
});

test('An exact minimum-length selection is searchable, while a shorter frame-aligned range is rejected', () => {
    const plan = searchSamplePlan({ ...options, from: 40, to: 43, min: 3, max: 3 }, 30, 60);
    const candidates = rankFrames(plan.times.map(time => frame(time, 0.4)), { ...options, from: 40, to: 43, min: 3, max: 3, endBoundary: plan.end });
    assert.deepEqual(candidates.map(({ start, end }) => ({ start, end })), [{ start: 40, end: 43 }]);
    assert.throws(() => searchSamplePlan({ ...options, from: 40.01, to: 43.01 }, 30, 60), /frame rate/);
    assert.throws(() => searchSamplePlan(options, 0, 60), /frame rate/);
});

test('An exact-length selection at low frame rates refines its terminal seam without decoding outside the range', async t => {
    const previous = new Map(['document', 'window', 'Worker'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    const seeks = [], listeners = new Map();
    let currentTime = 0;
    const video = {
        duration: 60, videoWidth: 32, videoHeight: 32, readyState: 2,
        set src(value) { queueMicrotask(() => this.onloadeddata?.()); },
        get currentTime() { return currentTime; },
        set currentTime(value) {
            currentTime = value;
            seeks.push(value);
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
    // Constant decoded frames isolate terminal refinement from the ranking model.
    const rgba = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 102;
        rgba[i + 3] = 255;
    }
    globalThis.document = { createElement: tag => tag === 'video' ? video : {
        getContext: () => ({ drawImage() {}, getImageData: () => ({ data: rgba }) }),
        toDataURL: () => 'data:image/jpeg;base64,fixture',
    } };
    globalThis.window = { setTimeout };
    globalThis.Worker = class {
        postMessage({ frames, options }) {
            queueMicrotask(() => this.onmessage({ data: { candidates: rankFrames(frames, options) } }));
        }
        terminate() {}
    };
    const result = await searchVideo('fixture.mp4', { ...options, from: 40, to: 56, min: 16, max: 16 }, 6, new AbortController().signal, () => {});
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].start, 40);
    assert.equal(result.candidates[0].end, 56);
    assert.equal(result.candidates[0].refined, true, 'The terminal candidate must receive frame-level refinement');
    assert.ok(seeks.every(time => time >= 40 && time < 56));
    assert.ok(seeks.some(time => Math.abs(time - (56 - 1.5 / 6)) < 1e-7), 'Boundary motion needs a real penultimate frame');
});
