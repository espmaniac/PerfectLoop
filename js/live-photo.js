// Live Photos pair a JPEG Apple MakerNote (tag 17) with a QuickTime movie's
// content identifier and a boxed, timed still-image-time metadata sample.
// Format references: https://github.com/LimitPoint/LivePhoto#live-photo-format
// and Apple's QuickTime File Format, Metadata Media chapter. The structures
// below were checked against the AVFoundation-produced sample in that repo.
// These pairing fields do not establish iOS Lock Screen motion eligibility.
import { MOTION_PAYLOAD_SIZE, MOTION_SETUP_PLIST, neutralMotionPayload } from './live-photo-motion.js';

const encoder = new TextEncoder();
const text = value => encoder.encode(value);
const zeros = length => new Uint8Array(length);
function concatenate(...parts) {
    const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
}
function integers(width, values) {
    const result = zeros(width * values.length), view = new DataView(result.buffer);
    values.forEach((value, index) => width === 2 ? view.setUint16(index * width, value) : view.setUint32(index * width, value));
    return result;
}
const short = (...values) => integers(2, values);
const long = (...values) => integers(4, values);
const atom = (name, ...parts) => {
    const payload = concatenate(...parts);
    return concatenate(long(payload.length + 8), typeof name === 'number' ? long(name) : text(name), payload);
};
const fullAtom = (name, ...parts) => atom(name, long(0), ...parts);
const unityMatrix = () => long(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
function identifierCheck(identifier) {
    if (typeof identifier !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(identifier))
        throw new Error('Live Photo requires a UUID identifier.');
}

/** Embed the pairing UUID while retaining the original compressed JPEG pixels. */
export async function livePhotoJpeg(blob, identifier, { width, height } = {}) {
    identifierCheck(identifier);
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 0xffffffff))
        throw new Error('Live Photo requires valid still-image dimensions.');
    const source = new Uint8Array(await blob.arrayBuffer());
    if (source[0] !== 0xff || source[1] !== 0xd8)
        throw new Error('Live Photo still must be a JPEG.');

    // Apple IFD offsets are relative to the MakerNote, whose IFD starts at 14.
    const uuid = text(`${identifier}\0`);
    const maker = concatenate(text('Apple iOS\0'), short(1), text('MM'), short(1),
        short(17, 2), long(uuid.length, 32), long(0), uuid);
    const entry = (tag, type, count, value) => concatenate(short(tag, type), long(count, value));
    const software = text('PerfectLoop\0');
    const exifOffset = 8 + 2 + 3 * 12 + 4;
    const softwareOffset = exifOffset + 2 + 6 * 12 + 4;
    const makerOffset = softwareOffset + software.length + (software.length % 2);
    const tiff = concatenate(text('MM'), short(42), long(8), short(3),
        entry(0x0131, 2, software.length, softwareOffset), entry(0x0213, 3, 1, 0x10000), entry(0x8769, 4, 1, exifOffset), long(0),
        short(6), entry(0x9000, 7, 4, 0x30323332), entry(0x9101, 7, 4, 0x01020300),
        entry(0x927c, 7, maker.length, makerOffset), entry(0xa001, 3, 1, 0x10000),
        entry(0xa002, 4, 1, width), entry(0xa003, 4, 1, height), long(0),
        software, zeros(software.length % 2), maker);
    const exif = concatenate(text('Exif\0\0'), tiff);
    const segment = concatenate(new Uint8Array([0xff, 0xe1]), short(exif.length + 2), exif);
    const parts = [source.subarray(0, 2), segment];
    // Remove previous EXIF segments, so readers cannot pick a stale identifier.
    // All other headers and the entire scan data stay byte-for-byte unchanged.
    let at = 2;
    while (at < source.length) {
        const start = at;
        if (source[at++] !== 0xff) throw new Error('Invalid JPEG header.');
        while (source[at] === 0xff) at++;
        const marker = source[at++];
        if (marker === 0xd9) throw new Error('JPEG has no image scan.');
        if (marker === undefined || at + 2 > source.length) throw new Error('Truncated JPEG header.');
        const size = source[at] * 256 + source[at + 1];
        if (size < 2 || at + size > source.length) throw new Error('Invalid JPEG segment length.');
        if (marker === 0xda) { parts.push(source.subarray(start)); break; }
        const oldExif = marker === 0xe1 && String.fromCharCode(...source.subarray(at + 2, at + 8)) === 'Exif\0\0';
        if (!oldExif) parts.push(source.subarray(start, at + size));
        at += size;
    }
    if (at >= source.length) throw new Error('JPEG has no image scan.');
    return new Blob(parts, { type: 'image/jpeg' });
}

