// Selection coordinates are output pixels; placement never depends on display zoom.
export function selectionBounds(points, width, height, feather = 0) {
    if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Draw a closed selection first.');
    let area = 0;
    for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; area += a.x * b.y - b.x * a.y; }
    if (Math.abs(area) < 4) throw new Error('Select a larger area.');
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    let left = Math.max(0, Math.floor(Math.min(...xs) - feather)), right = Math.min(width, Math.ceil(Math.max(...xs) + feather));
    const top = Math.max(0, Math.floor(Math.min(...ys) - feather)), bottom = Math.min(height, Math.ceil(Math.max(...ys) + feather));
    if (right <= left || bottom <= top) throw new Error('Select an area inside the frame.');
    // Existing image layers support a minimum width of 1% of the output.
    const minimum = Math.ceil(width / 100);
    if (right - left < minimum) { left = Math.max(0, Math.min(left, width - minimum)); right = left + minimum; }
    if (right <= left || bottom <= top) throw new Error('Select an area inside the frame.');
    return { left, top, width: right - left, height: bottom - top };
}

// Three small box passes approximate a soft edge without Canvas filter support
// (which differs across browsers). Outside the mask is always transparent.
export function featherAlpha(alpha, width, height, radius) {
    if (!radius) return alpha;
    const r = Math.max(1, Math.round(radius / 3)), divisor = 2 * r + 1;
    let source = Float32Array.from(alpha);
    for (let pass = 0; pass < 3; pass++) {
        const horizontal = new Float32Array(source.length), vertical = new Float32Array(source.length);
        for (let y = 0; y < height; y++) {
            let sum = 0;
            for (let x = 0; x <= r && x < width; x++) sum += source[y * width + x];
            for (let x = 0; x < width; x++) {
                horizontal[y * width + x] = sum / divisor;
                if (x - r >= 0) sum -= source[y * width + x - r];
                if (x + r + 1 < width) sum += source[y * width + x + r + 1];
            }
        }
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let y = 0; y <= r && y < height; y++) sum += horizontal[y * width + x];
            for (let y = 0; y < height; y++) {
                vertical[y * width + x] = sum / divisor;
                if (y - r >= 0) sum -= horizontal[(y - r) * width + x];
                if (y + r + 1 < height) sum += horizontal[(y + r + 1) * width + x];
            }
        }
        source = vertical;
    }
    return Uint8ClampedArray.from(source);
}

export function extractPatch(frame, points, feather) {
    const padding = feather > 0 ? 3 * Math.max(1, Math.round(feather / 3)) + 1 : 0;
    const bounds = selectionBounds(points, frame.width, frame.height, padding);
    const canvas = document.createElement('canvas'); canvas.width = bounds.width; canvas.height = bounds.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.beginPath(); points.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x - bounds.left, p.y - bounds.top)); ctx.closePath(); ctx.fill();
    const mask = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const alpha = featherAlpha(Uint8ClampedArray.from({ length: canvas.width * canvas.height }, (_, p) => mask.data[p * 4 + 3]), canvas.width, canvas.height, feather);
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(frame, -bounds.left, -bounds.top);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let p = 0; p < alpha.length; p++) pixels.data[p * 4 + 3] = alpha[p];
    ctx.putImageData(pixels, 0, 0);
    return { canvas, bounds };
}
