import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DEFAULTS } from '../js/constants.js';
import { geometry, validate } from '../js/logic.js';
import { videoTransform } from '../js/framing.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
const settings = { ...DEFAULTS, preset: 'custom', width: 96, height: 72, background: '#102030' };

test('Video framing scales, crops and pads each output axis using the same position percentages', () => {
    const cover = videoTransform({ ...settings, zoom: 90, cropX: 25, cropY: 75 }, 128, 80);
    near(cover.sx, 0.81);
    near(cover.sy, 0.81);
    near(cover.scaledWidth, 103.68);
    near(cover.scaledHeight, 64.8);
    near(cover.offsetX, 1.92);
    near(cover.offsetY, 1.8);
    const contain = videoTransform({ ...settings, fit: 'contain', zoom: 175, cropX: 0, cropY: 100 }, 128, 80);
    near(contain.scaledWidth, 168);
    near(contain.scaledHeight, 105);
    near(contain.offsetX, 36);
    near(contain.offsetY, -16.5);
    const padded = videoTransform({ ...settings, fit: 'stretch', zoom: 25, cropX: 100, cropY: 0 }, 128, 80);
    near(padded.scaledWidth, 24);
    near(padded.scaledHeight, 18);
    near(padded.offsetX, 36);
    near(padded.offsetY, -27);
});

test('Quarter rotations swap the source axes before stretch and alternate preview sizes scale proportionally', () => {
    const options = { ...settings, width: 200, height: 100, fit: 'stretch', zoom: 125, rotate: 90, mirror: true, cropX: 100, cropY: 0 };
    const full = videoTransform(options, 320, 180);
    near(full.sx, 25 / 18);
    near(full.sy, 25 / 64);
    near(full.scaledWidth, 250);
    near(full.scaledHeight, 125);
    near(full.offsetX, -25);
    near(full.offsetY, 12.5);
    const preview = videoTransform(options, 320, 180, 100, 50);
    for (const key of Object.keys(full))
        near(preview[key], full[key] / 2);
    assert.deepEqual(full, videoTransform({ ...options, mirror: false }, 320, 180), 'Mirroring belongs to the renderer after rotation');
});

test('Old settings retain unit zoom and the original default export filter strings', () => {
    const old = { ...settings };
    delete old.zoom;
    assert.equal(DEFAULTS.zoom, 100);
    assert.deepEqual(videoTransform(old, 128, 80), videoTransform(settings, 128, 80));
    assert.equal(geometry(old), 'scale=96:72:force_original_aspect_ratio=increase,crop=96:72:(iw-ow)*0.5:(ih-oh)*0.5,setsar=1');
    assert.equal(geometry({ ...old, fit: 'contain' }), 'scale=96:72:force_original_aspect_ratio=decrease,pad=96:72:(ow-iw)/2:(oh-ih)/2:color=0x102030,setsar=1');
    assert.equal(geometry({ ...old, fit: 'stretch' }), 'scale=96:72,setsar=1');
    assert.match(geometry({ ...settings, fit: 'contain', cropX: 0, cropY: 100 }), /pad=96:72:\(ow-iw\)\*0:\(oh-ih\)\*1/);
});

test('Zoom validation rejects nonfinite and out-of-range values while accepting old settings and both limits', () => {
    const info = { duration: 30, width: 128, height: 80 };
    for (const zoom of [NaN, Infinity, -Infinity, null, '100'])
        assert.ok(validate({ ...settings, zoom }, info).includes('Invalid zoom value.'), `${zoom}: invalid zoom`);
    for (const zoom of [0, 24.9, 400.1])
        assert.ok(validate({ ...settings, zoom }, info).some(issue => issue.includes('25% and 400%')));
    for (const zoom of [25, 100, 400, undefined])
        assert.deepEqual(validate({ ...settings, zoom }, info), []);
    assert.ok(validate({ ...settings, width: 3840, height: 3840, zoom: 400 }, info).some(issue => issue.includes('Lower the zoom or output resolution')));
    assert.deepEqual(validate({ ...settings, width: 3840, height: 3840, zoom: 400 }, { duration: 30 }), [], 'Missing metadata does not create a false memory error');
});

let native = true;
try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
}
catch {
    native = false;
}
const run = (args, input) => execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-filter_threads', '1', ...args], { input, maxBuffer: 8 * 1024 ** 2 });

// The two ramps encode source coordinates; the blue channel distinguishes
// video from the background without depending on a canvas implementation.
const sourceWidth = 128, sourceHeight = 80;
const source = Buffer.alloc(sourceWidth * sourceHeight * 3);
for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
        const index = (y * sourceWidth + x) * 3;
        source[index] = 30 + x;
        source[index + 1] = 30 + 2 * y;
        source[index + 2] = 220;
    }
}

