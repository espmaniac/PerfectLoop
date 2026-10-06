const containerTypes = {
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
};
const unavailableMessage = 'This video is not available to read. Let Photos or iCloud finish downloading it, then select it again, or save it to Files and open it from there.';

function aborted(signal) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

function readPrefix(file, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            callback(value);
        };
        const cancel = () => finish(reject, new DOMException('Cancelled', 'AbortError'));
        const timer = setTimeout(() => finish(reject, new Error(unavailableMessage)), 20_000);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) { cancel(); return; }
        try {
            const prefix = file.slice(0, Math.min(64, file.size));
            if (settled) return;
            // Blob reads cannot themselves be aborted. Ignore late completion
            // after cancellation or a stalled Photos/iCloud read times out.
            Promise.resolve(prefix.arrayBuffer()).then(
                value => finish(resolve, value),
                error => finish(reject, error),
            );
        }
        catch (error) { finish(reject, error); }
    });
}

export async function prepareVideoFile(file, signal) {
    aborted(signal);
    if (!(file instanceof Blob)) throw new Error('Choose a video file to open.');
    if (!file.size) throw new Error(unavailableMessage);

    try {
        // Photo-library selections can reference a temporary or cloud-only file.
        // Check a small prefix before replacing the current project.
        const prefix = await readPrefix(file, signal);
        aborted(signal);
        if (!prefix.byteLength) throw new Error(unavailableMessage);
    }
    catch (error) {
        aborted(signal);
        if (error?.name === 'AbortError') throw error;
        throw new Error(unavailableMessage, { cause: error });
    }

    const type = file.type.trim().toLowerCase();
    if (type && type !== 'application/octet-stream') return file;
    const extension = /\.([^.]+)$/.exec(file.name || '')?.[1].toLowerCase();
    const containerType = containerTypes[extension];
    if (!containerType) return file;
    // Composing a File from a Blob retains its bytes without reading the video
    // into JavaScript memory or changing its container or codec.
    return new File([file], file.name, { type: containerType, lastModified: file.lastModified });
}
