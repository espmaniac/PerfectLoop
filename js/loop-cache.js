import { framePlan } from './logic.js';
import { openVideo, releaseVideo, seekVideo } from './media.js';

// Decoded frames of the selected source range, at the output frame rate, for
// the live loop-method preview. Frames are kept unframed and scaled down to a
// memory budget; framing, methods, and layers are applied when drawing.
const MAX_SIDE = 720, BUDGET = 160 * 1024 ** 2;

export function cacheSize(width, height, frames) {
    const fit = Math.min(1, MAX_SIDE / Math.max(width, height), Math.sqrt(BUDGET / Math.max(1, frames * width * height * 4)));
    return { width: Math.max(2, Math.round(width * fit)), height: Math.max(2, Math.round(height * fit)) };
}

export class LoopFrameCache {
    constructor(onChange = () => {}) {
        this.onChange = onChange;
        this.key = ''; this.frames = []; this.total = 0; this.ready = false; this.error = '';
    }
    get progress() { return this.total ? this.frames.filter(Boolean).length / this.total : 0; }
    frame(index) { return this.frames[index]; }
    // Starts decoding when the source range changes; cheap to call every frame.
    ensure(sourceURL, s, info) {
        const key = sourceURL && info.duration ? `${sourceURL}|${s.start}|${s.end}|${s.speed}|${s.fps}` : '';
        if (key === this.key) return;
        this.reset(); this.key = key;
        if (key) void this.build(key, sourceURL, s, info);
    }
    reset() {
        this.controller?.abort();
        for (const frame of this.frames) frame?.close?.();
        this.frames = []; this.total = 0; this.ready = false; this.error = ''; this.key = '';
    }
    async build(key, sourceURL, s, info) {
        const controller = new AbortController(); this.controller = controller;
        const { frames: n } = framePlan(s);
        this.total = n; this.frames = new Array(n);
        let video;
        try {
            video = await openVideo(sourceURL, controller.signal);
            const size = cacheSize(video.videoWidth, video.videoHeight, n);
            // Seek inside each frame: exact boundaries can show the previous frame.
            const half = 0.5 / (info.fps || s.fps);
            for (let k = 0; k < n; k++) {
                await seekVideo(video, s.start + k * s.speed / s.fps + half, controller.signal);
                const bitmap = await createImageBitmap(video, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' });
                if (controller.signal.aborted) { bitmap.close(); return; }
                this.frames[k] = bitmap;
                if (k % 4 === 0 || k === n - 1) this.onChange();
            }
            this.ready = true;
        } catch (error) {
            if (!controller.signal.aborted && this.key === key) this.error = error.message || String(error);
        } finally {
            if (video) releaseVideo(video);
            if (this.key === key) this.onChange();
        }
    }
}
