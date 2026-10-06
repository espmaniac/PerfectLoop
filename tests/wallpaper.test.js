import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, METHODS } from '../js/constants.js';
import { framePlan, validate } from '../js/logic.js';
import { PHONE_PROFILES, keyPhotoTime, phoneProfile, wallpaperCompatibilityProfile, wallpaperExportSettings, wallpaperPreset, wallpaperRange } from '../js/wallpaper.js';
import { saveWallpaperPackage, wallpaperDownload } from '../js/wallpaper-export.js';

let native = true;
try {
    for (const command of ['ffmpeg', 'ffprobe']) execFileSync(command, ['-version'], { stdio: 'ignore' });
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
} catch { native = false; }
const run = args => execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '1', '-filter_threads', '1', ...args], { maxBuffer: 4 * 1024 ** 2 });
const probe = (path, args = ['-show_streams', '-show_format']) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', path], { maxBuffer: 4 * 1024 ** 2 }));
const stillMarkerPacket = path => probe(path, ['-select_streams', 'd', '-show_packets', '-show_data']).packets
    .find(packet => packet.data.includes('0000 0009 0000 0001 ff'));
const blob = path => new Blob([readFileSync(path)]);
const zipDirectoryAttributes = bytes => {
    const end = bytes.length - 22;
    assert.equal(bytes.readUInt32LE(end), 0x06054b50);
    const entries = new Map();
    let position = bytes.readUInt32LE(end + 16);
    for (let count = bytes.readUInt16LE(end + 10); count > 0; count--) {
        assert.equal(bytes.readUInt32LE(position), 0x02014b50);
        const nameLength = bytes.readUInt16LE(position + 28);
        const name = bytes.toString('utf8', position + 46, position + 46 + nameLength);
        entries.set(name, { os: bytes[position + 5], attrs: bytes.readUInt32LE(position + 38) });
        position += 46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
    }
    return entries;
};

test('Wallpaper ranges produce a three-second cycle for every method, speed, and overlap size', () => {
    for (const method of METHODS.map(item => item.id)) {
        for (const fps of [1, 24, 30, 60]) {
            for (const speed of [0.25, 1, 4]) {
                for (const transition of [0.01, 0.5, 30]) {
                    const settings = { ...DEFAULTS, method, fps, speed, transition, start: 40 };
                    const range = wallpaperRange(settings, { duration: 100 }, 3);
                    assert.equal(range.start, 40, `${method}: preserve the chosen starting moment`);
                    assert.ok(range.end <= 100 && range.end > range.start);
                    const finished = framePlan({ ...settings, ...range }).duration;
                    assert.ok(Math.abs(finished - 3) <= 1 / fps + 1e-8,
                        `${method}, ${fps} FPS, ${speed}×, overlap ${transition}: finished ${finished}s`);
                    assert.equal(settings.start, 40, 'Preparing a range does not mutate existing settings');
                }
            }
        }
    }
});

test('Wallpaper ranges stay inside the source when starting near its end or using short footage', () => {
    for (const method of METHODS.map(item => item.id)) {
        for (const speed of [0.25, 1, 4]) {
            for (const duration of [0.5, 2, 10]) {
                for (const start of [-5, duration - 0.01, duration + 10]) {
                    const settings = { ...DEFAULTS, method, speed, transition: 30, start };
                    const range = wallpaperRange(settings, { duration }, 3);
                    assert.ok(range.start >= 0 && range.end <= duration && range.end > range.start);
                    const output = framePlan({ ...settings, ...range }).duration;
                    assert.ok(output <= 3 + 1 / settings.fps + 1e-8);
                    if (duration === 10 && speed <= 1) assert.ok(Math.abs(output - 3) <= 1 / settings.fps + 1e-8);
                }
            }
        }
    }
});

