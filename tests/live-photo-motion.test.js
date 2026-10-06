import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { livePhotoMov } from '../js/live-photo.js';
import { neutralMotionPayload, MOTION_SETUP_PLIST } from '../js/live-photo-motion.js';

const identifier = '01234567-89AB-4CDE-8FED-0123456789AB';
let native = true, hevc = false;
try {
    hevc = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes('libx265');
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
} catch { native = false; }
const ffmpeg = args => execFileSync('ffmpeg', ['-v', 'error', '-y', '-threads', '1', '-filter_threads', '1', ...args], { maxBuffer: 4 * 1024 ** 2, stdio: ['ignore', 'pipe', 'ignore'] });
const probe = (path, args = ['-show_streams', '-show_format']) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', path], { maxBuffer: 4 * 1024 ** 2 }));

function boxes(bytes, start = 0, end = bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
    for (let offset = start; offset < end;) {
        const size = view.getUint32(offset);
        assert.ok(size >= 8 && offset + size <= end, 'The atom fits inside its parent');
        result.push({ start: offset, body: offset + 8, end: offset + size,
            type: view.getUint32(offset + 4), name: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) });
        offset += size;
    }
    return result;
}
const child = (bytes, parent, name) => boxes(bytes, parent.body, parent.end).find(item => item.name === name);

function assertPayload(bytes, nanoseconds) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(bytes.length, 136);
    assert.equal(view.getUint32(0, true), 3);
    assert.equal(view.getFloat32(24, true), 0);
    assert.equal(view.getFloat32(28, true), 0);
    assert.equal(view.getFloat32(32, true), 1);
    assert.equal(view.getUint16(42, true), 0x18);
    for (const offset of [44, 48, 52, 56, 60]) assert.equal(view.getUint32(offset, true), 0);
    assert.equal(view.getUint16(64, true), 0x27);
    assert.equal(view.getUint16(66, true), 0);
    assert.deepEqual(Array.from({ length: 9 }, (_, index) => view.getFloat32(68 + index * 4, true)), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    assert.equal(view.getBigUint64(104, true), nanoseconds);
    assert.equal(view.getBigUint64(112, true), nanoseconds);
    assert.ok(bytes.subarray(120).every(value => value === 0));
    assert.ok(bytes.subarray(4, 24).every(value => value === 0), 'No exposure, focus, or camera movement is declared');
}

test('Generated V3 records describe distinct output-frame times without donor capture fields', () => {
    const packets = new Set();
    for (const fps of [12, 15, 24, 25, 30, 48, 50, 60]) {
        for (let frame = 0; frame < fps * 2; frame++) {
            const payload = neutralMotionPayload(frame * (60000 / fps), 60000);
            assertPayload(payload, BigInt(Math.round(frame * 1_000_000_000 / fps)));
            packets.add(Buffer.from(payload).toString('hex'));
        }
    }
    assert.ok(packets.size > 120);
    assert.match(MOTION_SETUP_PLIST, /<key>LivePhotoMetadataSetupDataVersion<\/key><integer>1<\/integer>/);
    for (const claim of ['FrameworkVersions', 'SystemVersion', 'GPS', 'Make', 'Model']) assert.ok(!MOTION_SETUP_PLIST.includes(claim));
    for (const [ticks, timescale] of [[-1, 60000], [1.1, 60000], [0, 0], [NaN, 60000]])
        assert.throws(() => neutralMotionPayload(ticks, timescale), /sample timing/);
});

test('Partial or invalid detailed metadata is rejected before reading the movie', async () => {
    const source = new Blob([]);
    source.arrayBuffer = () => { throw new Error('Invalid options must be rejected first'); };
    for (const options of [{ width: 96 }, { frames: 60 }, { width: 0, height: 144, frames: 60 },
        { width: 96, height: 144, frames: 0 }, { width: 96, height: 144, frames: 60.5 },
        { width: 65536, height: 144, frames: 60 }, { width: 96, height: 144, frames: 0xffffffff }])
        await assert.rejects(livePhotoMov(source, identifier, { stillTime: 1, fps: 30, ...options }), /dimensions and frame count/);
});

