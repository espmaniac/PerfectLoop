// Text fills use local, unrotated block coordinates, shared by every renderer.
const types = new Set(['solid', 'linear', 'radial', 'conic']);
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export function effectiveFill(layer) {
    return layer.fill === undefined ? { type: 'solid', color: layer.color, opacity: 100 } : layer.fill;
}

export function validateFill(fill) {
    if (!fill || typeof fill !== 'object' || !types.has(fill.type))
        return ['text fill type is invalid.'];
    const issues = [];
    if (fill.type === 'solid') {
        if (!color(fill.color))
            issues.push('text color must be a six-digit hex color.');
        if (!finite(fill.opacity, 0, 100))
            issues.push('text color opacity must be between 0% and 100%.');
        return issues;
    }
    if (fill.type === 'linear' || fill.type === 'conic') {
        if (!finite(fill.angle, 0, 360))
            issues.push('gradient angle must be between 0° and 360°.');
    }
    if (fill.type === 'radial' || fill.type === 'conic') {
        if (!finite(fill.centerX, 0, 100) || !finite(fill.centerY, 0, 100))
            issues.push('gradient center must be between 0% and 100%.');
    }
    if (fill.type === 'radial' && !finite(fill.radius, 1, 200))
        issues.push('gradient radius must be between 1% and 200%.');
    if (!Array.isArray(fill.stops) || fill.stops.length < 2) {
        issues.push('a gradient needs at least two color stops.');
        return issues;
    }
    // There is no color-stop cap. Equal positions produce deliberate hard edges.
    for (const [index, stop] of fill.stops.entries()) {
        const label = `gradient stop ${index + 1}`;
        if (!stop || typeof stop !== 'object') {
            issues.push(`${label} is invalid.`);
            continue;
        }
        if (!color(stop.color))
            issues.push(`${label} color must be a six-digit hex color.`);
        if (!finite(stop.opacity, 0, 100))
            issues.push(`${label} opacity must be between 0% and 100%.`);
        if (!finite(stop.position, 0, 100))
            issues.push(`${label} position must be between 0% and 100%.`);
    }
    return issues;
}

export function fillCacheKey(fill) {
    if (fill.type === 'solid')
        return [fill.type, fill.color, fill.opacity];
    const stops = fill.stops.map(stop => [stop.color, stop.opacity, stop.position]);
    if (fill.type === 'linear')
        return [fill.type, fill.angle, stops];
    if (fill.type === 'radial')
        return [fill.type, fill.centerX, fill.centerY, fill.radius, stops];
    return [fill.type, fill.angle, fill.centerX, fill.centerY, stops];
}

export function gradientGeometry(fill, width, height) {
    if (!(width > 0 && height > 0) || !Number.isFinite(width) || !Number.isFinite(height))
        throw new Error('Text fill needs valid text block dimensions.');
    if (fill.type === 'linear') {
        const angle = fill.angle * Math.PI / 180;
        // Snap cardinal-angle noise so scaling and right angles stay exact.
        const dx = Math.round(Math.cos(angle) * 1e12) / 1e12;
        const dy = Math.round(Math.sin(angle) * 1e12) / 1e12;
        const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
        return { type: 'linear', x0: -dx * half, y0: -dy * half, x1: dx * half, y1: dy * half };
    }
    const x = (fill.centerX / 100 - 0.5) * width;
    const y = (fill.centerY / 100 - 0.5) * height;
    if (fill.type === 'radial')
        return { type: 'radial', x, y, radius: Math.hypot(width, height) / 2 * fill.radius / 100 };
    if (fill.type === 'conic')
        return { type: 'conic', x, y, angle: fill.angle * Math.PI / 180 };
    throw new Error('Choose a linear, radial, or conic gradient.');
}

function rgba(hex, opacity) {
    const value = Number.parseInt(hex.slice(1), 16);
    // Keep the stop's actual RGB even when fully transparent; interpolating
    // against transparent black would add an unintended dark transition.
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity / 100})`;
}

export function textPaint(ctx, fill, width, height) {
    const issues = validateFill(fill);
    if (issues.length)
        throw new Error(issues[0]);
    if (fill.type === 'solid')
        return rgba(fill.color, fill.opacity);
    const geometry = gradientGeometry(fill, width, height);
    let paint;
    if (geometry.type === 'linear')
        paint = ctx.createLinearGradient(geometry.x0, geometry.y0, geometry.x1, geometry.y1);
    else if (geometry.type === 'radial')
        paint = ctx.createRadialGradient(geometry.x, geometry.y, 0, geometry.x, geometry.y, geometry.radius);
    else {
        if (typeof ctx.createConicGradient !== 'function')
            throw new Error('This browser cannot render conic gradients. Choose a linear or radial gradient, or use a newer browser.');
        paint = ctx.createConicGradient(geometry.angle, geometry.x, geometry.y);
    }
    const sorted = fill.stops.map((stop, index) => ({ stop, index })).sort((first, second) => first.stop.position - second.stop.position || first.index - second.index);
    for (const { stop } of sorted)
        paint.addColorStop(stop.position / 100, rgba(stop.color, stop.opacity));
    return paint;
}