function atoms(bytes, start = 0, end = bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
    for (let at = start; at < end;) {
        if (at + 8 > end) throw new Error('Truncated QuickTime atom.');
        let size = view.getUint32(at), header = 8;
        if (size === 1) {
            if (at + 16 > end) throw new Error('Truncated QuickTime atom.');
            size = Number(view.getBigUint64(at + 8)); header = 16;
        }
        if (size === 0) size = end - at;
        if (!Number.isSafeInteger(size) || size < header || at + size > end)
            throw new Error('Invalid QuickTime atom length.');
        const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        result.push({ name, start: at, body: at + header, end: at + size });
        at += size;
    }
    return result;
}

function movieMetadata(identifier) {
    const key = 'com.apple.quicktime.content.identifier';
    return atom('meta', fullAtom('hdlr', long(0), text('mdta'), zeros(14)),
        fullAtom('keys', long(1), atom('mdta', text(key))),
        atom('ilst', atom(1, atom('data', long(1, 0), text(identifier)))));
}

function metadataDescription(entries) {
    return atom('mebx', zeros(6), short(1), atom('keys', ...entries.map(([key, type, setup], index) => atom(index + 1,
        atom('keyd', text(`mdta${key}`)), typeof type === 'number' ? atom('dtyp', long(0, type)) : atom('dtyp', long(1), text(type)),
        ...(setup ? [atom('setu', setup), atom('ctps', atom('dtyp', long(0, 0)))] : [])))));
}

function stillTrack({ id, timescale, stillTicks, sampleTicks, offset, sampleSize, description, videoId }) {
    const edits = stillTicks === 0 ? long(1, sampleTicks, 0, 0x10000)
        : long(2, stillTicks, 0xffffffff, 0x10000, sampleTicks, 0, 0x10000);
    return atom('trak',
        atom('tkhd', long(15, 0, 0, id, 0, stillTicks + sampleTicks), zeros(16), unityMatrix(), zeros(8)),
        ...(videoId ? [atom('tref', atom('cdsc', long(videoId)))] : []),
        atom('edts', fullAtom('elst', edits)),
        atom('mdia', fullAtom('mdhd', long(0, 0, timescale, sampleTicks), short(0x55c4, 0)),
            fullAtom('hdlr', text('mhlrmetaappl'), long(1, 0), new Uint8Array([19]), text('Core Media Metadata')),
            atom('minf', atom('gmhd', fullAtom('gmin', short(0x40, 0x8000, 0x8000, 0x8000, 0, 0))),
                atom('dinf', fullAtom('dref', long(1), atom('alis', long(1)))),
                atom('stbl', fullAtom('stsd', long(1), description), fullAtom('stts', long(1, 1, sampleTicks)),
                    fullAtom('stsc', long(1, 1, 1, 1)), fullAtom('stsz', long(sampleSize, 1)), fullAtom('stco', long(1, offset))))));
}

function trackChildren(source, track, name) {
    const found = atoms(source, track.body, track.end).find(item => item.name === name);
    if (!found) throw new Error(`Live Photo motion has no ${name} atom.`);
    return found;
}

