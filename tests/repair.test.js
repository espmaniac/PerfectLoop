import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { analyzeRepairFrames, repairFilters, repairIssues, repairSignature, suggestRepairCut } from '../js/repair.js';
import { DEFAULTS } from '../js/constants.js';
import { videoGraph } from '../js/logic.js';
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const settings = { ...DEFAULTS, preset: 'custom', method: 'natural', width: 64, height: 64, start: 0, end: 1, fps: 24 };
const repair = analysis => ({ version: 1, brightness: analysis.brightness, shiftX: analysis.shiftX, shiftY: analysis.shiftY, flicker: true, alignment: true, strength: 1 });
const frame = value => new Float32Array(64 * 64).fill(value);

test('Circular brightness correction reduces exposure jumps and joins endpoint targets', () => {
    const levels = Array.from({ length: 25 }, (_, i) => 100 + (i % 2 ? 10 : -10) + i / 2);
    const a = analyzeRepairFrames(levels.map(frame), 64, 64);
    const fixed = levels.map((v, i) => v + 255 * a.brightness[i]);
    assert.ok(a.flickerUseful);
    assert.ok(Math.abs(fixed[0] - fixed.at(-1)) < 0.001);
    assert.ok(Math.max(...fixed) - Math.min(...fixed) < Math.max(...levels) - Math.min(...levels));
    assert.equal(a.alignmentUseful, false);
});
test('A static loop needs no repair; moving bright details do not set the exposure curve', () => {
    const frames = Array.from({ length: 25 }, (_, i) => {
        const f = frame(80);
        for (let p = i * 64; p < i * 64 + 128; p++) f[p] = 220;
        return f;
    });
    assert.equal(analyzeRepairFrames(frames, 64, 64).flickerUseful, false);
    const a = analyzeRepairFrames([frame(90), frame(90), frame(90)], 64, 64);
    assert.equal(a.alignmentUseful, false);
    assert.equal(a.flickerUseful, false);
});
test('Small translation is detected in the correction direction; large drift is rejected', () => {
    const texture = (shift) => Float32Array.from({ length: 64 * 64 }, (_, p) => {
        const x = (p % 64 - shift + 64) % 64, y = Math.floor(p / 64);
        return 40 + (x * 37 + y * 19 + x * y * 3) % 160;
    });
    const a = analyzeRepairFrames([texture(0), texture(0), texture(1)], 64, 64);
    assert.ok(a.alignmentUseful);
    assert.equal(a.shiftX, -1 / 64);
    assert.equal(a.shiftY, 0);
    assert.equal(analyzeRepairFrames([texture(0), texture(0), texture(2)], 64, 64).alignmentUseful, false);
});
test('Repair settings reject malformed curves and signatures track source framing, not layers', () => {
    const r = repair(analyzeRepairFrames([frame(80), frame(90), frame(100)], 64, 64));
    assert.deepEqual(repairIssues(r), []);
    for (const invalid of [{ ...r, brightness: [0, NaN, 0] }, { ...r, shiftX: .5 }, { ...r, strength: -1 }, { ...r, brightness: [0] }]) assert.ok(repairIssues(invalid).length);
    assert.notEqual(repairSignature(settings), repairSignature({ ...settings, start: .1 }));
    assert.notEqual(repairSignature(settings), repairSignature({ ...settings, rotate: 20 }));
    assert.equal(repairSignature(settings), repairSignature({ ...settings, layers: [{ text: 'Hello' }], method: 'crossfade' }));
    assert.equal(repairFilters({ ...settings, repair: { ...r, strength: 0 } }, 24), '');
});
test('Suggested cuts stay near the endpoints and require a materially better seam', () => {
    const frames = [frame(10), frame(50), frame(50), frame(50), frame(50), frame(90)];
    const cut = suggestRepairCut(frames, [.05, .25, .45, .65, .85, 1.05], .1, 0, 1.1);
    assert.ok(cut && cut.start >= 0 && cut.end <= 1.1);
    assert.ok(cut.start <= .5 && cut.end >= .6);
    assert.equal(suggestRepairCut([frame(50), frame(50), frame(50)], [.05, .5, .95], .1, 0, 1), null);
});
let native = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { native = false; }
const run = (bytes, s) => execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_complex_threads', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', '64x64', '-r', '24', '-i', 'pipe:0', '-filter_complex', videoGraph(s), '-map', '[outv]', '-pix_fmt', 'gray', '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], { input: bytes, maxBuffer: 4 * 1024 * 1024 });
test('Encoded brightness repair preserves frame count and substantially reduces the seam jump', { skip: !native }, () => {
    const frames = Array.from({ length: 24 }, (_, i) => frame(80 + Math.round(i * 20 / 23)));
    const a = analyzeRepairFrames(frames, 64, 64), bytes = Buffer.concat(frames.map(f => Buffer.from(f)));
    const out = run(bytes, { ...settings, repair: repair(a) });
    assert.equal(out.length, bytes.length);
    const first = mean(out.subarray(0, 4096)), last = mean(out.subarray(-4096));
    assert.ok(Math.abs(first - last) < 5, `Boundary luminance ${first} → ${last}`);
});
test('Encoded alignment moves the ending toward the beginning without empty borders', { skip: !native }, () => {
    const frames = Array.from({ length: 24 }, (_, i) => Float32Array.from({ length: 4096 }, (_, p) => {
        const x = p % 64, y = Math.floor(p / 64), shift = i < 16 ? 0 : Math.round((i - 16) / 7);
        return 70 + (((x - shift + 64) % 64) * 37 + y * 19) % 120;
    }));
    const a = analyzeRepairFrames(frames, 64, 64);
    assert.ok(a.alignmentUseful);
    const bytes = Buffer.concat(frames.map(f => Buffer.from(f)));
    const out = run(bytes, { ...settings, repair: { ...repair(a), flicker: false } });
    assert.equal(out.length, bytes.length);
    const difference = data => {
        let sum = 0, count = 0;
        for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) { const p = y * 64 + x; sum += Math.abs(data[p] - data[data.length - 4096 + p]); count++; }
        return sum / count;
    };
    assert.ok(difference(out) < difference(bytes) * .5, `${difference(out)} vs ${difference(bytes)}`);
    assert.ok(Math.min(...out.subarray(-4096)) > 30);
});