function render(options, pixelFormat = 'rgb24') {
    return run(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${sourceWidth}x${sourceHeight}`, '-i', 'pipe:0',
        '-vf', `${pixelFormat === 'rgb24' ? '' : `format=${pixelFormat},`}${geometry(options)}`,
        '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], source);
}

function checkMapping(options, output, colorTolerance = 0) {
    assert.equal(output.length, options.width * options.height * 3, 'The export has exact output dimensions');
    const transform = videoTransform(options, sourceWidth, sourceHeight);
    const left = (options.width - transform.scaledWidth) / 2 + transform.offsetX;
    const top = (options.height - transform.scaledHeight) / 2 + transform.offsetY;
    const angle = options.rotate * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    let content = 0, background = 0;
    for (let y = 1; y < options.height; y += 5) {
        for (let x = 1; x < options.width; x += 5) {
            const pixel = [...output.subarray((y * options.width + x) * 3, (y * options.width + x) * 3 + 3)];
            const px = x + 0.5, py = y + 0.5;
            if (px < left - 2 || px > left + transform.scaledWidth + 2 || py < top - 2 || py > top + transform.scaledHeight + 2) {
                assert.ok(pixel.every((channel, index) => Math.abs(channel - [16, 32, 48][index]) <= colorTolerance), `${JSON.stringify(options)}: output background at ${x},${y}: ${pixel}`);
                background++;
                continue;
            }
            const rotatedX = (px - options.width / 2 - transform.offsetX) / transform.sx * (options.mirror ? -1 : 1);
            const rotatedY = (py - options.height / 2 - transform.offsetY) / transform.sy;
            const sourceX = rotatedX * cosine + rotatedY * sine + sourceWidth / 2 - 0.5;
            const sourceY = -rotatedX * sine + rotatedY * cosine + sourceHeight / 2 - 0.5;
            if (sourceX < 3 || sourceX > sourceWidth - 4 || sourceY < 3 || sourceY > sourceHeight - 4 ||
                px < left + 2 || px > left + transform.scaledWidth - 2 || py < top + 2 || py > top + transform.scaledHeight - 2)
                continue;
            assert.ok(pixel[2] > 210, `${JSON.stringify(options)}: expected video at ${x},${y}`);
            // FFmpeg rounds scale dimensions and crop/pad offsets to whole pixels.
            // Allow 1.5 output pixels plus ramp/interpolation quantization.
            const tolerance = 2 + colorTolerance + 1.5 / Math.min(transform.sx, transform.sy);
            assert.ok(Math.abs(pixel[0] - (30 + sourceX)) <= tolerance, `${JSON.stringify(options)}: source X at ${x},${y}: ${pixel[0]} versus ${30 + sourceX}`);
            assert.ok(Math.abs(pixel[1] - (30 + 2 * sourceY)) <= tolerance * 2, `${JSON.stringify(options)}: source Y at ${x},${y}: ${pixel[1]} versus ${30 + 2 * sourceY}`);
            content++;
        }
    }
    assert.ok(content > 0, 'The coordinate check sampled visible source content');
    if (transform.scaledWidth < options.width - 6 || transform.scaledHeight < options.height - 6)
        assert.ok(background > 0, `${JSON.stringify(options)}: the padded output includes the requested background`);
}

test('Native FFmpeg cover, contain and stretch match preview coordinates above and below unit zoom at every position', { skip: !native }, () => {
    for (const fit of ['cover', 'contain', 'stretch']) {
        for (const zoom of [25, 75, 90, 100, 175, 400]) {
            for (const [cropX, cropY] of [[0, 100], [100, 0], [37, 68]]) {
                const options = { ...settings, fit, zoom, cropX, cropY };
                checkMapping(options, render(options));
            }
        }
    }
});

test('Native FFmpeg rotates before horizontal mirroring and positions the rotated image in output axes', { skip: !native }, () => {
    for (const rotate of [0, 90, 180, 270]) {
        for (const mirror of [false, true]) {
            for (const fit of ['cover', 'contain', 'stretch']) {
                const options = { ...settings, fit, zoom: fit === 'contain' ? 175 : 75, cropX: 23, cropY: 81, rotate, mirror };
                checkMapping(options, render(options));
            }
        }
    }
});

test('Native FFmpeg subsampled video retains framing and exact output dimensions for fractional zoom', { skip: !native }, () => {
    for (const fit of ['cover', 'contain', 'stretch']) {
        for (const zoom of [25, 87, 133, 400]) {
            const options = { ...settings, fit, zoom, cropX: 31, cropY: 77 };
            const output = render(options, 'yuv420p');
            checkMapping(options, output, 4);
        }
    }
});
