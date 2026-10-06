import { clamp } from './logic.js';
export function pixelDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++)
        sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
}
export function visualFit(a, b) {
    let ss = 0, blocks = 0;
    // Local SSIM on sixteen 8×8 luminance windows, plus RGB error.
    for (let by = 0; by < 32; by += 8)
        for (let bx = 0; bx < 32; bx += 8) {
            let x = 0, y = 0, xx = 0, yy = 0, xy = 0;
            for (let j = 0; j < 8; j++)
                for (let i = 0; i < 8; i++) {
                    const p = ((by + j) * 32 + bx + i) * 3;
                    const av = a[p] * 0.2126 + a[p + 1] * 0.7152 + a[p + 2] * 0.0722;
                    const bv = b[p] * 0.2126 + b[p + 1] * 0.7152 + b[p + 2] * 0.0722;
                    x += av;
                    y += bv;
                    xx += av * av;
                    yy += bv * bv;
                    xy += av * bv;
                }
            x /= 64;
            y /= 64;
            const vx = Math.max(0, xx / 64 - x * x), vy = Math.max(0, yy / 64 - y * y), cov = xy / 64 - x * y;
            ss += ((2 * x * y + 0.0001) * (2 * cov + 0.0009)) / ((x * x + y * y + 0.0001) * (vx + vy + 0.0009));
            blocks++;
        }
    return clamp((ss / blocks) * 0.65 + Math.exp(-pixelDistance(a, b) * 6) * 0.35, 0, 1);
}
export function motionFit(a, an, bp, b) {
    let error = 0, activity = 0;
    for (let i = 0; i < a.length; i += 3) {
        const va = an[i] - a[i], vb = b[i] - bp[i];
        error += Math.abs(va - vb);
        activity += Math.abs(va) + Math.abs(vb);
    }
    const count = a.length / 3;
    return { motion: clamp(Math.exp(-error / count * 18), 0, 1), activity: activity / count / 2 };
}
export function pairScore(a, an, bp, b, preferMotion, cuts = 0, bn) {
    const visual = visualFit(a.pixels, b.pixels);
    // Search compares forward motion at the same phase, so natural acceleration
    // is not mistaken for a mismatch. Boundary inspection uses the actual last step.
    const { motion, activity } = bn ? motionFit(a.pixels, an.pixels, b.pixels, bn.pixels) : motionFit(a.pixels, an.pixels, bp.pixels, b.pixels);
    const staticPenalty = preferMotion ? Math.max(0, 1 - activity / 0.015) * 0.1 : 0;
    const score = 100 * clamp(visual * 0.78 + motion * 0.22 - staticPenalty - Math.min(0.25, cuts * 0.07), 0, 1);
    return { start: a.time, end: b.time, score, visual: visual * 100, motion: motion * 100, activity, cuts };
}
export function rankFrames(frames, opts) {
    // Bounds are enforced here as well as during decoding: analysis workers and
    // refinement must never nominate a clip outside the requested source range.
    frames = frames.filter(frame => frame.time >= opts.from - 1e-7 && frame.time < opts.to - 1e-7);
    const prefix = new Uint32Array(frames.length);
    for (let i = 1; i < frames.length; i++)
        prefix[i] = prefix[i - 1] + (pixelDistance(frames[i - 1].pixels, frames[i].pixels) > 0.24 ? 1 : 0);
    const shortlist = [];
    for (let a = 0; a < frames.length - 1; a++) {
        const matches = [];
        for (let b = a + 1; b < frames.length; b++) {
            // The terminal sample is the last frame inside an exclusive end.
            // Other samples represent matching phases and use forward motion.
            const end = b === frames.length - 1 && Number.isFinite(opts.endBoundary) ? opts.endBoundary : frames[b].time;
            const d = end - frames[a].time;
            if (d < opts.min - 1e-6)
                continue;
            if (d > opts.max + 1e-6)
                break;
            const cuts = prefix[b] - prefix[a];
            if (opts.avoidCuts && cuts > 0)
                continue;
            // Cheap shortlist avoids running SSIM over obviously unrelated frames.
            if (pixelDistance(frames[a].pixels, frames[b].pixels) > 0.22)
                continue;
            if (end > opts.to + 1e-7)
                continue;
            matches.push({ id: `${a}-${b}`, ...pairScore(frames[a], frames[a + 1], frames[b - 1], frames[b], opts.preferMotion, cuts, frames[b + 1]), end });
        }
        // Preserve strong alternatives at every start before applying a global
        // result limit. A raw top-100 list could be entirely near one timestamp.
        matches.sort((x, y) => y.score - x.score);
        const durations = [];
        for (const match of matches) {
            const duration = match.end - match.start;
            if (durations.some(other => Math.abs(other - duration) < 0.35))
                continue;
            shortlist.push(match);
            durations.push(duration);
            if (durations.length >= 16)
                break;
        }
    }
    return distinctCandidates(shortlist, opts);
}
export function distinctCandidates(candidates, opts) {
    const best = [...candidates].sort((x, y) => y.score - x.score);
    const distinct = [];
    const separation = opts.precision === 'detailed' ? 0.3 : 0.6;
    const duplicate = c => distinct.some(x => Math.abs(x.start - c.start) < separation && Math.abs((x.end - x.start) - (c.end - c.start)) < 0.35);
    for (let index = 0; index < best.length && distinct.length < 16;) {
        let end = index + 1;
        while (end < best.length && Math.abs(best[end].score - best[index].score) < 1e-8)
            end++;
        // Equal quality carries no reason to prefer the beginning of a video.
        // Spread ties across source time, without promoting weaker matches.
        const ties = best.slice(index, end);
        while (ties.length && distinct.length < 16) {
            let chosen = -1, widest = -1, durationGap = -1;
            for (let i = 0; i < ties.length; i++) {
                const c = ties[i];
                if (duplicate(c))
                    continue;
                const gap = distinct.length ? Math.min(...distinct.map(x => Math.abs(x.start - c.start))) : 0;
                const lengths = distinct.length ? Math.min(...distinct.map(x => Math.abs((x.end - x.start) - (c.end - c.start)))) : 0;
                if (gap > widest || (gap === widest && lengths > durationGap)) {
                    chosen = i;
                    widest = gap;
                    durationGap = lengths;
                }
            }
            if (chosen < 0)
                break;
            distinct.push(ties[chosen]);
            ties.splice(chosen, 1);
        }
        index = end;
    }
    return distinct;
}