test('iPhone presets use the selected phone size and one silent MP4 cycle while retaining layers', () => {
    const layers = [{ id: 'caption', type: 'text', text: 'Wallpaper', visible: true, motion: 'up', rotation: 30 }];
    const original = { ...DEFAULTS, preset: 'spotify', format: 'gif', repeats: 20, audio: 'keep', targetMB: 8,
        fps: 24, speed: 4, start: 40, layers };
    for (const profile of PHONE_PROFILES) {
        const next = wallpaperPreset(original, { duration: 100 }, profile.id);
        assert.equal(next.preset, 'iphone');
        assert.equal(next.aspect, 'custom');
        assert.equal(next.width, profile.width);
        assert.equal(next.height, profile.height);
        assert.equal(next.wallpaperDevice, profile.id);
        assert.equal(next.fps, 60);
        assert.equal(next.format, 'mp4');
        assert.equal(next.audio, 'strip');
        assert.equal(next.repeats, 1);
        assert.equal(next.targetMB, 0);
        assert.equal(next.layers, layers);
        assert.equal(next.speed, 4);
        assert.ok(next.end - next.start > 8, 'A valid wallpaper source range can exceed Spotify limits');
        assert.ok(Math.abs(framePlan(next).duration - 2) <= 1 / 60, 'The recommended preset creates a two-second cycle');
        assert.deepEqual(validate(next, { duration: 100 }), []);
    }
    const custom = wallpaperPreset({ ...original, width: 1080, height: 2340 }, { duration: 100 }, 'custom');
    assert.equal(custom.wallpaperDevice, 'custom');
    assert.deepEqual([custom.width, custom.height], [1080, 2340]);
    assert.deepEqual(phoneProfile(custom), { id: 'custom', name: 'Custom phone size', width: 1080, height: 2340, chrome: 'island' });
    assert.deepEqual([original.preset, original.format, original.repeats, original.audio, original.fps], ['spotify', 'gif', 20, 'keep', 24]);
});

test('Live Photo profiles fit compatibility bounds without upscaling and retain framing to pixel precision', () => {
    for (const [width, height] of [[1170, 2532], [1290, 2796], [750, 1334], [1080, 2340],
        [576, 1024], [320, 240], [1920, 1080], [3840, 2160], [1000, 1000]]) {
        const profile = wallpaperCompatibilityProfile({ width, height, fps: 24 });
        assert.equal(profile.fps, 60);
        assert.ok(profile.width <= 720 && profile.height <= 1560);
        assert.ok(profile.width <= width && profile.height <= height);
        assert.equal(profile.width % 2, 0);
        assert.equal(profile.height % 2, 0);
        assert.ok(Math.abs(profile.height - profile.width * height / width) < 4,
            `${width} × ${height} retains the selected framing after even-pixel rounding`);
    }
    assert.deepEqual(wallpaperCompatibilityProfile({ width: 1080, height: 2340 }), { width: 720, height: 1560, fps: 60 });
    assert.deepEqual(wallpaperCompatibilityProfile({ width: 576, height: 1024 }), { width: 576, height: 1024, fps: 60 });
    assert.deepEqual(wallpaperCompatibilityProfile({ width: 3840, height: 16 }), { width: 720, height: 16, fps: 60 },
        'Extremely thin footage retains the encoder minimum');
    assert.deepEqual(wallpaperCompatibilityProfile({ width: NaN, height: '' }), { width: 16, height: 16, fps: 60 },
        'The UI can describe a profile while size fields are incomplete');
    const settings = { ...DEFAULTS, fps: 60, method: 'natural', start: 10 };
    assert.deepEqual(wallpaperRange(settings, { duration: 100 }), { start: 10, end: 12 });
    for (const fps of [24, 30, 60]) {
        for (const method of METHODS.map(item => item.id)) {
            const selected = { ...DEFAULTS, fps, method, start: 40 };
            const actual = { ...selected, ...wallpaperCompatibilityProfile(selected) };
            const range = wallpaperRange(actual, { duration: 100 });
            assert.ok(Math.abs(framePlan({ ...actual, ...range }).duration - 2) <= 1 / 60,
                `Fit uses the Live Photo frame rate for ${method}, even when settings select ${fps} fps`);
            assert.equal(selected.fps, fps, 'Fitting the Live Photo range retains the selected frame rate for ordinary exports');
        }
    }
});

test('The first, middle, and final key photos select actual frames before the exclusive endpoint', () => {
    assert.equal(keyPhotoTime(3, 30, 0), 0);
    assert.equal(keyPhotoTime(3, 30, 50), 45 / 30);
    assert.equal(keyPhotoTime(3, 30, 100), 89 / 30);
    for (const [duration, fps, frameCount] of [[3, 30, 90], [1.125, 24, 27], [1 / 60, 60, 1], [3.01, 30, 90], [3, 30, 60]]) {
        for (const percent of [-100, 0, 17, 50, 100, 200]) {
            const time = keyPhotoTime(duration, fps, percent, frameCount);
            assert.ok(time >= 0 && time < duration);
            assert.ok(time * fps <= frameCount - 1);
            assert.ok(Math.abs(time * fps - Math.round(time * fps)) < 1e-8);
        }
    }
});

