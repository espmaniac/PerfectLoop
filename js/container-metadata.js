// Reads the frame rate and video-track duration of MP4 and MOV files from their
// boxes, so Auto find and seam tools can start without the video engine. Other
// containers and unusual files return null and use the engine's probe instead.
const MAX_MOOV = 64 * 1024 ** 2;
const TOP_LEVEL = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid', 'meta']);

const fourcc = (view, offset) => String.fromCharCode(...[0, 1, 2, 3].map(i => view.getUint8(offset + i)));
function* boxes(view, start = 0, end = view.byteLength) {
    for (let offset = start; offset + 8 <= end;) {
        let size = view.getUint32(offset), header = 8;
        if (size === 1) { size = Number(view.getBigUint64(offset + 8)); header = 16; }
        else if (size === 0) size = end - offset;
        if (size < header || offset + size > end) return;
        yield { type: fourcc(view, offset + 4), start: offset + header, end: offset + size };
        offset += size;
    }
}
const child = (view, box, type) => box && [...boxes(view, box.start, box.end)].find(item => item.type === type);

async function readMoov(file) {
    const read = async (offset, length) => new DataView(await file.slice(offset, offset + length).arrayBuffer());
    for (let offset = 0, first = true; offset + 8 <= file.size; first = false) {
        const head = await read(offset, 16);
        let size = head.getUint32(0), header = 8;
        const type = fourcc(head, 4);
        if (first && !TOP_LEVEL.has(type)) return null;
        if (size === 1) { size = Number(head.getBigUint64(8)); header = 16; }
        else if (size === 0) size = file.size - offset;
        if (size < header) return null;
        if (type === 'moov') return size - header > MAX_MOOV ? null : read(offset + header, size - header);
        offset += size;
    }
    return null;
}

export async function containerMetadata(file) {
    try {
        const moov = await readMoov(file);
        if (!moov) return null;
        let video, hasAudio = false;
        for (const trak of boxes(moov)) {
            if (trak.type !== 'trak') continue;
            const mdia = child(moov, trak, 'mdia'), hdlr = child(moov, mdia, 'hdlr'), mdhd = child(moov, mdia, 'mdhd');
            const handler = hdlr && fourcc(moov, hdlr.start + 8);
            if (handler === 'soun') hasAudio = true;
            if (handler !== 'vide' || video || !mdhd) continue;
            const timescale = moov.getUint32(mdhd.start + (moov.getUint8(mdhd.start) === 1 ? 20 : 12));
            const stts = child(moov, child(moov, child(moov, mdia, 'minf'), 'stbl'), 'stts');
            if (!stts) continue;
            let frames = 0, ticks = 0;
            for (let i = 0, count = moov.getUint32(stts.start + 4); i < count; i++) {
                const entry = stts.start + 8 + i * 8;
                if (entry + 8 > stts.end) break;
                frames += moov.getUint32(entry);
                ticks += moov.getUint32(entry) * moov.getUint32(entry + 4);
            }
            // Fragmented files keep their samples outside moov.
            if (timescale && frames && ticks) video = { fps: frames * timescale / ticks, videoDuration: ticks / timescale };
        }
        return video ? { ...video, hasAudio } : null;
    } catch {
        return null;
    }
}
