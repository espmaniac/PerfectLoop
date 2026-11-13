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
// Matches verified frame by frame: one for every stretch of the shortest loop
// length, so every moment of a long video is checked.
export function verifyLimit(seconds, minLength = 3) {
    return clamp(Math.ceil(seconds / Math.max(2, minLength)), 32, 240);
}
// Seam error is measured in frame steps of local motion: a repeated or skipped
// frame is about 0.4-0.9, while seamless repeats stay below 0.12 even with grain.
export const SEAM_LIMITS = { perfect: 0.15, good: 0.35, fair: 1 };
export function loopTier(seamError, exact = true) {
    if (seamError <= SEAM_LIMITS.perfect && exact) return 'perfect';
    return seamError <= SEAM_LIMITS.good ? 'good' : seamError <= SEAM_LIMITS.fair ? 'fair' : 'rough';
}
// Spread work over different moments: the strongest match of every stretch of
// the source first, then the remaining strongest matches with ties spread out.
// Each stretch is at least as long as the shortest match, so a weaker later
// scene is not displaced by many strong matches elsewhere.
export function diverseShortlist(candidates, limit) {
    if (!candidates.length) return [];
    const from = Math.min(...candidates.map(c => c.start)), to = Math.max(...candidates.map(c => c.start));
    const size = Math.max(Math.min(...candidates.map(c => c.end - c.start)), (to - from) / limit, 1e-6);
    const stretches = new Map();
    for (const c of candidates) {
        const key = Math.floor((c.start - from) / size), best = stretches.get(key);
        if (!best || c.score > best.score) stretches.set(key, c);
    }
    const picked = [...stretches.values()].sort((x, y) => y.score - x.score).slice(0, limit);
    for (const c of distinctCandidates(candidates, { limit: limit * 2 }))
        if (picked.length < limit && !picked.includes(c)) picked.push(c);
    return picked;
}
// Every perfect and good loop is listed. A source without one lists its fair
// loops, and a source without those its closest matches, so a search never
// comes back empty.
export function bestLoops(verified) {
    for (const tiers of [['perfect', 'good'], ['fair']]) {
        const found = verified.filter(c => tiers.includes(c.tier));
        if (found.length) return found;
    }
    const best = Math.min(...verified.map(c => c.seamError));
    return verified.filter(c => c.seamError <= best * 1.8 + .15);
}
// A loop is seamless when the frame shown after its last frame is the frame the
// source itself shows next. Compare the start with the source frame after the end
// (and the end with the frame before the start) in small tiles, relative to the
// normal change between neighboring frames. A repeated or skipped frame counts as
// a full frame of motion, while grain and compression noise are discounted.
export function seamError({ start, startNext, startNext2, end, endPrevious, endPrevious2, after, before }, width, height) {
    const size = 12, tiles = [];
    const tileMean = (a, b, x, y) => {
        let sum = 0, count = 0;
        for (let j = y; j < Math.min(height, y + size); j++)
            for (let i = x; i < Math.min(width, x + size); i++, count++)
                sum += Math.abs(a[j * width + i] - b[j * width + i]);
        return sum / count;
    };
    for (let y = 0; y < height; y += size)
        for (let x = 0; x < width; x += size) {
            const step = [tileMean(startNext, start, x, y), tileMean(end, endPrevious, x, y)];
            const normal = (step[0] + step[1]) / 2;
            // Motion accumulates over two frames while noise does not, so a tile
            // whose two-frame change equals its one-frame change contains only noise.
            const twoSteps = [startNext2 && tileMean(startNext2, start, x, y), endPrevious2 && tileMean(end, endPrevious2, x, y)];
            const noise = Math.min(...[0, 1].map(k => twoSteps[k] === undefined ? 0 : clamp(2 * step[k] - twoSteps[k], 0, step[k])));
            const truths = [after && tileMean(start, after, x, y), before && tileMean(end, before, x, y)].filter(v => v !== undefined);
            // Without either neighbor, only a jump beyond the usual motion is measurable.
            const error = truths.length ? Math.min(...truths) : Math.max(0, tileMean(start, end, x, y) - normal * 1.5);
            tiles.push({ error, noise, normal });
        }
    // Even grain is also visible as the quietest tiles' frame-to-frame change.
    const quiet = tiles.map(t => t.normal).sort((a, b) => a - b)[Math.floor(tiles.length * .1)] || 0;
    // A small moving object must not be averaged away by a static background.
    const worst = tiles.map(t => Math.max(0, t.error - Math.max(quiet, t.noise)) / (4 + t.normal)).sort((a, b) => b - a).slice(0, 6);
    return { error: worst.reduce((a, b) => a + b, 0) / worst.length, exact: Boolean(after || before) };
}
// Seam quality decides the tier. Static clips and cuts only lower the ranking.
export function seamMatch(frames, width, height, preferMotion, cuts = 0) {
    const seam = seamError(Object.fromEntries(Object.entries(frames).map(([key, frame]) => [key, frame?.luma])), width, height);
    const { activity } = motionFit(frames.start.pixels, frames.startNext.pixels, frames.endPrevious.pixels, frames.end.pixels);
    // Without a neighboring frame (the whole selection), a loop cannot be confirmed perfect.
    const tier = loopTier(seam.error, seam.exact);
    const quality = 100 * Math.exp(-seam.error * 0.7);
    const staticPenalty = preferMotion ? Math.max(0, 1 - activity / 0.015) * 10 : 0;
    const score = clamp(quality - staticPenalty - Math.min(25, cuts * 7), 0, 100);
    return { tier, quality, score, seamError: seam.error, activity, cuts };
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
    // The strongest match of every separate range first, so a long video is
    // covered throughout instead of around its few strongest moments.
    const candidates = diverseShortlist(shortlist, opts.limit ?? 16);
    // Always validate the complete selected cycle, even if coarse sampling favors
    // a shorter fragment or its global score falls below the shortlist cutoff.
    const duration = opts.endBoundary - frames[0]?.time;
    if (frames.length >= 2 && opts.endBoundary <= opts.to + 1e-7 && duration >= opts.min - 1e-6 && duration <= opts.max + 1e-6
        && (!opts.avoidCuts || prefix.at(-1) === 0)) {
        const full = { id: 'full-range', ...pairScore(frames[0], frames[1], frames.at(-2), frames.at(-1), opts.preferMotion, prefix.at(-1)), end: opts.endBoundary };
        if (!candidates.some(c => Math.abs(c.start-full.start)<1e-7 && Math.abs(c.end-full.end)<1e-7)) candidates.push(full);
    }
    return candidates;
}
// Cleaner tiers always come first; motion and cuts order loops within a tier.
const TIER_RANK = { perfect: 300, good: 200, fair: 100 };
const rank = candidate => candidate.score + (TIER_RANK[candidate.tier] ?? 0);
export function distinctCandidates(candidates, opts) {
    const limit = opts.limit ?? 16;
    const best = [...candidates].sort((x, y) => rank(y) - rank(x));
    const distinct = [];
    const separation = 0.3;
    const duplicate = c => distinct.some(x => Math.abs(x.start - c.start) < separation && Math.abs((x.end - x.start) - (c.end - c.start)) < 0.35);
    for (let index = 0; index < best.length && distinct.length < limit;) {
        let end = index + 1;
        while (end < best.length && Math.abs(rank(best[end]) - rank(best[index])) < 1e-8)
            end++;
        // Equal quality carries no reason to prefer the beginning of a video.
        // Spread ties across source time, without promoting weaker matches.
        const ties = best.slice(index, end);
        while (ties.length && distinct.length < limit) {
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

// Loops that show the same footage are one cycle at different phases, or played
// more than once: their lengths are equal or whole multiples, and the first frame
// of one appears inside the other, within the change between neighboring
// samples. Each loop gets a cycle number shared by its repeats.
export function markCycles(loops, frames) {
    const at = time => {
        let low = 0, high = frames.length - 1;
        while (low < high) { const mid = (low + high) >> 1; frames[mid].time < time - 1e-7 ? low = mid + 1 : high = mid; }
        return low;
    };
    const inside = loop => frames.slice(at(loop.start), Math.max(at(loop.start) + 1, at(loop.end)));
    const repeats = (a, b) => {
        const samples = inside(a), first = frames[at(b.start)];
        const steps = samples.slice(1).map((frame, i) => pixelDistance(samples[i].pixels, frame.pixels)).sort((x, y) => x - y);
        const step = steps[Math.floor(steps.length / 2)] || 0;
        return Math.min(...samples.map(frame => pixelDistance(frame.pixels, first.pixels))) <= Math.max(.004, step * .75);
    };
    const cycle = loops.map((_, i) => i);
    const root = i => cycle[i] === i ? i : (cycle[i] = root(cycle[i]));
    for (let i = 0; i < loops.length; i++) for (let j = 0; j < i; j++) {
        const a = loops[i], b = loops[j];
        const [short, long] = [a.end - a.start, b.end - b.start].sort((x, y) => x - y), times = Math.round(long / short);
        if (root(i) !== root(j) && Math.abs(long - times * short) <= .1 * times && (repeats(a, b) || repeats(b, a))) cycle[root(i)] = root(j);
    }
    loops.forEach((loop, i) => { loop.cycle = root(i); });
    return loops;
}
// Nonmaximum suppression keeps the strongest representative of overlapping clips.
// Compare with retained clips, so a chain of overlaps cannot hide a distant scene.
export function filterSimilarRanges(candidates, hideSimilar = true, limit = Infinity) {
    const visible = [];
    for (const candidate of [...candidates].sort((a,b) => rank(b)-rank(a))) {
        const duplicate = visible.some(other => {
            if (Math.abs(candidate.start-other.start)<1e-7 && Math.abs(candidate.end-other.end)<1e-7) return true;
            if (!hideSimilar) return false;
            const overlap = Math.min(candidate.end,other.end)-Math.max(candidate.start,other.start);
            const shorter = Math.min(candidate.end-candidate.start,other.end-other.start);
            return overlap / shorter >= .5 || (candidate.cycle !== undefined && candidate.cycle === other.cycle);
        });
        if (!duplicate) visible.push(candidate);
        if (visible.length >= limit) break;
    }
    return visible;
}
