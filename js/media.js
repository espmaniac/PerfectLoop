import { clamp } from './logic.js';
import { distinctCandidates, pairScore } from './ranking.js';
function aborted(signal) { if (signal?.aborted)
    throw new DOMException('Cancelled', 'AbortError'); }
export async function openVideo(url, signal) {
    aborted(signal);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    try {
        await new Promise((resolve, reject) => {
            const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); video.onloadeddata = null; video.onerror = null; };
            const cancel = () => { clean(); reject(new DOMException('Cancelled', 'AbortError')); };
            const timer = window.setTimeout(() => { clean(); reject(new Error('The video could not be decoded. Try an MP4 (H.264) or create a compatible proxy.')); }, 20_000);
            signal?.addEventListener('abort', cancel, { once: true });
            video.onloadeddata = () => { clean(); resolve(); };
            video.onerror = () => { clean(); reject(new Error('This browser cannot play the source codec. Create a compatible proxy to edit it.')); };
            video.src = url;
        });
    }
    catch (e) {
        releaseVideo(video);
        throw e;
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
        releaseVideo(video);
        throw new Error('The source does not have a readable duration.');
    }
    // A browser may play an MKV's audio while silently ignoring its video codec.
    // loadeddata alone therefore does not establish that video can be previewed.
    if (!video.videoWidth || !video.videoHeight) {
        releaseVideo(video);
        throw new Error('This browser cannot decode the video track. Create a compatible proxy to edit it.');
    }
    return video;
}
export function releaseVideo(video) { video.pause(); video.removeAttribute('src'); video.load(); }
export async function seekVideo(video, time, signal) {
    aborted(signal);
    const t = clamp(time, 0, Math.max(0, video.duration - 0.001));
    if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2)
        return;
    await new Promise((resolve, reject) => {
        const clean = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); signal?.removeEventListener('abort', cancel); };
        const done = () => { clean(); resolve(); };
        const fail = () => { clean(); reject(new Error('Could not read this video frame.')); };
        const cancel = () => { clean(); reject(new DOMException('Cancelled', 'AbortError')); };
        const timer = window.setTimeout(fail, 12_000);
        video.addEventListener('seeked', done, { once: true });
        video.addEventListener('error', fail, { once: true });
        signal?.addEventListener('abort', cancel, { once: true });
        video.currentTime = t;
    });
}
export function capture(video, width = 96, height = 160) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const ratio = Math.max(width / video.videoWidth, height / video.videoHeight);
    const w = video.videoWidth * ratio, h = video.videoHeight * ratio;
    ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
    return canvas;
}
function descriptor(video, time) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 32, 32);
    const rgba = ctx.getImageData(0, 0, 32, 32).data;
    const pixels = new Float32Array(32 * 32 * 3);
    for (let i = 0, p = 0; i < rgba.length; i += 4) {
        pixels[p++] = rgba[i] / 255;
        pixels[p++] = rgba[i + 1] / 255;
        pixels[p++] = rgba[i + 2] / 255;
    }
    return { time, pixels };
}
export async function thumbnails(url, count, signal) {
    const video = await openVideo(url, signal), out = [];
    try {
        for (let i = 0; i < count; i++) {
            await seekVideo(video, i / Math.max(1, count - 1) * (video.duration - 0.05), signal);
            out.push(capture(video, 96, 80).toDataURL('image/jpeg', 0.65));
        }
    }
    finally {
        releaseVideo(video);
    }
    return out;
}
export function searchSamplePlan(options, fps, duration) {
    if (!Number.isFinite(fps) || fps <= 0)
        throw new Error('The source frame rate must be known before searching.');
    // A and B are frame boundaries, with B exclusive. Decode only frame centers
    // inside the selection, including its first and last readable source frames.
    const firstFrame = Math.ceil(options.from * fps - 1e-7);
    const endFrame = Math.floor(Math.min(options.to, duration) * fps + 1e-7);
    const lastFrame = endFrame - 1;
    if (lastFrame <= firstFrame || (endFrame - firstFrame) / fps < options.min - 1e-6)
        throw new Error('Choose a search range long enough for the requested loop duration at the source frame rate.');
    const requestedStep = options.precision === 'fast' ? 0.5 : options.precision === 'detailed' ? 0.1 : 0.25;
    const intervals = Math.min(1600, lastFrame - firstFrame, Math.max(1, Math.floor((lastFrame - firstFrame) / fps / requestedStep)));
    const times = Array.from({ length: intervals + 1 }, (_, i) => (firstFrame + Math.round(i * (lastFrame - firstFrame) / intervals)) / fps);
    return { times, first: firstFrame / fps, last: lastFrame / fps, end: endFrame / fps, step: (lastFrame - firstFrame) / fps / intervals };
}
export async function searchVideo(url, options, fps, signal, onProgress) {
    if (![options.from, options.to, options.min, options.max].every(Number.isFinite) || options.from < 0 || options.to <= options.from || options.min <= 0 || options.max < options.min || options.to - options.from < options.min)
        throw new Error('Choose a search range long enough for the requested loop duration.');
    const video = await openVideo(url, signal);
    if (options.to > video.duration + 0.002) {
        releaseVideo(video);
        throw new Error('The search range exceeds the source duration.');
    }
    const frames = [];
    let worker;
    try {
        const plan = searchSamplePlan(options, fps, video.duration), { step } = plan;
        const count = plan.times.length;
        for (let i = 0; i < count; i++) {
            const t = plan.times[i];
            // Seek inside the requested frame. At exact boundaries browser timestamp
            // rounding can otherwise display the preceding frame.
            await seekVideo(video, t + 0.5 / fps, signal);
            frames.push(descriptor(video, t));
            onProgress(i / count * 0.68, `Sampling frame ${i + 1} of ${count} · ${step.toFixed(2)}s spacing`);
        }
        aborted(signal);
        onProgress(0.7, 'Comparing image structure and motion…');
        worker = new Worker(new URL('./search.worker.js', import.meta.url), { type: 'module' });
        const candidates = await new Promise((resolve, reject) => {
            const abort = () => { worker?.terminate(); reject(new DOMException('Cancelled', 'AbortError')); };
            signal.addEventListener('abort', abort, { once: true });
            worker.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('The analysis worker failed. Try a smaller search range.')); };
            worker.onmessage = event => { signal.removeEventListener('abort', abort); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.candidates); };
            worker.postMessage({ frames, options: { ...options, endBoundary: plan.end } }, frames.map(f => f.pixels.buffer));
        });
        worker.terminate();
        worker = undefined;
        // Refine the strongest matches around exact frame timestamps. B is exclusive.
        for (let i = 0; i < Math.min(5, candidates.length); i++) {
            aborted(signal);
            onProgress(0.72 + i / 5 * 0.2, `Refining match ${i + 1} at frame precision…`);
            // At an exclusive terminal end, the center itself is not readable.
            // Include both the last frame and its predecessor even at low FPS.
            const c = candidates[i], radius = Math.max(2, Math.min(8, Math.ceil(step / 2 * fps)));
            const starts = [], ends = [];
            for (const [center, list] of [[c.start, starts], [c.end, ends]]) {
                for (let j = -radius; j <= radius + 1; j++) {
                    const t = (Math.round(center * fps) + j) / fps;
                    if (t < plan.first - 1e-7 || t > plan.last + 1e-7)
                        continue;
                    await seekVideo(video, t + 0.5 / fps, signal);
                    list.push(descriptor(video, t));
                }
            }
            let best;
            for (let a = 0; a < starts.length - 1; a++)
                for (let b = 1; b < ends.length; b++) {
                    const terminal = Math.abs(ends[b].time - plan.last) < 1e-7;
                    if (!terminal && b === ends.length - 1)
                        continue;
                    const end = terminal ? plan.end : ends[b].time;
                    const d = end - starts[a].time;
                    if (d < options.min - 1e-6 || d > options.max + 1e-6)
                        continue;
                    const match = { id: c.id, ...pairScore(starts[a], starts[a + 1], ends[b - 1], ends[b], options.preferMotion, c.cuts, ends[b + 1]), end, refined: true };
                    if (!best || match.score > best.score)
                        best = match;
                }
            if (best)
                candidates[i] = best;
        }
        const distinct = distinctCandidates(candidates, options);
        for (let i = 0; i < distinct.length; i++) {
            await seekVideo(video, distinct[i].start + 0.5 / fps, signal);
            distinct[i].thumbnail = capture(video).toDataURL('image/jpeg', 0.75);
            onProgress(0.94 + i / distinct.length * 0.06, 'Preparing loop candidates…');
        }
        return { candidates: distinct, step };
    }
    finally {
        worker?.terminate();
        releaseVideo(video);
    }
}
export async function inspectSeam(url, fps, signal, start = 0, end) {
    const video = await openVideo(url, signal);
    try {
        const width = 180, height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
        await seekVideo(video, start + 0.5 / fps, signal);
        const first = capture(video, width, height), a = descriptor(video, start);
        await seekVideo(video, start + 1.5 / fps, signal);
        const an = descriptor(video, start + 1 / fps);
        const lastTime = Math.max(start, (end ?? video.duration) - 1 / fps);
        await seekVideo(video, Math.max(start, lastTime - 0.5 / fps), signal);
        const bp = descriptor(video, lastTime - 1 / fps);
        await seekVideo(video, lastTime + 0.5 / fps, signal);
        const last = capture(video, width, height), b = descriptor(video, lastTime);
        const diff = document.createElement('canvas');
        diff.width = width;
        diff.height = height;
        const ctx = diff.getContext('2d'), f = first.getContext('2d').getImageData(0, 0, width, height), l = last.getContext('2d').getImageData(0, 0, width, height);
        for (let i = 0; i < f.data.length; i += 4)
            for (let k = 0; k < 3; k++)
                f.data[i + k] = Math.min(255, Math.abs(f.data[i + k] - l.data[i + k]) * 3);
        ctx.putImageData(f, 0, 0);
        return { first: first.toDataURL(), last: last.toDataURL(), diff: diff.toDataURL(), ...pairScore(a, an, bp, b, false) };
    }
    finally {
        releaseVideo(video);
    }
}
