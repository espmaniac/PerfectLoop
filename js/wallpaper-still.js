import { openVideo, releaseVideo, seekVideo } from './media.js';

function cancelled(signal) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}

function encodeJpeg(canvas, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, blob) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(blob);
        };
        const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
        const timer = window.setTimeout(() => finish(new Error('The wallpaper still could not be encoded in time. Try a smaller wallpaper size.')), 10_000);
        signal.addEventListener('abort', abort, { once: true });
        try {
            cancelled(signal);
            canvas.toBlob(blob => {
                if (settled) return;
                if (!(blob instanceof Blob) || !blob.size || blob.type !== 'image/jpeg') {
                    finish(new Error('The browser could not create a JPEG wallpaper still. Try a smaller wallpaper size.'));
                    return;
                }
                finish(null, blob);
            }, 'image/jpeg', 0.95);
        }
        catch (error) { finish(error); }
    });
}

export async function captureWallpaperStill(blob, { time, fps, width, height } = {}, signal) {
    cancelled(signal);
    if (!(blob instanceof Blob) || !blob.size) throw new Error('The finished wallpaper video is not ready.');
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 3840))
        throw new Error('Choose valid wallpaper dimensions up to 3840 pixels.');
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(fps) || fps <= 0)
        throw new Error('Choose a valid wallpaper frame position and frame rate.');
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let url, video, canvas;
    try {
        cancelled(signal);
        url = URL.createObjectURL(blob);
        video = await openVideo(url, controller.signal);
        cancelled(controller.signal);
        if (video.videoWidth !== width || video.videoHeight !== height)
            throw new Error('The finished wallpaper video dimensions do not match its still frame. Export again.');
        const center = time + 0.5 / fps;
        if (!Number.isFinite(center) || center >= video.duration)
            throw new Error('The wallpaper frame position is outside the finished video.');
        // Frame centers avoid browser rounding to the preceding frame at an exact
        // boundary. The encoded video already contains all framing and layers.
        await seekVideo(video, center, controller.signal);
        cancelled(controller.signal);
        if (video.readyState < 2 || video.seeking) throw new Error('The selected wallpaper frame could not be decoded.');
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The browser could not prepare the wallpaper still. Try a smaller wallpaper size.');
        context.drawImage(video, 0, 0, width, height);
        cancelled(controller.signal);
        const jpeg = await encodeJpeg(canvas, controller.signal);
        cancelled(controller.signal);
        return jpeg;
    }
    finally {
        // Also cancels pending media listeners if a browser throws while seeking.
        controller.abort();
        signal?.removeEventListener('abort', abort);
        if (video) releaseVideo(video);
        if (canvas) canvas.width = canvas.height = 0;
        if (url) URL.revokeObjectURL(url);
    }
}
