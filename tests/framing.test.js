import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DEFAULTS } from '../js/constants.js';
import { geometry, validate } from '../js/logic.js';
import { rotatedDimensions, videoRotate, videoSelectionGeometry, videoTransform } from '../js/framing.js';
import { dimensionsForAspect } from '../js/aspect.js';

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

test('Free video rotation uses the full rotated source bounds and exposes unclipped source corners', () => {
    const options = { ...settings, rotate: 37, mirror: true, fit: 'stretch', zoom: 210, cropX: 23, cropY: 81 };
    const info = { width: 128, height: 80 };
    const angle = options.rotate * Math.PI / 180;
    const rotated = rotatedDimensions(info.width, info.height, options.rotate);
    near(rotated.width, info.width * Math.cos(angle) + info.height * Math.sin(angle));
    near(rotated.height, info.width * Math.sin(angle) + info.height * Math.cos(angle));
    const transform = videoTransform(options, info.width, info.height);
    near(transform.scaledWidth, settings.width * 2.1);
    near(transform.scaledHeight, settings.height * 2.1);
    const shape = videoSelectionGeometry(options, info);
    near(shape.centerX, settings.width / 2 + transform.offsetX);
    near(shape.centerY, settings.height / 2 + transform.offsetY);
    const xs = shape.corners.map(point => point.x), ys = shape.corners.map(point => point.y);
    near(Math.max(...xs) - Math.min(...xs), transform.scaledWidth);
    near(Math.max(...ys) - Math.min(...ys), transform.scaledHeight);
    assert.ok(xs.some(x => x < 0 || x > settings.width), 'Oversized source corners remain outside the crop');
    for (const point of shape.corners) {
        const x = (point.x - shape.centerX) / transform.sx * -1;
        const y = (point.y - shape.centerY) / transform.sy;
        near(Math.abs(x * Math.cos(angle) + y * Math.sin(angle)), info.width / 2);
        near(Math.abs(-x * Math.sin(angle) + y * Math.cos(angle)), info.height / 2);
    }
    const preview = videoSelectionGeometry(options, info, { width: settings.width / 2, height: settings.height / 2 });
    for (let index = 0; index < 4; index++) {
        near(preview.corners[index].x, shape.corners[index].x / 2);
        near(preview.corners[index].y, shape.corners[index].y / 2);
    }
});

test('Rotating a framed video preserves its source center and scale when fitting permits it', () => {
    const info = { width: 128, height: 80 };
    for (const fit of ['cover', 'contain']) {
        const options = { ...settings, fit, zoom: 220, cropX: 35, cropY: 65, rotate: 12 };
        const before = videoTransform(options, info.width, info.height);
        const changes = videoRotate(options, info, 63);
        const after = videoTransform({ ...options, ...changes }, info.width, info.height);
        near(changes.rotate, 63);
        near(after.sx, before.sx);
        near(after.sy, before.sy);
        near(after.offsetX, before.offsetX);
        near(after.offsetY, before.offsetY);
    }
    const constrained = videoRotate({ ...settings, zoom: 400 }, info, 45);
    assert.ok(constrained.zoom >= 25 && constrained.zoom <= 400);
    assert.ok(constrained.cropX >= 0 && constrained.cropX <= 100);
    assert.ok(constrained.cropY >= 0 && constrained.cropY <= 100);
});

test('Original aspect dimensions include arbitrary rotation while keeping exact quarter turns', () => {
    const info = { width: 320, height: 180 };
    assert.deepEqual(dimensionsForAspect('original', info, 0), info);
    assert.deepEqual(dimensionsForAspect('original', info, 90), { width: 180, height: 320 });
    assert.deepEqual(dimensionsForAspect('original', info, -90), { width: 180, height: 320 });
    const rotated = rotatedDimensions(info.width, info.height, 37);
    assert.deepEqual(dimensionsForAspect('original', info, 37), {
        width: Math.floor(rotated.width / 2) * 2,
        height: Math.floor(rotated.height / 2) * 2,
    });
});

test('Video rotation accepts signed and fractional angles and keeps quarter-turn export filters', () => {
    const info = { duration: 30, width: 128, height: 80 };
    for (const rotate of [-360, -90, -37.5, 0, 37.5, 270, 360])
        assert.deepEqual(validate({ ...settings, rotate }, info), []);
    for (const rotate of [-360.1, 360.1])
        assert.ok(validate({ ...settings, rotate }, info).some(issue => issue.includes('-360 and 360')));
    for (const rotate of [NaN, Infinity, '37'])
        assert.ok(validate({ ...settings, rotate }, info).includes('Invalid rotate value.'));
    assert.match(geometry({ ...settings, rotate: -90 }), /^transpose=2,/);
    assert.match(geometry({ ...settings, rotate: 180 }), /^hflip,vflip,/);
    assert.match(geometry({ ...settings, rotate: 37.5 }), /^rotate=a='37.5\*PI\/180':ow='ceil\(rotw\(37.5\*PI\/180\)\)':oh='ceil\(roth\(37.5\*PI\/180\)\)':c=0x102030,/);
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
            if (options.rotate % 90 !== 0 && (sourceX < -8 || sourceX > sourceWidth + 7 || sourceY < -8 || sourceY > sourceHeight + 7)) {
                assert.ok(pixel.every((channel, index) => Math.abs(channel - [16, 32, 48][index]) <= colorTolerance + 2), `${JSON.stringify(options)}: rotated background at ${x},${y}: ${pixel}`);
                background++;
                continue;
            }
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

test('Native FFmpeg arbitrary-angle rotation matches preview coordinates and background on each fit mode', { skip: !native }, () => {
    for (const rotate of [-31, 37, 147]) {
        for (const mirror of [false, true]) {
            for (const fit of ['cover', 'contain', 'stretch']) {
                const options = { ...settings, rotate, mirror, fit, zoom: 130, cropX: 35, cropY: 65 };
                checkMapping(options, render(options));
                checkMapping(options, render(options, 'yuv420p'), 4);
            }
        }
    }
});
