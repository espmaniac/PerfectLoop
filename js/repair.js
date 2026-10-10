// Repair settings describe normalized source frames, before loop assembly and layers.
export const REPAIR_KEYS = ['start', 'end', 'speed', 'fps', 'width', 'height', 'fit', 'zoom', 'cropX', 'cropY', 'rotate', 'mirror', 'background', 'interpolate'];
export const repairSignature = s => JSON.stringify(REPAIR_KEYS.map(key => s[key]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mean = values => values.reduce((sum, x) => sum + x, 0) / values.length;
export function repairIssues(repair) {
    if (repair == null) return [];
    if (repair.version !== 1 || !Array.isArray(repair.brightness) || repair.brightness.length < 3 || repair.brightness.length > 49
        || repair.brightness.some(x => !Number.isFinite(x) || Math.abs(x) > 0.08)
        || !Number.isFinite(repair.shiftX) || Math.abs(repair.shiftX) > 0.04
        || !Number.isFinite(repair.shiftY) || Math.abs(repair.shiftY) > 0.04
        || !Number.isFinite(repair.strength) || repair.strength < 0 || repair.strength > 1
        || typeof repair.flicker !== 'boolean' || typeof repair.alignment !== 'boolean')
        return ['Analyze the loop again to create valid repair settings.'];
    return [];
}
export function analyzeRepairFrames(frames, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || frames.length < 3 || frames.some(f => f.length !== width * height)) throw new Error('Not enough frames to analyze this loop.');
    const first = frames[0], last = frames.at(-1), count = frames.length;
    const average = frames.map(f => mean(f));
    // Estimate exposure on the most stable, non-clipped pixels. Moving bright
    // objects should not dominate the brightness curve.
    const variance = Array.from(first, (_, p) => {
        const m = frames.reduce((s, f) => s + f[p], 0) / count;
        return { p, m, variance: frames.reduce((s, f) => s + (f[p] - m) ** 2, 0) / count };
    }).filter(v => v.m > 16 && v.m < 239).sort((a, b) => a.variance - b.variance);
    const stable = variance.slice(0, Math.max(1, Math.floor(variance.length * 0.35)));
    const levels = stable.length >= width * height * 0.08
        ? frames.map(f => mean(stable.map(v => f[v.p]))) : average;
    // Circular smoothing includes samples on both sides of the file boundary.
    // Endpoints represent the same cycle phase, so their target is identical.
    const target = levels.map((_, i) => {
        let sum = 0, weights = 0;
        for (let j = 0; j < count; j++) {
            const d = Math.abs(i - j) / (count - 1), distance = Math.min(d, 1 - d);
            const weight = Math.exp(-0.5 * (distance / 0.06) ** 2);
            sum += levels[j] * weight; weights += weight;
        }
        return sum / weights;
    });
    const brightness = levels.map((level, i) => clamp((target[i] - level) / 255, -0.08, 0.08));
    const margin = 6, maxX = Math.max(1, Math.min(4, Math.floor(width * 0.035))), maxY = Math.max(1, Math.min(4, Math.floor(height * 0.035)));
    function error(dx, dy) {
        let total = 0, pixels = 0;
        for (let y = margin; y < height - margin; y += 2) for (let x = margin; x < width - margin; x += 2) {
            // Limit outliers from rain, foam, and independently moving details.
            total += Math.min(40, Math.abs((first[y * width + x] - average[0]) - (last[(y - dy) * width + x - dx] - average.at(-1)))); pixels++;
        }
        return total / Math.max(1, pixels);
    }
    const baseline = error(0, 0); let best = { dx: 0, dy: 0, error: baseline };
    for (let dy = -maxY; dy <= maxY; dy++) for (let dx = -maxX; dx <= maxX; dx++) {
        const score = error(dx, dy);
        if (score < best.error) best = { dx, dy, error: score };
    }
    const improvement = baseline > 0 ? (baseline - best.error) / baseline : 0;
    // Reject motion-heavy and search-edge matches rather than suggesting a large warp.
    const alignmentUseful = improvement > 0.2 && best.error < 12 && Math.abs(best.dx) < maxX && Math.abs(best.dy) < maxY;
    const adjacent = frames.slice(1).map((f, i) => mean(Array.from(f, (v, p) => Math.abs(v - frames[i][p])))).sort((a,b) => a-b);
    const seam = mean(Array.from(first, (v, p) => Math.abs(v - last[p])));
    return { brightness, shiftX: alignmentUseful ? best.dx / width : 0, shiftY: alignmentUseful ? best.dy / height : 0,
        brightnessJump: levels[0] - levels.at(-1), brightnessVariation: Math.max(...levels) - Math.min(...levels),
        seam, typical: adjacent[Math.floor(adjacent.length / 2)], alignmentUseful, improvement,
        flickerUseful: Math.max(...brightness.map(Math.abs)) > 1 / 255 };
}
export function repairFilters(s, frames) {
    const r = s.repair;
    if (!r || repairIssues(r).length || !r.strength) return '';
    const filters = [];
    if (r.flicker) {
        // Piecewise linear curve. Values and frame positions are numeric and bounded.
        const step = (frames - 1) / (r.brightness.length - 1);
        let expression = (r.brightness.at(-1) * r.strength).toFixed(7);
        for (let i = r.brightness.length - 2; i >= 0; i--) {
            const a = r.brightness[i] * r.strength, delta = (r.brightness[i + 1] - r.brightness[i]) * r.strength;
            expression = `if(lt(n,${((i + 1) * step).toFixed(6)}),${a.toFixed(7)}+(${delta.toFixed(7)})*(n-${(i * step).toFixed(6)})/${step.toFixed(6)},${expression})`;
        }
        filters.push(`eq=brightness='${expression}':eval=frame`);
    }
    if (r.alignment && (r.shiftX || r.shiftY)) {
        const dx = r.shiftX * s.width * r.strength, dy = r.shiftY * s.height * r.strength;
        const overscan = Math.max(Math.abs(r.shiftX), Math.abs(r.shiftY)) * r.strength;
        const mx = Math.ceil(s.width * overscan) + 2, my = Math.ceil(s.height * overscan) + 2;
        const u = `min(1,max(0,(n/${frames - 1}-0.65)/0.35))`, weight = `((${u})*(${u})*(3-2*(${u})))`;
        filters.push(`scale=${s.width + 2 * mx}:${s.height + 2 * my}`, `crop=${s.width}:${s.height}:x='${mx}-(${(dx * (s.width + 2 * mx) / s.width).toFixed(6)})*${weight}':y='${my}-(${(dy * (s.height + 2 * my) / s.height).toFixed(6)})*${weight}':exact=1`, 'setsar=1');
    }
    return filters.join(',');
}

export function suggestRepairCut(frames, times, frameStep, start, end) {
    const score = (a, b) => {
        let total = 0;
        for (let p = 0; p < frames[a].length; p++) {
            const motionA = frames[a + 1][p] - frames[a][p], motionB = frames[b][p] - frames[b - 1][p];
            total += Math.abs(frames[a][p] - frames[b][p]) + 0.35 * Math.abs(motionA - motionB);
        }
        return total / frames[a].length;
    };
    const baseline = score(0, frames.length - 1); let best = null;
    for (let a = 0; a < frames.length - 2 && times[a] - times[0] <= 0.5; a++) {
        for (let b = frames.length - 1; b > a + 1 && times.at(-1) - times[b] <= 0.5; b--) {
            const value = score(a, b);
            if (value < baseline * 0.7 && (!best || value < best.score)) {
                const from = Math.max(start, times[a] - frameStep / 2), to = Math.min(end, times[b] + frameStep / 2);
                if (to - from >= 3 * frameStep) best = { start: from, end: to, score: value };
            }
        }
    }
    return best;
}
