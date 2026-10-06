// Scale applies in output axes after rotation; horizontal mirroring is applied
// separately after rotation by the canvas and FFmpeg renderers.
export function videoTransform(settings, sourceWidth, sourceHeight, width = settings.width, height = settings.height) {
    const quarter = settings.rotate % 180 !== 0;
    const rotatedWidth = quarter ? sourceHeight : sourceWidth;
    const rotatedHeight = quarter ? sourceWidth : sourceHeight;
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
