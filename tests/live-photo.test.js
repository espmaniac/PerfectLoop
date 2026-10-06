import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { livePhotoJpeg, livePhotoMov } from '../js/live-photo.js';

const identifier = '01234567-89AB-4CDE-8FED-0123456789AB';
let native = true;
try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
} catch { native = false; }
const ffmpeg = args => execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '1', '-filter_threads', '1', ...args], { maxBuffer: 4 * 1024 ** 2 });
const probe = (path, args = ['-show_streams', '-show_format']) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', path], { maxBuffer: 4 * 1024 ** 2 }));
const blob = path => new Blob([readFileSync(path)]);
const save = async (path, result) => writeFileSync(path, new Uint8Array(await result.arrayBuffer()));

test('Live Photo writers reject invalid identifiers and malformed image/movie data', async () => {
    const empty = new Blob([]);
    await assert.rejects(livePhotoJpeg(empty, 'not-a-uuid', { width: 96, height: 144 }), /UUID/);
    await assert.rejects(livePhotoJpeg(empty, identifier, { width: 0, height: 144 }), /dimensions/);
    await assert.rejects(livePhotoJpeg(empty, identifier, { width: 96, height: 144 }), /JPEG/);
    await assert.rejects(livePhotoJpeg(new Blob([new Uint8Array([255, 216, 255, 217])]), identifier, { width: 96, height: 144 }), /image scan/);
    await assert.rejects(livePhotoMov(empty, identifier, { stillTime: NaN, fps: 30 }), /key-photo time/);
    await assert.rejects(livePhotoMov(new Blob([new Uint8Array([0, 0, 0, 1, 109, 111, 111, 118])]), identifier, { stillTime: 0, fps: 30 }), /Truncated/);
});

test('Native readers find paired UUID and correctly timed still markers without changing H.264/AAC packets', { skip: !native }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'perfectloop-live-photo-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const original = join(dir, 'original.mov');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=96x144:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-map_metadata', '-1', original]);
    const packets = path => probe(path, ['-select_streams', 'v', '-show_packets', '-show_data_hash', 'sha256',
        '-show_entries', 'packet=pts,dts,duration,size,data_hash']).packets;
    const audioPackets = path => probe(path, ['-select_streams', 'a', '-show_packets', '-show_data_hash', 'sha256',
        '-show_entries', 'packet=pts,dts,duration,size,data_hash']).packets;
    const video = packets(original), audio = audioPackets(original);
    for (const stillTime of [0, 1.5, 89 / 30]) {
        const output = join(dir, `paired-${stillTime}.mov`);
        await save(output, await livePhotoMov(blob(original), identifier, { stillTime, fps: 30 }));
        const metadata = probe(output);
        assert.equal(metadata.format.tags.major_brand, 'qt  ');
        assert.equal(metadata.format.tags['com.apple.quicktime.content.identifier'], identifier);
        assert.equal(metadata.format.duration, '3.000000');
        const marker = metadata.streams.find(stream => stream.codec_tag_string === 'mebx');
        assert.ok(marker, 'A real timed metadata track is present');
        assert.equal(marker.codec_type, 'data');
        assert.ok(Math.abs(Number(marker.start_time) - stillTime) <= 0.00051);
        assert.equal(marker.nb_frames, '1');
        const markerPackets = probe(output, ['-select_streams', 'd', '-show_packets', '-show_data']).packets;
        assert.equal(markerPackets.length, 1);
        assert.match(markerPackets[0].data, /0000 0009 0000 0001 ff/);
        assert.deepEqual(packets(output), video, 'All compressed video packets and timing remain unchanged');
        assert.deepEqual(audioPackets(output), audio, 'All compressed audio packets and timing remain unchanged');
        const frameHash = path => ffmpeg(['-i', path, '-map', '0:v:0', '-f', 'md5', 'pipe:1']).toString();
        assert.equal(frameHash(output), frameHash(original), 'The full decoded movie is unchanged');
        await assert.rejects(livePhotoMov(blob(output), identifier, { stillTime, fps: 30 }), /already contains/);
    }
    await assert.rejects(livePhotoMov(blob(original), identifier, { stillTime: 3, fps: 30 }), /outside/);
    const mp4 = join(dir, 'wrong-container.mp4'), fast = join(dir, 'fast-start.mov');
    ffmpeg(['-i', original, '-map', '0', '-c', 'copy', mp4]);
    ffmpeg(['-i', original, '-map', '0', '-c', 'copy', '-movflags', '+faststart', fast]);
    await assert.rejects(livePhotoMov(blob(mp4), identifier, { stillTime: 1.5, fps: 30 }), /QuickTime MOV/);
    await assert.rejects(livePhotoMov(blob(fast), identifier, { stillTime: 1.5, fps: 30 }), /header at the end/);
});

test('Adding and replacing JPEG pairing metadata preserves decoded still pixels', { skip: !native }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'perfectloop-live-still-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const original = join(dir, 'original.jpg'), paired = join(dir, 'paired.jpg'), repaired = join(dir, 'repaired.jpg');
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=96x144:r=1', '-frames:v', '1', '-q:v', '2', original]);
    await save(paired, await livePhotoJpeg(blob(original), identifier, { width: 96, height: 144 }));
    const nextIdentifier = 'ABCDEF01-2345-4CDE-8FED-0123456789AB';
    await save(repaired, await livePhotoJpeg(blob(paired), nextIdentifier, { width: 96, height: 144 }));
    const pixels = path => ffmpeg(['-i', path, '-f', 'md5', 'pipe:1']).toString();
    assert.equal(pixels(paired), pixels(original));
    assert.equal(pixels(repaired), pixels(original));
    const bytes = readFileSync(repaired);
    assert.equal(bytes.indexOf(identifier), -1, 'Previous EXIF pairing identifier is removed');
    assert.ok(bytes.indexOf(nextIdentifier) > 0, 'Replacement identifier is present');
    assert.equal(bytes.indexOf(nextIdentifier, bytes.indexOf(nextIdentifier) + 1), -1);
    assert.equal(probe(repaired).streams[0].width, 96);
    assert.equal(probe(repaired).streams[0].height, 144);
});
