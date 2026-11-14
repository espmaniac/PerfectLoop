import { framePlan } from './logic.js';

// Blend weight of the head (loop start) in frame m of a k-frame overlap, from 0 at
// the first blended frame to 1 at the last. videoGraph uses the same curve.
export function blendWeight(curve, m, k) {
    const u = k > 1 ? m / (k - 1) : 1;
    return curve === 'smooth' ? u * u * (3 - 2 * u) : curve === 'cosine' ? (1 - Math.cos(Math.PI * u)) / 2 : u;
}

// The source frame shown at eased (smooth ping-pong) output frame t of n frames,
// slow at both turns. videoGraph retimes frame N to acos(1 - 2N/(n-1))(n-1)/PI;
// the fps filter then shows the last frame retimed strictly before t + 1, and
// the turning frame is appended at t = n - 1.
export function easedFrame(t, n) {
    if (t >= n - 1) return n - 1;
    const before = (n - 1) * (1 - Math.cos(Math.PI * (t + 1) / (n - 1))) / 2;
    return Math.min(n - 2, Math.max(0, Math.ceil(before - 1e-9) - 1));
}

// Which frames of the selected source range make output frame j of one finished
// cycle, mirroring videoGraph: { a } alone, or a mix of a and b with weight of b,
// and the brightness of a fade. Source frame k is the k-th output-rate frame of
// the range (start + k * speed / fps).
export function outputFrame(s, j) {
    const { frames: n, overlap: k, outputFrames: out } = framePlan(s);
    const shift = Math.round(out * s.shift / 100);
    const c = ((j % out) + out + (shift > 0 && shift < out ? shift : 0)) % out;
    if (s.method === 'crossfade' || s.method === 'offset') {
        if (c < n - 2 * k) return { a: c + k, b: c + k, weight: 0, level: 1 };
        const m = c - (n - 2 * k);
        return { a: n - k + m, b: m, weight: blendWeight(s.curve, m, k), level: 1 };
    }
    if (s.method === 'pingpong' || s.method === 'smooth-pingpong') {
        const t = c < n ? c : 2 * n - 2 - c;
        const frame = s.method === 'smooth-pingpong' ? easedFrame(t, n) : t;
        return { a: frame, b: frame, weight: 0, level: 1 };
    }
    if (s.method === 'fade') {
        const f = Math.min(k, Math.floor(n / 2)), ramp = Math.max(1, f - 1);
        const level = Math.min(1, c / ramp, (n - 1 - c) / ramp);
        return { a: c, b: c, weight: 0, level: Math.max(0, level) };
    }
    return { a: c, b: c, weight: 0, level: 1 };
}

// Settings the live preview cannot show. Everything else (methods, framing,
// layers) is drawn in the browser without encoding.
export function needsEncoding(s) {
    return Boolean(s.repair) || Boolean(s.interpolate);
}
