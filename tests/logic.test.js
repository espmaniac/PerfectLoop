import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { framePlan, validate, videoGraph } from '../js/logic.js';
import { DEFAULTS, METHODS } from '../js/constants.js';
import { pairScore, rankFrames } from '../js/ranking.js';
test('Spotify checks the processed duration and exact aspect ratio', () => {
    const info = { name: 'test', duration: 30, width: 360, height: 640, fps: 30, hasAudio: true, size: 1 };
    assert.deepEqual(validate(DEFAULTS, info), []);
    assert.ok(validate({ ...DEFAULTS, method: 'pingpong' }, info).some(s => s.includes('3–8')));
    assert.ok(validate({ ...DEFAULTS, width: 608, height: 1080 }, info).some(s => s.includes('exact 9:16')));
    assert.ok(validate({ ...DEFAULTS, repeats: 2 }, info).some(s => s.includes('3–8')));
    assert.ok(validate({ ...DEFAULTS, start: -1 }, info).length > 0);
});
test('Rebound omits repeated turning points; overlap is bounded', () => {
    assert.equal(framePlan({ ...DEFAULTS, method: 'pingpong' }).outputFrames, 358);
    assert.equal(framePlan({ ...DEFAULTS, method: 'crossfade' }).outputFrames, 165);
    assert.equal(framePlan({ ...DEFAULTS, method: 'crossfade', transition: 20 }).overlap, 89);
});
test('GIF stores one cycle while video formats encode the repeat count', () => {
    const settings = { ...DEFAULTS, preset: 'custom', repeats: 4 };
    for (const gifLoop of [true, false]) {
        const gif = framePlan({ ...settings, format: 'gif', gifLoop });
        assert.equal(gif.totalFrames, 165);
        assert.equal(gif.totalDuration, 5.5);
    }
    for (const format of ['mp4', 'webm']) {
        const video = framePlan({ ...settings, format });
        assert.equal(video.totalFrames, 660);
        assert.equal(video.totalDuration, 22);
    }
});
test('GIF ignores inactive video size and repeat options; videos still validate them', () => {
    const info = { duration: 30 };
    for (const options of [{ repeats: NaN, targetMB: Infinity }, { repeats: 0, targetMB: 2001 }]) {
        const settings = { ...DEFAULTS, preset: 'custom', ...options };
        assert.deepEqual(validate({ ...settings, format: 'gif' }, info), []);
        assert.equal(framePlan({ ...settings, format: 'gif' }).totalFrames, 165);
        for (const format of ['mp4', 'webm']) {
            const issues = validate({ ...settings, format }, info);
            assert.ok(issues.some(issue => /repeat|cycle/i.test(issue)));
            assert.ok(issues.some(issue => /target/i.test(issue)));
        }
    }
});
test('Motion mismatch ranks below matching images with compatible movement', () => {
    const a = new Float32Array(32 * 32 * 3).fill(0.5), next = new Float32Array(a.length).fill(0.55), previous = new Float32Array(a.length).fill(0.45);
    const wrong = new Float32Array(a.length).fill(0.55);
    const d = (pixels, time) => ({ pixels, time });
    const good = pairScore(d(a, 0), d(next, 0.1), d(previous, 5.9), d(a, 6), false);
    const bad = pairScore(d(a, 0), d(next, 0.1), d(wrong, 5.9), d(a, 6), false);
    assert.ok(good.score > bad.score + 10);
    const statics = Array.from({ length: 21 }, (_, i) => d(a, i * 0.5));
    assert.ok(rankFrames(statics, { from: 0, to: 10, min: 3, max: 8, precision: 'balanced', preferMotion: true, avoidCuts: true }).every(c => c.score <= 90.01));
});
let native = true;
try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
}
catch {
    native = false;
}
test('Actual FFmpeg output has the expected count and continuous boundary order', { skip: !native }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'loop-test-')), input = join(dir, 'ramp.mkv');
    const n = 18, fps = 6, side = 16;
    const bytes = Buffer.concat(Array.from({ length: n }, (_, i) => Buffer.alloc(side * side, 20 + i * 10)));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '16x16', '-r', String(fps), '-i', 'pipe:0', '-c:v', 'ffv1', input], { input: bytes });
    try {
        for (const m of METHODS) {
            const s = { ...DEFAULTS, start: 0, end: 3, fps, transition: 0.5, method: m.id, preset: 'custom' };
            const output = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_complex_threads', '1', '-i', input, '-filter_complex', videoGraph(s), '-map', '[outv]', '-an', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1']);
            const count = output.length / (side * side), p = framePlan(s);
            assert.equal(count, p.outputFrames, `${m.id}: frame count`);
            const first = output[0], last = output[output.length - 1];
            if (m.id === 'pingpong') {
                assert.ok(Math.abs(first - 20) <= 2);
                assert.ok(Math.abs(last - 30) <= 2);
            }
            if (m.id === 'crossfade' || m.id === 'offset') {
                assert.ok(Math.abs(first - 50) <= 2);
                assert.ok(Math.abs(last - 40) <= 2, `${m.id}: blend ends exactly at head frame 2 (actual ${last})`);
            }
            if (m.id === 'fade') {
                assert.equal(first, 0);
                assert.equal(last, 0);
            }
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