for (const [codec, fps, duration, audio] of [['libx264', 30, 3, true], ['libx265', 60, 2, false]]) {
    test(`Native readers preserve ${codec} media and find every generated frame's metadata`, { skip: !native || (codec === 'libx265' && !hevc) }, async t => {
        const dir = mkdtempSync(join(tmpdir(), 'perfectloop-live-motion-'));
        t.after(() => rmSync(dir, { recursive: true, force: true }));
        const original = join(dir, 'original.mov'), output = join(dir, 'paired.mov');
        ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=96x144:r=${fps}:d=${duration}`,
            ...(audio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`] : []),
            '-c:v', codec, '-pix_fmt', 'yuv420p', ...(codec === 'libx265' ? ['-x265-params', 'pools=none:frame-threads=1:log-level=error', '-tag:v', 'hvc1'] : []),
            ...(audio ? ['-c:a', 'aac'] : ['-an']), '-map_metadata', '-1', original]);
        const frames = fps * duration, stillTime = duration / 2;
        const paired = await livePhotoMov(new Blob([readFileSync(original)]), identifier, { width: 96, height: 144, frames, fps, stillTime });
        const bytes = Buffer.from(await paired.arrayBuffer()); writeFileSync(output, bytes);
        const originalInfo = probe(original), info = probe(output);
        const metadata = info.streams.filter(stream => stream.codec_tag_string === 'mebx');
        assert.equal(metadata.length, 2);
        assert.equal(info.format.tags['com.apple.quicktime.content.identifier'], identifier);
        const motion = metadata.find(stream => Number(stream.nb_frames) === frames);
        const marker = metadata.find(stream => stream.nb_frames === '1');
        assert.equal(Number(motion.start_time), 0);
        assert.equal(Number(motion.duration), duration);
        assert.equal(Number(marker.start_time), stillTime);
        const samples = probe(output, ['-select_streams', 'd', '-show_packets']).packets;
        const motionSamples = samples.filter(sample => sample.stream_index === motion.index);
        assert.equal(motionSamples.length, frames);
        const distinct = new Set();
        for (let frame = 0; frame < frames; frame++) {
            const packet = motionSamples[frame], offset = Number(packet.pos);
            assert.equal(Number(packet.size), 144);
            assert.ok(Math.abs(Number(packet.pts_time) - frame / fps) <= 0.000001);
            assert.ok(Math.abs(Number(packet.duration_time) - 1 / fps) <= 0.000001);
            assert.equal(bytes.readUInt32BE(offset), 144); assert.equal(bytes.readUInt32BE(offset + 4), 1);
            const payload = bytes.subarray(offset + 8, offset + 144);
            assertPayload(payload, BigInt(Math.round(frame * 1_000_000_000 / fps)));
            distinct.add(payload.toString('hex'));
        }
        assert.equal(distinct.size, frames);
        const still = samples.find(sample => sample.stream_index === marker.index), stillOffset = Number(still.pos);
        assert.equal(Number(still.size), 105);
        assert.deepEqual([...bytes.subarray(stillOffset, stillOffset + 9)], [0, 0, 0, 9, 0, 0, 0, 1, 255]);
        assert.equal(bytes.readUInt32BE(stillOffset + 9), 80);
        assert.equal(bytes.readUInt32BE(stillOffset + 13), 2);
        assert.deepEqual(Array.from({ length: 9 }, (_, index) => bytes.readDoubleBE(stillOffset + 17 + index * 8)), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
        assert.equal(bytes.readUInt32BE(stillOffset + 89), 16);
        assert.equal(bytes.readUInt32BE(stillOffset + 93), 3);
        assert.equal(bytes.readFloatBE(stillOffset + 97), 96); assert.equal(bytes.readFloatBE(stillOffset + 101), 144);

        const moov = boxes(bytes).find(item => item.name === 'moov'), tracks = boxes(bytes, moov.body, moov.end).filter(item => item.name === 'trak');
        const videoId = Number(originalInfo.streams.find(stream => stream.codec_type === 'video').id);
        for (const stream of metadata) {
            const track = tracks.find(item => bytes.readUInt32BE(child(bytes, item, 'tkhd').body + 12) === Number(stream.id));
            const reference = child(bytes, child(bytes, track, 'tref'), 'cdsc');
            assert.equal(bytes.readUInt32BE(reference.body), videoId);
            const mdia = child(bytes, track, 'mdia'), minf = child(bytes, mdia, 'minf'), stbl = child(bytes, minf, 'stbl');
            const stsd = child(bytes, stbl, 'stsd'), entry = boxes(bytes, stsd.body + 8, stsd.end)[0];
            const keys = boxes(bytes, entry.body + 8, entry.end).find(item => item.name === 'keys');
            const definitions = boxes(bytes, keys.body, keys.end);
            if (stream === motion) {
                assert.equal(definitions.length, 1);
                const definition = definitions[0], fields = boxes(bytes, definition.body, definition.end);
                const key = fields.find(item => item.name === 'keyd'), type = fields.find(item => item.name === 'dtyp');
                assert.equal(bytes.subarray(key.body, key.end).toString(), 'mdtacom.apple.quicktime.live-photo-info');
                assert.equal(bytes.readUInt32BE(type.body), 1);
                assert.equal(bytes.subarray(type.body + 4, type.end).toString(), 'com.apple.quicktime.com.apple.quicktime.live-photo-info');
                const setup = fields.find(item => item.name === 'setu'), version = child(bytes, setup, 'cfgv'), dimensions = child(bytes, setup, 'dims');
                assert.equal(bytes.subarray(version.body, version.end).toString(), MOTION_SETUP_PLIST);
                assert.equal(bytes.readUInt32BE(dimensions.body), 96); assert.equal(bytes.readUInt32BE(dimensions.body + 4), 144);
            } else {
                assert.equal(definitions.length, 3);
                assert.deepEqual(definitions.map(definition => bytes.readUInt32BE(child(bytes, definition, 'dtyp').body + 4)), [65, 83, 71]);
            }
        }
        const packets = (path, type) => probe(path, ['-select_streams', type, '-show_packets', '-show_data_hash', 'sha256',
            '-show_entries', 'packet=pts,dts,duration,size,data_hash']).packets;
        assert.deepEqual(packets(output, 'v'), packets(original, 'v'));
        if (audio) assert.deepEqual(packets(output, 'a'), packets(original, 'a'));
        const pixels = path => ffmpeg(['-i', path, '-map', '0:v:0', '-f', 'md5', 'pipe:1']).toString();
        assert.equal(pixels(output), pixels(original));
        for (const changed of [{ frames: frames - 1 }, { fps: fps / 2 }, { width: 144, height: 96 }])
            await assert.rejects(livePhotoMov(new Blob([readFileSync(original)]), identifier, { width: 96, height: 144, frames, fps, stillTime, ...changed }), /does not match|dimensions|matching constant frame rate/);
    });
}