test('Live Photo validation uses actual encoding settings while rejecting invalid user inputs', () => {
    const info = { duration: 20 };
    const slow = { ...DEFAULTS, preset: 'iphone', format: 'mp4', audio: 'strip', repeats: 1,
        method: 'natural', start: 0, end: 2, fps: 1, width: 1170, height: 2532 };
    assert.ok(validate(slow, info).includes('Select at least three output frames.'));
    assert.deepEqual(validate(wallpaperExportSettings(slow), info), [],
        'A valid low selected frame rate does not block the actual 60 fps Live Photo');
    const large = { ...slow, method: 'pingpong', end: 3.1, fps: 60, width: 1290, height: 2796 };
    assert.ok(validate(large, info).some(issue => issue.includes('too much memory')));
    assert.deepEqual(validate(wallpaperExportSettings(large), info), [],
        'Memory validation measures the smaller video that will actually be encoded');
    for (const invalid of [{ width: NaN }, { width: 1171 }, { height: 15 }, { width: 4000 },
        { height: Infinity }, { fps: NaN }, { fps: 0 }, { fps: 61 }, { fps: 24.5 }]) {
        const original = { ...slow, fps: 30, ...invalid };
        const output = wallpaperExportSettings(original);
        assert.ok(validate(output, info).length > 0, `${JSON.stringify(invalid)} still rejects`);
        for (const key of Object.keys(invalid)) assert.equal(output[key], original[key], `Invalid ${key} is retained`);
    }
    assert.equal(slow.fps, 1);
    assert.deepEqual([large.width, large.height], [1290, 2796], 'Preparing an export does not modify preview settings');
});

test('Live Photo and wallpaper ZIPs contain a native PVT bundle with matching metadata and intact media', { skip: !native }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'perfectloop-wallpaper-kit-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const mp4 = join(dir, 'source.mp4'), mov = join(dir, 'source.mov'), jpg = join(dir, 'source.jpg');
    run(['-f', 'lavfi', '-i', 'testsrc2=s=96x144:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', mp4]);
    run(['-i', mp4, '-map', '0:v:0', '-c:v', 'copy', '-an', '-map_metadata', '-1', mov]);
    run(['-ss', '1.5', '-i', mp4, '-frames:v', '1', '-q:v', '2', jpg]);
    const decoded = path => run(['-i', path, '-map', '0:v:0', '-f', 'md5', 'pipe:1']).toString();
    class TrackedBlob extends Blob {
        reads = 0;
        async arrayBuffer() { this.reads++; return super.arrayBuffer(); }
    }
    for (const kind of ['live-photo', 'kit']) {
        const jpeg = new TrackedBlob([readFileSync(jpg)]), video = new TrackedBlob([readFileSync(mp4)]);
        const result = { blob: video, name: 'flowers-loop.mp4', width: 96, height: 144, duration: 3, fps: 30,
            hasAudio: false, wallpaper: { jpeg, mov: blob(mov), stillTime: 1.5 } };
        if (kind === 'kit') {
            Object.assign(result, { width: 1170, height: 2532, fps: 60, frames: 180 });
            Object.assign(result.wallpaper, { width: 96, height: 144, fps: 30, frames: 90, duration: 3, codec: 'h264' });
        }
        const output = await wallpaperDownload(result, kind);
        assert.equal(output.name, kind === 'live-photo' ? 'flowers-live-photo.pvt.zip' : 'flowers-wallpaper-kit.zip');
        assert.equal(output.blob.type, 'application/zip');
        assert.equal(video.reads, kind === 'kit' ? 1 : 0, 'The compact Live Photo does not read the MP4 fallback');
        assert.equal(jpeg.reads, kind === 'kit' ? 2 : 1, 'The compact Live Photo only reads the JPEG for pairing');
        const archive = join(dir, `${kind}.zip`);
        writeFileSync(archive, new Uint8Array(await output.blob.arrayBuffer()));
        const names = execFileSync('unzip', ['-Z1', archive]).toString().trim().split('\n').sort();
        const expected = ['live-photo.pvt/', 'live-photo.pvt/metadata.plist',
            'live-photo.pvt/photo.jpg', 'live-photo.pvt/photo.mov'];
        if (kind === 'kit') expected.push('README.txt', 'wallpaper-info.json', 'wallpaper.jpg', 'wallpaper.mp4');
        assert.deepEqual(names, expected.sort(), 'The archive includes an explicit PVT directory entry');
        const attributes = zipDirectoryAttributes(readFileSync(archive));
        assert.deepEqual(attributes.get('live-photo.pvt/'), { os: 0, attrs: 16 }, 'The bundle has a DOS directory attribute');
        const extracted = join(dir, kind);
        execFileSync('unzip', ['-q', archive, '-d', extracted]);
        if (kind === 'kit') {
            assert.deepEqual(readFileSync(join(extracted, 'wallpaper.mp4')), readFileSync(mp4));
            assert.deepEqual(readFileSync(join(extracted, 'wallpaper.jpg')), readFileSync(jpg));
        }
        const plist = readFileSync(join(extracted, 'live-photo.pvt/metadata.plist'), 'utf8');
        assert.match(plist, /<plist version="1\.0">\s*<dict>/);
        assert.match(plist, /<key>PFVideoComplementMetadataVersionKey<\/key>\s*<string>1<\/string>/,
            'The native PVT metadata version is a string');
        const pairMov = join(extracted, 'live-photo.pvt/photo.mov'), pairJpg = join(extracted, 'live-photo.pvt/photo.jpg');
        const media = probe(pairMov);
        const identifier = media.format.tags['com.apple.quicktime.content.identifier'];
        assert.match(identifier, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.ok(readFileSync(pairJpg).includes(Buffer.from(identifier)), 'The paired JPEG contains the same identifier');
        assert.equal(stillMarkerPacket(pairMov)?.pts_time, '1.500000');
        assert.equal(media.streams.find(stream => stream.codec_type === 'video').codec_name, 'h264');
        assert.equal(media.streams.some(stream => stream.codec_type === 'audio'), false);
        assert.equal(decoded(pairMov), decoded(mp4));
        assert.equal(decoded(pairJpg), decoded(jpg));
        if (kind === 'kit') {
            const info = JSON.parse(readFileSync(join(extracted, 'wallpaper-info.json'), 'utf8'));
            assert.equal(info.assetIdentifier, identifier);
            assert.deepEqual([info.width, info.height, info.fps, info.frames, info.codec], [96, 144, 30, 90, 'h264'],
                'Pairing uses the actual motion profile rather than outer render settings');
            assert.equal(info.livePhotoImport, 'experimental');
            assert.match(info.wallpaperEligibility, /verification.*iPhone/);
            assert.equal(info.keyPhotoTime, 1.5);
            const instructions = readFileSync(join(extracted, 'README.txt'), 'utf8');
            for (const phrase of ['Live Photo', 'Motion Not Available', 'Home Screen wallpaper is static', 'excluded from every exported file'])
                assert.ok(instructions.includes(phrase), phrase);
        }
    }
});

