import { clamp } from './logic.js';
import { lumaCanvas, readLuma } from './frame-reader.js';
import { bestLoops, cutAtBoundary, diverseShortlist, pairScore, seamMatch, verifyLimit } from './ranking.js';
function aborted(signal) { if (signal?.aborted)
    throw new DOMException('Cancelled', 'AbortError'); }
const helperVideos = new WeakSet();
export async function openVideo(url, signal) {
    aborted(signal);
    const video = document.createElement('video');
    helperVideos.add(video);
    try {
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('aria-hidden', 'true');
        video.tabIndex = -1;
        // Safari can defer decoding detached media. Keep readers in the document
        // with a nonzero size while they prepare metadata and canvas frames.
        Object.assign(video.style, { position: 'fixed', left: '-2px', top: '0', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none' });
        document.body.append(video);
        await new Promise((resolve, reject) => {
            const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked'];
            const clean = () => {
                window.clearTimeout(timer);
                signal?.removeEventListener('abort', cancel);
                for (const event of events) video.removeEventListener(event, ready);
                video.removeEventListener('error', fail);
            };
            const cancel = () => { clean(); reject(new DOMException('Cancelled', 'AbortError')); };
            const fail = () => { clean(); reject(new Error('This browser cannot play the source codec. Create a compatible proxy to edit it.')); };
            const ready = () => {
                // Metadata alone is insufficient for drawImage and frame sampling.
                if (video.readyState < 2) return;
                clean(); resolve();
            };
            const timer = window.setTimeout(() => { clean(); reject(new Error('The video could not be decoded. Try an MP4 (H.264) or create a compatible proxy.')); }, 20_000);
            signal?.addEventListener('abort', cancel, { once: true });
            for (const event of events) video.addEventListener(event, ready);
            video.addEventListener('error', fail, { once: true });
            try {
                aborted(signal);
                video.src = url;
                video.load();
                ready();
            }
            catch (error) { clean(); reject(error); }
        });
        aborted(signal);
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
export function releaseVideo(video) {
    try { video.pause(); video.removeAttribute('src'); video.load(); }
    catch { /* Cleanup must not replace the original read or cancellation error. */ }
    finally {
        if (helperVideos.has(video)) {
            video.remove();
            helperVideos.delete(video);
        }
    }
}
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
    const endFrame = Math.floor(Math.min(options.to, duration, options.videoDuration || duration) * fps + 1e-7);
    const lastFrame = endFrame - 1;
    if (lastFrame <= firstFrame || (endFrame - firstFrame) / fps < options.min - 1e-6)
        throw new Error('Choose a search range long enough for the requested loop duration at the source frame rate.');
    // About ten samples per second keep every repeat within one or two source
    // frames of a sample. Verification then checks the neighboring frames.
    const stepFrames = Math.max(1, Math.round(fps / 10));
    const intervals = Math.min(1600, lastFrame - firstFrame, Math.max(1, Math.ceil((lastFrame - firstFrame) / stepFrames)));
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
            onProgress(i / count * 0.68, `Sampling frame ${i + 1} of ${count}…`);
        }
        aborted(signal);
        onProgress(0.7, 'Comparing image structure and motion…');
        worker = new Worker(new URL('./search.worker.js', import.meta.url), { type: 'module' });
        const candidates = await new Promise((resolve, reject) => {
            const abort = () => { worker?.terminate(); reject(new DOMException('Cancelled', 'AbortError')); };
            signal.addEventListener('abort', abort, { once: true });
            worker.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('The analysis worker failed. Try a smaller search range.')); };
            worker.onmessage = event => { signal.removeEventListener('abort', abort); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.candidates); };
            // Frames are copied, not transferred: they also identify repeated cycles later.
            worker.postMessage({ frames, options: { ...options, limit: 2 * verifyLimit(plan.end - plan.first, options.min), endBoundary: plan.end } });
        });
        worker.terminate();
        worker = undefined;
        // Verify promising matches with real adjacent frames at every nearby exclusive
        // end. A sampled end can sit a frame or two away from the true repeat, and a
        // duplicated or skipped frame at the seam is exactly what must be rejected.
        const ratio = Math.min(1, 160 / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.round(video.videoWidth * ratio));
        const height = Math.max(1, Math.round(video.videoHeight * ratio));
        const target = lumaCanvas(width, height);
        const firstIndex = Math.round(plan.first * fps), endIndex = Math.round(plan.end * fps);
        const cache = new Map();
        const readFrame = async index => {
            if (cache.has(index)) return cache.get(index);
            const luma = await readLuma(video, (index + .5) / fps, target, signal);
            const frame = { ...descriptor(video, index / fps), luma };
            if (cache.size >= 512) cache.delete(cache.keys().next().value);
            cache.set(index, frame); return frame;
        };
        const radius = Math.max(1, Math.ceil(step * fps / 2));
        const shortlist = diverseShortlist(candidates, verifyLimit(plan.end - plan.first, options.min));
        const verified = [];
        for (const [i, c] of shortlist.entries()) {
            aborted(signal);
            onProgress(.72 + i / shortlist.length * .26, `Checking seam ${i + 1} of ${shortlist.length} frame by frame…`);
            // Both boundaries may be off by up to half a sampling step.
            const sampledStart = Math.round(c.start * fps), sampledEnd = Math.round(c.end * fps);
            let best;
            for (let a = Math.max(firstIndex, sampledStart - radius); a <= sampledStart + radius; a++) for (let b = sampledEnd - radius; b <= sampledEnd + radius; b++) {
                const duration = (b - a) / fps;
                if (b > endIndex || b - a < 4 || duration < options.min - 1e-6 || duration > options.max + 1e-6)
                    continue;
                const read = index => index >= firstIndex && index < endIndex ? readFrame(index) : undefined;
                const frames = { start: await read(a), startNext: await read(a + 1), startNext2: await read(a + 2), end: await read(b - 1), endPrevious: await read(b - 2), endPrevious2: await read(b - 3), after: await read(b), before: await read(a - 1) };
                if (cutAtBoundary(frames)) continue;
                const match = seamMatch(frames, width, height, options.preferMotion, c.cuts);
                if (!best || match.seamError < best.seamError)
                    best = { ...c, ...match, start: a / fps, end: b / fps, coarseScore: c.score, verified: true };
            }
            if (best) verified.push(best);
        }
        const distinct = verified.length ? bestLoops(verified) : [];
        for (let i = 0; i < distinct.length; i++) {
            await seekVideo(video, distinct[i].start + 0.5 / fps, signal);
            // Keep the source's shape; the list scales the preview down.
            distinct[i].thumbnail = capture(video, width, height).toDataURL('image/jpeg', 0.75);
            onProgress(0.98 + i / distinct.length * 0.02, 'Preparing loop candidates…');
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