test('Detailed timing rejects shifted or inconsistent presentation timelines', { skip: !native }, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'perfectloop-live-motion-timing-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const original = join(dir, 'original.mov'), shifted = join(dir, 'shifted.mov');
    const inputs = ['-f', 'lavfi', '-i', 'testsrc2=s=96x144:r=30:d=3', '-c:v', 'libx264', '-an', '-map_metadata', '-1'];
    ffmpeg([...inputs, original]);
    ffmpeg([...inputs, '-output_ts_offset', '0.5', shifted]);
    const options = { width: 96, height: 144, frames: 90, fps: 30, stillTime: 1.5 };
    await assert.rejects(livePhotoMov(new Blob([readFileSync(shifted)]), identifier, options), /starting at zero/);
    const bytes = readFileSync(original), moov = boxes(bytes).find(item => item.name === 'moov');
    const track = boxes(bytes, moov.body, moov.end).find(item => item.name === 'trak');
    const mdia = child(bytes, track, 'mdia'), minf = child(bytes, mdia, 'minf'), stbl = child(bytes, minf, 'stbl');
    const ctts = child(bytes, stbl, 'ctts');
    assert.ok(ctts, 'The test fixture contains reordered video frames');
    bytes.writeUInt32BE(bytes.readUInt32BE(ctts.body + 12) + 512, ctts.body + 12);
    await assert.rejects(livePhotoMov(new Blob([bytes]), identifier, options), /presentation frame rate/);
    // Ordinary pairing retains its historical API for arbitrary regular MOVs.
    const generic = await livePhotoMov(new Blob([readFileSync(shifted)]), identifier, { stillTime: 1.5, fps: 30 });
    assert.equal(generic.type, 'video/quicktime');
});