test('Video and image downloads retain their original bytes and use the correct filename and MIME type', async () => {
    const mp4 = new Blob(['video fixture'], { type: 'video/mp4' }), jpeg = new Blob(['image fixture'], { type: 'image/jpeg' });
    const result = { blob: mp4, name: 'flowers-loop.mp4', width: 96, height: 144, duration: 3, fps: 30,
        hasAudio: false, wallpaper: { jpeg, mov: new Blob([]), stillTime: 1.5 } };
    const video = await wallpaperDownload(result, 'video'), image = await wallpaperDownload(result, 'image');
    assert.equal(video.blob, mp4);
    assert.equal(video.blob.type, 'video/mp4');
    assert.equal(video.name, 'flowers-wallpaper.mp4');
    assert.equal(image.blob, jpeg);
    assert.equal(image.blob.type, 'image/jpeg');
    assert.equal(image.name, 'flowers-wallpaper.jpg');
    assert.equal(image.hasAudio, false);
    const stillOnly = await wallpaperDownload({ ...result, wallpaper: { jpeg, stillTime: 1.5 } }, 'image');
    assert.equal(stillOnly.blob, jpeg, 'A plain JPG does not require Live Photo motion preparation');
    await assert.rejects(wallpaperDownload(result, 'unknown'), /download format/);
    for (const kind of ['live-photo', 'kit'])
        await assert.rejects(wallpaperDownload({ ...result, wallpaper: undefined }, kind), /not ready/);
});

