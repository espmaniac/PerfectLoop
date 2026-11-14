import { openVideo, releaseVideo } from './media.js';
import { framePlan } from './logic.js';
import { lumaCanvas, readLuma } from './frame-reader.js';
import { analyzeRepairFrames, suggestRepairCut } from './repair.js';
export async function analyzeLoopRepair(url, settings, signal, onProgress = () => {}) {
    const video = await openVideo(url, signal);
    try {
        const ratio = Math.min(1, 96 / settings.width, 144 / settings.height);
        const width = Math.max(1, Math.round(settings.width * ratio)), height = Math.max(1, Math.round(settings.height * ratio));
        const target = lumaCanvas(width, height), frames = [], images = [], times = [];
        const duration = settings.end - settings.start, step = settings.speed / settings.fps;
        const outputFrames = framePlan(settings).frames, count = Math.min(25, outputFrames);
        for (let i = 0; i < count; i++) {
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            const time = settings.start + Math.min(duration - 0.001, step / 2 + Math.round(i / (count - 1) * (outputFrames - 1)) * step);
            frames.push(await readLuma(video, time, target, signal, settings));
            times.push(time);
            if (i === 0 || i === count - 1) images.push(target.canvas.toDataURL('image/jpeg', .8));
            onProgress((i + 1) / count, 'Comparing brightness, motion, and the loop boundary…');
        }
        return { ...analyzeRepairFrames(frames, width, height), images, samples: count, cut: suggestRepairCut(frames, times, step, settings.start, settings.end) };
    } finally { releaseVideo(video); }
}
