// Scale applies in output axes after rotation; horizontal mirroring is applied
// separately after rotation by the canvas and FFmpeg renderers.
export function rotatedDimensions(sourceWidth, sourceHeight, rotation = 0) {
    const angle = rotation * Math.PI / 180;
    // Exact quarter turns avoid tiny floating-point padding and preserve the
    // dimensions used by older projects and their exports.
    const cosine = Math.abs(Math.cos(angle)) < 1e-12 ? 0 : Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle)) < 1e-12 ? 0 : Math.abs(Math.sin(angle));
    return { width: sourceWidth * cosine + sourceHeight * sine, height: sourceWidth * sine + sourceHeight * cosine };
}

export function videoTransform(settings, sourceWidth, sourceHeight, width = settings.width, height = settings.height) {
    const { width: rotatedWidth, height: rotatedHeight } = rotatedDimensions(sourceWidth, sourceHeight, settings.rotate);
    const zoom = (settings.zoom === undefined ? 100 : settings.zoom) / 100;
    let sx, sy;
    if (settings.fit === 'stretch') {
        sx = width / rotatedWidth * zoom;
        sy = height / rotatedHeight * zoom;
    }
    else {
        sx = sy = (settings.fit === 'cover'
            ? Math.max(width / rotatedWidth, height / rotatedHeight)
            : Math.min(width / rotatedWidth, height / rotatedHeight)) * zoom;
    }
    const scaledWidth = rotatedWidth * sx, scaledHeight = rotatedHeight * sy;
    return {
        sx, sy, scaledWidth, scaledHeight,
        offsetX: (width - scaledWidth) * (settings.cropX / 100 - 0.5),
        offsetY: (height - scaledHeight) * (settings.cropY / 100 - 0.5),
    };
}

export function videoSelectionGeometry(settings, info, dimensions = settings) {
    const width = dimensions.width, height = dimensions.height;
    const transform = videoTransform(settings, info.width, info.height, width, height);
    const centerX = width / 2 + transform.offsetX, centerY = height / 2 + transform.offsetY;
    const angle = settings.rotate * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
    const mirror = settings.mirror ? -1 : 1;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        const sourceX = x * info.width / 2, sourceY = y * info.height / 2;
        return {
            x: centerX + (sourceX * cosine - sourceY * sine) * transform.sx * mirror,
            y: centerY + (sourceX * sine + sourceY * cosine) * transform.sy,
        };
    });
    return {
        centerX, centerY, corners, copyIndex: 0,
        width: Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y),
        height: Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y),
        rotation: Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180 / Math.PI,
    };
}

export function videoRotate(settings, info, targetAngle, dimensions = settings) {
    const width = dimensions.width, height = dimensions.height;
    const original = videoTransform(settings, info.width, info.height, width, height);
    const base = videoTransform({ ...settings, rotate: targetAngle, zoom: 100 }, info.width, info.height, width, height);
    // A single zoom value cannot keep both screen axes unchanged for Stretch;
    // preserve their geometric mean instead of privileging one screen axis.
    const zoom = Math.max(25, Math.min(400, 100 * Math.sqrt(original.sx * original.sy / (base.sx * base.sy))));
    const next = videoTransform({ ...settings, rotate: targetAngle, zoom }, info.width, info.height, width, height);
    const position = (offset, span) => Math.abs(span) < 1e-9 ? 50 : Math.max(0, Math.min(100, 50 + offset / span * 100));
    return {
        rotate: targetAngle, zoom,
        cropX: position(original.offsetX, width - next.scaledWidth),
        cropY: position(original.offsetY, height - next.scaledHeight),
    };
}