test('Cancelling either wallpaper package rejects before packaging and after asynchronous image reads', async () => {
    for (const kind of ['live-photo', 'kit']) {
        const before = new AbortController();
        before.abort();
        await assert.rejects(wallpaperDownload({ name: 'unused.mp4' }, kind, before.signal), { name: 'AbortError' });
        const during = new AbortController();
        // A minimal structurally readable JPEG lets the asynchronous pairing read
        // complete while cancellation arrives, before any archive is returned.
        const bytes = new Uint8Array([255, 216, 255, 218, 0, 2, 1, 255, 217]);
        class CancelDuringRead extends Blob {
            async arrayBuffer() { const value = await super.arrayBuffer(); during.abort(); return value; }
        }
        const result = { name: 'cancel-loop.mp4', blob: new Blob([]), width: 96, height: 144, duration: 3, fps: 30,
            wallpaper: { jpeg: new CancelDuringRead([bytes], { type: 'image/jpeg' }), mov: new Blob([]), stillTime: 1.5 } };
        await assert.rejects(wallpaperDownload(result, kind, during.signal), { name: 'AbortError' });
        assert.equal(result.blob.size, 0, 'The original result is not replaced by a partial package');
    }
});

function nativeWallpaper(t) {
    const dir = mkdtempSync(join(tmpdir(), 'perfectloop-direct-pvt-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const mp4 = join(dir, 'source.mp4'), mov = join(dir, 'source.mov'), jpg = join(dir, 'source.jpg');
    run(['-f', 'lavfi', '-i', 'testsrc2=s=96x144:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', mp4]);
    run(['-i', mp4, '-map', '0:v:0', '-c:v', 'copy', '-an', '-map_metadata', '-1', mov]);
    run(['-ss', '1.5', '-i', mp4, '-frames:v', '1', '-q:v', '2', jpg]);
    return { dir, mp4, jpg, result: { name: 'flowers-loop.mp4', blob: blob(mp4), width: 96, height: 144,
        duration: 3, fps: 30, wallpaper: { jpeg: blob(jpg), mov: blob(mov), stillTime: 1.5 } } };
}

function memoryFolder(hooks = {}) {
    const entries = new Map();
    const removed = [], abortedWrites = [];
    const parent = {
        entries, removed, abortedWrites,
        async getDirectoryHandle(name, options = {}) {
            await hooks.lookup?.(name, options);
            if (entries.has(name)) {
                const entry = entries.get(name);
                if (entry.kind !== 'directory') throw new DOMException('A file already has that name.', 'TypeMismatchError');
                return entry;
            }
            if (!options.create) throw new DOMException('No such entry.', 'NotFoundError');
            const directory = {
                kind: 'directory', files: new Map(),
                async getFileHandle(filename, options) {
                    assert.equal(options.create, true);
                    if (!this.files.has(filename)) this.files.set(filename, null);
                    return { async createWritable() {
                        let pending;
                        return {
                            async write(source) {
                                assert.ok(source instanceof Blob, 'Real media blobs are written without ZIP packaging');
                                pending = source;
                                await hooks.write?.(filename, source);
                            },
                            async close() {
                                await hooks.close?.(filename);
                                directory.files.set(filename, pending);
                            },
                            async abort() { abortedWrites.push(filename); pending = undefined; },
                        };
                    } };
                },
            };
            entries.set(name, directory);
            return directory;
        },
        async removeEntry(name, options) {
            assert.equal(options.recursive, true);
            await hooks.remove?.(name);
            removed.push(name);
            entries.delete(name);
        },
    };
    return parent;
}

test('Direct PVT saves write one actual package with paired media and no archive', { skip: !native }, async t => {
    const { dir, mp4, jpg, result } = nativeWallpaper(t);
    const parent = memoryFolder();
    const output = await saveWallpaperPackage(result, parent);
    assert.match(output.name, /^flowers-live-photo-[0-9a-f-]{36}\.pvt$/);
    assert.equal(output.blob, undefined, 'Direct export returns a saved package, not an archive to download');
    assert.equal(parent.entries.size, 1);
    const files = parent.entries.get(output.name).files;
    assert.deepEqual([...files.keys()].sort(), ['metadata.plist', 'photo.jpg', 'photo.mov']);
    assert.equal(output.bytes, [...files.values()].reduce((sum, source) => sum + source.size, 0));
    assert.match(await files.get('metadata.plist').text(), /<key>PFVideoComplementMetadataVersionKey<\/key>\s*<string>1<\/string>/);
    for (const [name, source] of files) writeFileSync(join(dir, name), new Uint8Array(await source.arrayBuffer()));
    const media = probe(join(dir, 'photo.mov'));
    assert.equal(media.format.tags['com.apple.quicktime.content.identifier'], output.identifier);
    assert.ok(readFileSync(join(dir, 'photo.jpg')).includes(Buffer.from(output.identifier)));
    assert.equal(stillMarkerPacket(join(dir, 'photo.mov'))?.pts_time, '1.500000');
    assert.equal(media.streams.some(stream => stream.codec_type === 'audio'), false);
    const decoded = path => run(['-i', path, '-map', '0:v:0', '-f', 'md5', 'pipe:1']).toString();
    assert.equal(decoded(join(dir, 'photo.mov')), decoded(mp4));
    assert.equal(decoded(join(dir, 'photo.jpg')), decoded(jpg));
});

test('Direct PVT saving preserves existing packages and files with colliding names', { skip: !native }, async t => {
    const { result } = nativeWallpaper(t);
    t.mock.method(crypto, 'getRandomValues', bytes => bytes.fill(0x23));
    const stem = 'flowers-live-photo-23232323-2323-4323-a323-232323232323';
    const parent = memoryFolder();
    const existing = { kind: 'directory', files: new Map([['photo.jpg', new Blob(['user photo'])]]) };
    const file = { kind: 'file', blob: new Blob(['user file']) };
    parent.entries.set(`${stem}.pvt`, existing);
    parent.entries.set(`${stem}-2.pvt`, file);
    const output = await saveWallpaperPackage(result, parent);
    assert.equal(output.name, `${stem}-3.pvt`);
    assert.equal(parent.entries.get(`${stem}.pvt`), existing);
    assert.equal(await existing.files.get('photo.jpg').text(), 'user photo');
    assert.equal(parent.entries.get(`${stem}-2.pvt`), file);
    assert.equal(await file.blob.text(), 'user file');
    assert.deepEqual(parent.removed, []);
});

test('Direct PVT saving rejects an unavailable or refused folder before creating a package', { skip: !native }, async t => {
    const { result } = nativeWallpaper(t);
    await assert.rejects(saveWallpaperPackage(result, undefined), /writable folder/);
    const refused = memoryFolder({ lookup() { throw new DOMException('Write permission denied.', 'NotAllowedError'); } });
    await assert.rejects(saveWallpaperPackage(result, refused), { name: 'NotAllowedError' });
    assert.equal(refused.entries.size, 0);
    const cancelled = new AbortController();
    cancelled.abort();
    const unused = memoryFolder();
    await assert.rejects(saveWallpaperPackage(result, unused, cancelled.signal), { name: 'AbortError' });
    assert.equal(unused.entries.size, 0);
    const invalid = memoryFolder();
    await assert.rejects(saveWallpaperPackage({ ...result, wallpaper: undefined }, invalid), /not ready/);
    assert.equal(invalid.entries.size, 0, 'Invalid paired media never creates a partial package');
});

test('Interrupted PVT writes remove their partial package and identify any cleanup failure', { skip: !native }, async t => {
    const { result } = nativeWallpaper(t);
    const cancelled = new AbortController();
    const duringWrite = memoryFolder({ write(filename) { if (filename === 'photo.mov') cancelled.abort(); } });
    await assert.rejects(saveWallpaperPackage(result, duringWrite, cancelled.signal), { name: 'AbortError' });
    assert.equal(duringWrite.entries.size, 0);
    assert.equal(duringWrite.removed.length, 1);
    assert.deepEqual(duringWrite.abortedWrites, ['photo.mov']);

    const writeFailure = new DOMException('The disk is full.', 'QuotaExceededError');
    const full = memoryFolder({ close(filename) { if (filename === 'photo.mov') throw writeFailure; } });
    await assert.rejects(saveWallpaperPackage(result, full), error => error === writeFailure);
    assert.equal(full.entries.size, 0);
    assert.equal(full.removed.length, 1);

    const blockedCancellation = new AbortController();
    const blocked = memoryFolder({
        write() { blockedCancellation.abort(); },
        remove() { throw new DOMException('Folder access was revoked.', 'NotAllowedError'); },
    });
    await assert.rejects(saveWallpaperPackage(result, blocked, blockedCancellation.signal), error => {
        assert.equal(error.name, 'Error', 'An unremoved partial package is not reported as a clean cancellation');
        assert.equal(error.cause.name, 'AbortError');
        assert.equal(error.cleanupError.name, 'NotAllowedError');
        assert.ok(blocked.entries.has(error.partialPackageName));
        assert.ok(error.message.includes(error.partialPackageName));
        assert.match(error.message, /Delete that package/);
        return true;
    });
});