function videoTiming(source, children, { width, height, frames, fps }) {
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const tracks = children.filter(item => item.name === 'trak');
    let video;
    for (const track of tracks) {
        const mdia = trackChildren(source, track, 'mdia');
        const hdlr = trackChildren(source, mdia, 'hdlr');
        if (String.fromCharCode(...source.subarray(hdlr.body + 8, hdlr.body + 12)) === 'vide') {
            if (video) throw new Error('Live Photo preparation requires one video track.');
            video = track;
        }
    }
    if (!video) throw new Error('Live Photo motion has no video track.');
    const tkhd = trackChildren(source, video, 'tkhd');
    const version = source[tkhd.body];
    if (![0, 1].includes(version) || tkhd.end - tkhd.body < (version ? 96 : 84))
        throw new Error('Unsupported Live Photo video track header.');
    const videoId = view.getUint32(tkhd.body + (version ? 20 : 12));
    if (!videoId || view.getUint32(tkhd.end - 8) / 65536 !== width || view.getUint32(tkhd.end - 4) / 65536 !== height)
        throw new Error('Live Photo dimensions do not match the video.');
    const mdia = trackChildren(source, video, 'mdia'), mdhd = trackChildren(source, mdia, 'mdhd');
    if (source[mdhd.body] !== 0 || mdhd.end - mdhd.body < 24)
        throw new Error('Unsupported Live Photo video timing header.');
    const timescale = view.getUint32(mdhd.body + 12), duration = view.getUint32(mdhd.body + 16);
    const minf = trackChildren(source, mdia, 'minf'), stbl = trackChildren(source, minf, 'stbl');
    const stsz = trackChildren(source, stbl, 'stsz'), stts = trackChildren(source, stbl, 'stts');
    if (stsz.end - stsz.body < 12 || view.getUint32(stsz.body + 8) !== frames)
        throw new Error('Live Photo frame count does not match the video.');
    const entries = view.getUint32(stts.body + 4);
    if (!timescale || !duration || stts.end - stts.body !== 8 + entries * 8 || !entries)
        throw new Error('Invalid Live Photo video sample timing.');
    const decodingTimes = [];
    let count = 0, ticks = 0;
    for (let index = 0; index < entries; index++) {
        const at = stts.body + 8 + index * 8, samples = view.getUint32(at), sampleTicks = view.getUint32(at + 4);
        if (!samples || !sampleTicks || Math.abs(sampleTicks - timescale / fps) > 1 + 1e-6)
            throw new Error('Live Photo motion metadata requires a matching constant frame rate.');
        if (count + samples > frames) throw new Error('Live Photo frame count does not match the video timing.');
        for (let sample = 0; sample < samples; sample++) decodingTimes.push(ticks + sample * sampleTicks);
        count += samples; ticks += samples * sampleTicks;
    }
    if (count !== frames || ticks !== duration || Math.abs(duration / timescale - frames / fps) > 1 / timescale + 1e-6)
        throw new Error('Live Photo frame rate does not match the video.');
    const composition = atoms(source, stbl.body, stbl.end).find(item => item.name === 'ctts');
    if (composition) {
        const version = source[composition.body], entryCount = view.getUint32(composition.body + 4);
        if (![0, 1].includes(version) || composition.end - composition.body !== 8 + entryCount * 8)
            throw new Error('Unsupported Live Photo composition timing.');
        let frame = 0;
        for (let index = 0; index < entryCount; index++) {
            const at = composition.body + 8 + index * 8, samples = view.getUint32(at);
            const offset = version ? view.getInt32(at + 4) : view.getUint32(at + 4);
            if (!samples || frame + samples > frames) throw new Error('Invalid Live Photo composition timing.');
            for (let sample = 0; sample < samples; sample++) decodingTimes[frame++] += offset;
        }
        if (frame !== frames) throw new Error('Incomplete Live Photo composition timing.');
    }
    let mediaStart = 0;
    const edits = atoms(source, video.body, video.end).find(item => item.name === 'edts');
    if (edits) {
        const list = trackChildren(source, edits, 'elst'), version = source[list.body];
        if (![0, 1].includes(version) || view.getUint32(list.body + 4) !== 1
            || list.end - list.body !== (version ? 28 : 20))
            throw new Error('Live Photo motion metadata requires video starting at zero without edit gaps.');
        mediaStart = version ? Number(view.getBigInt64(list.body + 16)) : view.getInt32(list.body + 12);
        const rate = view.getUint32(list.body + (version ? 24 : 16));
        if (!Number.isSafeInteger(mediaStart) || mediaStart < 0 || rate !== 0x10000)
            throw new Error('Unsupported Live Photo video edit timing.');
    }
    const presentations = decodingTimes.sort((left, right) => left - right).map(value => value - mediaStart);
    if (presentations[0] !== 0 || presentations.some((time, index) => !Number.isSafeInteger(time) || time < 0
        || Math.abs(time - index * timescale / fps) > 1 + 1e-6 || (index && time <= presentations[index - 1])))
        throw new Error('Live Photo motion metadata requires a constant presentation frame rate starting at zero.');
    const runs = [];
    for (let frame = 0; frame < frames; frame++) {
        const step = (presentations[frame + 1] ?? duration) - presentations[frame];
        if (step <= 0 || Math.abs(step - timescale / fps) > 1 + 1e-6)
            throw new Error('Invalid Live Photo presentation sample duration.');
        if (runs.at(-1)?.[1] === step) runs.at(-1)[0]++;
        else runs.push([1, step]);
    }
    return { videoId, timescale, duration, runs };
}

