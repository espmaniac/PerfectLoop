// Live Photos pair a JPEG Apple MakerNote (tag 17) with a QuickTime movie's
// content identifier and a boxed, timed still-image-time metadata sample.
// Format references: https://github.com/LimitPoint/LivePhoto#live-photo-format
// and Apple's QuickTime File Format, Metadata Media chapter. The structures
// below were checked against the AVFoundation-produced sample in that repo.
// These pairing fields do not establish iOS Lock Screen motion eligibility.

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

function stillTrack({ id, timescale, stillTicks, sampleTicks, offset }) {
    const description = atom('mebx', zeros(6), short(1), atom('keys', atom(1,
        atom('keyd', text('mdtacom.apple.quicktime.still-image-time')), atom('dtyp', long(0, 65)))));
    const edits = stillTicks === 0 ? long(1, sampleTicks, 0, 0x10000)
        : long(2, stillTicks, 0xffffffff, 0x10000, sampleTicks, 0, 0x10000);
    return atom('trak',
        atom('tkhd', long(15, 0, 0, id, 0, stillTicks + sampleTicks), zeros(16), unityMatrix(), zeros(8)),
        atom('edts', fullAtom('elst', edits)),
        atom('mdia', fullAtom('mdhd', long(0, 0, timescale, sampleTicks), short(0x55c4, 0)),
            fullAtom('hdlr', text('mhlrmetaappl'), long(1, 0), new Uint8Array([19]), text('Core Media Metadata')),
            atom('minf', atom('gmhd', fullAtom('gmin', short(0x40, 0x8000, 0x8000, 0x8000, 0, 0))),
                atom('dinf', fullAtom('dref', long(1), atom('alis', long(1)))),
                atom('stbl', fullAtom('stsd', long(1), description), fullAtom('stts', long(1, 1, sampleTicks)),
                    fullAtom('stsc', long(1, 1, 1, 1)), fullAtom('stsz', long(9, 1)), fullAtom('stco', long(1, offset))))));
}

/** Add timed pairing metadata to a regular H.264 MOV, with no packet changes.
 * The encoder must put mdat before a terminal moov (do not enable faststart).
 * Fragmented and already paired movies are deliberately unsupported.
 */
export async function livePhotoMov(blob, identifier, { stillTime, fps } = {}) {
    identifierCheck(identifier);
    if (!Number.isFinite(stillTime) || stillTime < 0 || !Number.isFinite(fps) || fps <= 0)
        throw new Error('Live Photo requires a valid key-photo time and frame rate.');
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
    if (timescale === 0 || !Number.isSafeInteger(stillTicks) || stillTicks >= duration || id === 0 || id >= 0xffffffff)
        throw new Error('Live Photo key-photo time lies outside the movie.');
    const sampleTicks = Math.min(duration - stillTicks, Math.max(1, Math.round(timescale / fps)));
    view.setUint32(header.length - 4, id + 1);
    // Existing media precedes the old moov, so no original chunk offsets move.
    // The new metadata chunk replaces the old moov position and contains SInt8 -1.
    const marker = atom('mdat', atom(1, new Uint8Array([255])));
    const track = stillTrack({ id, timescale, stillTicks, sampleTicks, offset: moov.start + 8 });
    const updatedMovie = atom('moov', ...children.map(item => item === originalHeader ? header : source.subarray(item.start, item.end)),
        track, movieMetadata(identifier));
    return new Blob([source.subarray(0, moov.start), marker, updatedMovie], { type: 'video/quicktime' });
}
