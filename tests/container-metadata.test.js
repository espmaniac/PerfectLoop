import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { containerMetadata } from '../js/container-metadata.js';

const u32 = value => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
const text = value => [...value].map(c => c.charCodeAt(0));
function box(type, ...parts) {
    const body = parts.flat();
    return [...u32(body.length + 8), ...text(type), ...body];
}
function largeBox(type, ...parts) {
    const body = parts.flat();
    return [...u32(1), ...text(type), 0, 0, 0, 0, ...u32(body.length + 16), ...body];
}
function track(handler, timescale, entries, { version = 0 } = {}) {
    const mdhd = version === 1
        ? box('mdhd', [1, 0, 0, 0], new Array(16).fill(0), u32(timescale), new Array(8).fill(0), [0, 0, 0, 0])
        : box('mdhd', [0, 0, 0, 0], new Array(8).fill(0), u32(timescale), u32(0), [0, 0, 0, 0]);
    const stts = box('stts', [0, 0, 0, 0], u32(entries.length), ...entries.map(([count, delta]) => [...u32(count), ...u32(delta)]));
    return box('trak', box('mdia', mdhd, box('hdlr', [0, 0, 0, 0], u32(0), text(handler), new Array(12).fill(0)),
        box('minf', box('stbl', stts))));
}
const file = (...parts) => new Blob([new Uint8Array(parts.flat())]);
const ftyp = box('ftyp', text('isom'), u32(512), text('isom'));

test('The bundled sample reports its frame rate, video duration, and audio track without the engine', async () => {
    const sample = await readFile(new URL('../sample.mp4', import.meta.url));
    assert.deepEqual(await containerMetadata(new Blob([sample])), { fps: 24, videoDuration: 18, hasAudio: true });
});

test('Variable sample durations give the average frame rate of the video track', async () => {
    const metadata = await containerMetadata(file(ftyp, box('moov', track('vide', 600, [[50, 20], [10, 40]]))));
    assert.equal(metadata.videoDuration, 1400 / 600);
    assert.equal(metadata.fps, 60 * 600 / 1400);
    assert.equal(metadata.hasAudio, false);
});

test('A movie box after the media data, 64-bit sizes, and version 1 headers are read', async () => {
    const media = largeBox('mdat', new Array(64).fill(7));
    const metadata = await containerMetadata(file(ftyp, media, box('moov', track('soun', 48000, [[100, 1024]]), track('vide', 30000, [[300, 1001]], { version: 1 }))));
    assert.deepEqual(metadata, { fps: 30000 / 1001, videoDuration: 10.01, hasAudio: true });
});

test('Files the reader cannot vouch for fall back to the engine', async () => {
    assert.equal(await containerMetadata(file(ftyp, box('moov', track('vide', 1000, [])))), null, 'Fragmented MP4 keeps samples outside moov');
    assert.equal(await containerMetadata(file(ftyp, box('moov', track('soun', 48000, [[10, 1024]])))), null, 'No video track');
    assert.equal(await containerMetadata(file([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 2, 3, 4, 5, 6, 7, 8])), null, 'WebM');
    assert.equal(await containerMetadata(file(ftyp, [0, 0, 0, 4, ...text('moov')])), null, 'Corrupt box size');
    assert.equal(await containerMetadata(file(ftyp, box('moov', [0, 0, 0, 200, ...text('trak')]))), null, 'Truncated child box');
});
