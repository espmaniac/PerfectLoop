import { openVideo, releaseVideo, seekVideo } from './media.js';
import { framePlan } from './logic.js';
import { videoTransform } from './framing.js';
import { analyzeRepairFrames, suggestRepairCut } from './repair.js';
export async function analyzeLoopRepair(url, settings, signal, onProgress = () => {}) {
    const video = await openVideo(url, signal);
    try {
        const ratio = Math.min(1, 96 / settings.width, 144 / settings.height);
        const width = Math.max(1, Math.round(settings.width * ratio)), height = Math.max(1, Math.round(settings.height * ratio));
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }), frames = [], images = [], times = [];
        const duration = settings.end - settings.start, step = settings.speed / settings.fps;
        const outputFrames = framePlan(settings).frames, count = Math.min(25, outputFrames);
        for (let i = 0; i < count; i++) {
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            const time = settings.start + Math.min(duration - 0.001, step / 2 + Math.round(i / (count - 1) * (outputFrames - 1)) * step);
            await seekVideo(video, time, signal);
            times.push(time);
            ctx.fillStyle = settings.background; ctx.fillRect(0, 0, width, height);
            const t = videoTransform(settings, video.videoWidth, video.videoHeight, width, height);
            ctx.save(); ctx.translate(width / 2 + t.offsetX, height / 2 + t.offsetY);
            ctx.scale(settings.mirror ? -t.sx : t.sx, t.sy); ctx.rotate(settings.rotate * Math.PI / 180);
            ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2); ctx.restore();
            const pixels = ctx.getImageData(0, 0, width, height).data;
            frames.push(Float32Array.from({ length: width * height }, (_, p) => pixels[p * 4] * .2126 + pixels[p * 4 + 1] * .7152 + pixels[p * 4 + 2] * .0722));
            if (i === 0 || i === count - 1) images.push(canvas.toDataURL('image/jpeg', .8));
            onProgress((i + 1) / count, 'Comparing brightness, motion, and the loop boundary…');
        }
        return { ...analyzeRepairFrames(frames, width, height), images, samples: count, cut: suggestRepairCut(frames, times, step, settings.start, settings.end) };
    } finally { releaseVideo(video); }
}
