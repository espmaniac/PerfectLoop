import { videoTransform } from './framing.js';
import { seekVideo } from './media.js';

// Reading video frames for analysis: seek, draw (as is, or with the editor's
// framing), and convert to luminance. Every analysis reads frames the same way.

export function lumaCanvas(width, height) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), width, height };
}

// Rec. 709 luminance of the canvas, one value per pixel.
export function lumaOf({ ctx, width, height }) {
    const rgba = ctx.getImageData(0, 0, width, height).data;
    return Float32Array.from({ length: width * height }, (_, p) => rgba[p * 4] * .2126 + rgba[p * 4 + 1] * .7152 + rgba[p * 4 + 2] * .0722);
}

// Draws an image with the output framing (position, scale, rotation, mirror)
// over the background color. sourceWidth/Height are the image's original size,
// so a scaled-down image is placed exactly like the full-size video.
export function drawFramed(ctx, image, settings, width, height, sourceWidth = image.videoWidth, sourceHeight = image.videoHeight, background = true) {
    if (background) { ctx.fillStyle = settings.background; ctx.fillRect(0, 0, width, height); }
    const { sx, sy, offsetX, offsetY } = videoTransform(settings, sourceWidth, sourceHeight, width, height);
    ctx.save(); ctx.translate(width / 2 + offsetX, height / 2 + offsetY); ctx.scale(settings.mirror ? -sx : sx, sy);
    ctx.rotate(settings.rotate * Math.PI / 180); ctx.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight); ctx.restore();
}

// Luminance of the frame at `time`. With settings the frame is framed like the
// output; without, the whole frame is scaled to the canvas.
export async function readLuma(video, time, target, signal, settings = null) {
    await seekVideo(video, time, signal);
    if (settings) drawFramed(target.ctx, video, settings, target.width, target.height);
    else target.ctx.drawImage(video, 0, 0, target.width, target.height);
    return lumaOf(target);
}