function motionTrack({ id, movieTimescale, videoId, timescale, duration, frames, runs, offset, width, height }) {
    const setup = concatenate(atom('cfgv', text(MOTION_SETUP_PLIST)), atom('dims', long(width, height)));
    const description = metadataDescription([['com.apple.quicktime.live-photo-info',
        'com.apple.quicktime.com.apple.quicktime.live-photo-info', setup]]);
    const movieDuration = Math.round(duration / timescale * movieTimescale);
    return atom('trak',
        atom('tkhd', long(15, 0, 0, id, 0, movieDuration), zeros(16), unityMatrix(), zeros(8)),
        atom('tref', atom('cdsc', long(videoId))),
        atom('mdia', fullAtom('mdhd', long(0, 0, timescale, duration), short(0x55c4, 0)),
            fullAtom('hdlr', text('mhlrmetaappl'), long(1, 0), new Uint8Array([19]), text('Core Media Metadata')),
            atom('minf', atom('gmhd', fullAtom('gmin', short(0x40, 0x8000, 0x8000, 0x8000, 0, 0))),
                atom('dinf', fullAtom('dref', long(1), atom('alis', long(1)))),
                atom('stbl', fullAtom('stsd', long(1), description), fullAtom('stts', long(runs.length, ...runs.flat())),
                    fullAtom('stsc', long(1, 1, frames, 1)), fullAtom('stsz', long(MOTION_PAYLOAD_SIZE + 8, frames)),
                    fullAtom('stco', long(1, offset))))));
}

/** Add timed pairing metadata to a regular MOV, with no packet changes.
 * The encoder must put mdat before a terminal moov (do not enable faststart).
 * Fragmented and already paired movies are deliberately unsupported.
 * Providing dimensions and frame count also adds generated timing/alignment
 * metadata. Its presence does not guarantee native wallpaper eligibility.
 */
