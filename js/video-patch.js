// Video patches keep donor motion forward and fit one cycle into their active interval.
export const MAX_PATCH_SECONDS = 8;
export const MAX_PATCH_BYTES = 64 * 1024 ** 2;

export function patchCapturePlan(start, end, duration, fps, width, height, usedBytes = 0) {
    if (![start, end, duration, fps, width, height].every(Number.isFinite)
        || start < 0 || end > duration + 1e-6 || end - start < 0.1 - 1e-7 || end - start > MAX_PATCH_SECONDS + 1e-7)
        throw new Error('Choose a source fragment between 0.1 and 8 seconds, inside the video.');
    const rate = Math.min(30, Math.max(1, fps));
    const count = Math.max(2, Math.ceil((end - start) * rate));
    const bytes = count * width * height * 4;
    if (width < 1 || height < 1 || bytes + usedBytes > MAX_PATCH_BYTES)
        throw new Error('Video patches need too much memory. Select a smaller area or a shorter fragment. Reload the page to release patches retained for undo.');
    return { count, bytes, times: Array.from({ length: count }, (_, i) => start + i * (end - start) / count) };
}

export function patchInterval(layer, period) {
    const start = layer.startTime ?? 0, end = Math.min(layer.endTime ?? period, period);
    return { start, end, duration: Math.max(0, end - start) };
}

export function patchFade(layer, time, period) {
    const { start, end, duration } = patchInterval(layer, period);
    if (!(duration > 0)) return 0;
    const t = ((time % period) + period) % period;
    if (t < start || t >= end) return 0;
    const fadeIn = Math.min(layer.fadeIn || 0, duration / 2), fadeOut = Math.min(layer.fadeOut || 0, duration / 2);
    return Math.max(0, Math.min(1, fadeIn ? (t - start) / fadeIn : 1, fadeOut ? (end - t) / fadeOut : 1));
}

// Weighted donor frames sum to one, preserving feathered alpha when composited.
export function patchSamples(layer, time, period, count) {
    const { start, duration } = patchInterval(layer, period);
    if (!(duration > 0) || count < 2) return [{ index: 0, weight: 1 }];
    const localTime = ((time % period) + period) % period - start;
    const phase = ((localTime % duration) + duration) % duration / duration;
    const overlap = Math.min(count * 0.4, Math.max(0, count * (layer.seamBlend ?? 20) / 100));
    const position = overlap + phase * (count - overlap);
    const samples = new Map();
    const add = (position, weight, wrap = false) => {
        const floor = Math.floor(position), fraction = position - floor;
        for (const [index, w] of [[floor, 1 - fraction], [floor + 1, fraction]]) {
            const key = wrap ? index % count : Math.min(count - 1, index);
            samples.set(key, (samples.get(key) || 0) + weight * w);
        }
    };
    if (overlap > 0 && position >= count - overlap) {
        const blend = (position - (count - overlap)) / overlap;
        add(position, 1 - blend); add(position - (count - overlap), blend);
    } else add(position, 1, !overlap);
    return [...samples].filter(([, weight]) => weight > 1e-9).map(([index, weight]) => ({ index, weight }));
}