export async function livePhotoMov(blob, identifier, { stillTime, fps, width, height, frames } = {}) {
    identifierCheck(identifier);
    if (!Number.isFinite(stillTime) || stillTime < 0 || !Number.isFinite(fps) || fps <= 0)
        throw new Error('Live Photo requires a valid key-photo time and frame rate.');
    const detailed = [width, height, frames].some(value => value !== undefined);
    if (detailed && (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 65535)
        || !Number.isSafeInteger(frames) || frames < 1 || frames > Math.floor((0xffffffff - 113) / (MOTION_PAYLOAD_SIZE + 8))))
        throw new Error('Live Photo requires valid video dimensions and frame count.');
    const source = new Uint8Array(await blob.arrayBuffer()), top = atoms(source);
    const movie = top.filter(item => item.name === 'moov');
    const type = top[0];
    if (type?.name !== 'ftyp' || String.fromCharCode(...source.subarray(type.body, type.body + 4)) !== 'qt  ')
        throw new Error('Live Photo motion must use the QuickTime MOV container.');
    if (movie.length !== 1 || movie[0].end !== source.length || !top.some(item => item.name === 'mdat')
        || top.some(item => ['moof', 'sidx', 'mfra', 'ssix'].includes(item.name)))
        throw new Error('Live Photo requires a regular MOV with its movie header at the end.');
    const moov = movie[0], children = atoms(source, moov.body, moov.end);
    if (children.some(item => item.name === 'meta')) throw new Error('Live Photo motion already contains movie metadata.');
    const originalHeader = children.find(item => item.name === 'mvhd');
    if (!originalHeader || originalHeader.body - originalHeader.start !== 8
        || originalHeader.end - originalHeader.body !== 100 || source[originalHeader.body] !== 0)
        throw new Error('Unsupported QuickTime movie header.');
    const header = source.slice(originalHeader.start, originalHeader.end), view = new DataView(header.buffer);
    const timescale = view.getUint32(20), duration = view.getUint32(24), id = view.getUint32(header.length - 4);
    const stillTicks = Math.round(stillTime * timescale);
    if (timescale === 0 || !Number.isSafeInteger(stillTicks) || stillTicks >= duration || id === 0 || id >= (detailed ? 0xfffffffe : 0xffffffff))
        throw new Error('Live Photo key-photo time lies outside the movie.');
    const sampleTicks = Math.min(duration - stillTicks, Math.max(1, Math.round(timescale / fps)));
    view.setUint32(header.length - 4, id + (detailed ? 2 : 1));
    // Existing media precedes the old moov, so no original chunk offsets move.
    // The new metadata chunk replaces the old moov position and contains SInt8 -1.
    const stillEntries = [['com.apple.quicktime.still-image-time', 65]];
    const stillParts = [atom(1, new Uint8Array([255]))];
    let timing, motionData, motion;
    if (detailed) {
        timing = videoTiming(source, children, { width, height, frames, fps });
        if (stillTime >= timing.duration / timing.timescale)
            throw new Error('Live Photo key-photo time lies outside the video.');
        stillEntries.push(['com.apple.quicktime.live-photo-still-image-transform', 83],
            ['com.apple.quicktime.live-photo-still-image-transform-reference-dimensions', 71]);
        const identity = zeros(72), identityView = new DataView(identity.buffer);
        for (const component of [0, 4, 8]) identityView.setFloat64(component * 8, 1);
        const dimensions = zeros(8), dimensionsView = new DataView(dimensions.buffer);
        dimensionsView.setFloat32(0, width); dimensionsView.setFloat32(4, height);
        stillParts.push(atom(2, identity), atom(3, dimensions));
        motionData = zeros(frames * (MOTION_PAYLOAD_SIZE + 8));
        let frame = 0, ticks = 0;
        for (const [samples, step] of timing.runs) {
            for (let sample = 0; sample < samples; sample++) {
                motionData.set(atom(1, neutralMotionPayload(ticks, timing.timescale)), frame++ * (MOTION_PAYLOAD_SIZE + 8));
                ticks += step;
            }
        }
    }
    const stillData = concatenate(...stillParts), marker = atom('mdat', stillData, ...(motionData ? [motionData] : []));
    const track = stillTrack({ id: id + (detailed ? 1 : 0), timescale, stillTicks, sampleTicks, offset: moov.start + 8,
        sampleSize: stillData.length, description: metadataDescription(stillEntries), videoId: timing?.videoId });
    if (detailed) motion = motionTrack({ id, movieTimescale: timescale, ...timing, frames, width, height, offset: moov.start + 8 + stillData.length });
    const updatedMovie = atom('moov', ...children.map(item => item === originalHeader ? header : source.subarray(item.start, item.end)),
        ...(motion ? [motion] : []), track, movieMetadata(identifier));
    return new Blob([source.subarray(0, moov.start), marker, updatedMovie], { type: 'video/quicktime' });
}
