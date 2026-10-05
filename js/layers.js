// Layer pixels are shared by the canvas preview and FFmpeg exports. Movement is
// measured in output-frame coordinates, independently of a layer's rotation.
export const MAX_LAYERS = 8;
export const MAX_TEXT_LENGTH = 500;
const MAX_IMAGE_BYTES = 20 * 1024 ** 2;
const MAX_IMAGE_PIXELS = 16 * 1024 ** 2;
const MAX_SPRITE_SIDE = 4096;
const MAX_SPRITE_PIXELS = 16 * 1024 ** 2;
const assets = new Map();
const sprites = new Map();
const motions = new Set(['none', 'right', 'left', 'down', 'up']);
const fonts = new Set(['sans-serif', 'serif', 'monospace']);
const alignments = new Set(['left', 'center', 'right']);
let sequence = 0;
let measurementContext;

const id = () => globalThis.crypto?.randomUUID?.() || `layer-${Date.now().toString(36)}-${++sequence}`;
const mod = (value, extent) => ((value % extent) + extent) % extent;
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const base = () => ({ id: id(), visible: true, x: 50, y: 50, rotation: 0, opacity: 100, motion: 'none' });

export function createTextLayer(settings = { width: 576, height: 1024 }) {
    const fontSize = Math.max(8, Math.floor(Math.min(64, settings.width / 8, settings.height / 6)));
    return Object.freeze({ ...base(), type: 'text', name: 'Your text', text: 'Your text', fontFamily: 'sans-serif', fontSize, color: '#ffffff', align: 'center' });
}

export function duplicateLayer(layer) {
    return Object.freeze({ ...layer, id: id(), name: `${layer.name || (layer.type === 'text' ? 'Text' : 'Image')} copy` });
}

function canvas(width, height) {
    const result = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(width, height);
    result.width = width;
    result.height = height;
    return result;
}

async function decodeImage(file) {
    if (typeof createImageBitmap === 'function')
        return createImageBitmap(file);
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        // Copy immediately so animated GIF assets become a static first frame.
        const firstFrame = canvas(image.naturalWidth, image.naturalHeight);
        firstFrame.getContext('2d').drawImage(image, 0, 0);
        return firstFrame;
    }
    finally {
        URL.revokeObjectURL(url);
    }
}

export async function importImageLayer(file) {
    if (!file || !/^(image\/(png|jpeg|webp|gif))$/i.test(file.type || '') && !/\.(png|jpe?g|webp|gif)$/i.test(file.name || ''))
        throw new Error('Choose a PNG, JPEG, WebP, or GIF image.');
    if (file.size > MAX_IMAGE_BYTES)
        throw new Error('Choose an image smaller than 20 MB.');
    let image;
    try {
        image = await decodeImage(file);
    }
    catch {
        throw new Error('This image could not be read. Choose a valid PNG, JPEG, WebP, or GIF file.');
    }
    if (!(image.width > 0 && image.height > 0) || image.width * image.height > MAX_IMAGE_PIXELS) {
        image.close?.();
        throw new Error('Choose an image with no more than 16 megapixels.');
    }
    const assetId = id();
    assets.set(assetId, image);
    return Object.freeze({ ...base(), type: 'image', name: file.name || 'Image', assetId, width: 30 });
}

// Only use this for an import that was cancelled or rejected before adding the
// layer. Added image assets must survive removal so undo can restore them.
export function discardImportedImageLayer(layer) {
    if (layer?.type !== 'image')
        return;
    const image = assets.get(layer.assetId);
    assets.delete(layer.assetId);
    sprites.delete(layer.id);
    image?.close?.();
}

export function validateLayers(layers, settings) {
    if (!Array.isArray(layers))
        return ['The layer list is invalid.'];
    const issues = [];
    if (layers.length > MAX_LAYERS)
        issues.push(`Use no more than ${MAX_LAYERS} layers.`);
    const ids = new Set();
    for (const [index, layer] of layers.entries()) {
        const label = `Layer ${index + 1}`;
        const previousIssues = issues.length;
        if (!layer || typeof layer !== 'object' || !['text', 'image'].includes(layer.type)) {
            issues.push(`${label} must be text or an image.`);
            continue;
        }
        if (typeof layer.id !== 'string' || !layer.id || ids.has(layer.id))
            issues.push(`${label} needs a unique ID.`);
        ids.add(layer.id);
        if (typeof layer.visible !== 'boolean')
            issues.push(`${label} visibility is invalid.`);
        if (!finite(layer.x, 0, 100) || !finite(layer.y, 0, 100))
            issues.push(`${label} position must be between 0% and 100%.`);
        if (!finite(layer.rotation, -360, 360))
            issues.push(`${label} rotation must be between -360° and 360°.`);
        if (!finite(layer.opacity, 0, 100))
            issues.push(`${label} opacity must be between 0% and 100%.`);
        if (!motions.has(layer.motion))
            issues.push(`${label} animation direction is invalid.`);
        if (layer.type === 'text') {
            if (typeof layer.text !== 'string' || !layer.text.trim() || layer.text.length > MAX_TEXT_LENGTH)
                issues.push(`${label} text must contain 1–${MAX_TEXT_LENGTH} characters.`);
            if (!fonts.has(layer.fontFamily))
                issues.push(`${label} font is invalid.`);
            if (!finite(layer.fontSize, 8, 256))
                issues.push(`${label} font size must be between 8 and 256 px.`);
            if (!/^#[0-9a-f]{6}$/i.test(layer.color || ''))
                issues.push(`${label} text color is invalid.`);
            if (!alignments.has(layer.align))
                issues.push(`${label} text alignment is invalid.`);
        }
        else {
            if (!finite(layer.width, 1, 100))
                issues.push(`${label} image width must be between 1% and 100%.`);
            if (!assets.has(layer.assetId))
                issues.push(`${label} image is unavailable. Add the image again.`);
        }
        // Read text metrics on a tiny measurement canvas, using exactly the
        // geometry that rasterization uses. Pure Node schema checks still work
        // without a browser or a canvas implementation.
        if (issues.length === previousIssues && Number.isFinite(settings?.width) && settings.width > 0 && (layer.type === 'image' || textMeasurementContext())) {
            const geometry = spriteGeometry(layer, settings);
            if (!fitsSprite(geometry) || !fitsSprite(geometry.size))
                issues.push(spriteSizeIssue(layer, label));
        }
    }
    return issues;
}

export function layerPosition(layer, width, height, time, period) {
    let x = layer.x / 100 * width, y = layer.y / 100 * height;
    if (!(period > 0) || !Number.isFinite(period) || !Number.isFinite(time))
        return { x, y };
    // Reducing time before calculating distance also keeps long playback stable.
    const progress = mod(time, period) / period;
    if (layer.motion === 'right' || layer.motion === 'left')
        x = mod(x + (layer.motion === 'right' ? 1 : -1) * progress * width, width);
    else if (layer.motion === 'down' || layer.motion === 'up')
        y = mod(y + (layer.motion === 'down' ? 1 : -1) * progress * height, height);
    return { x, y };
}

function rotatedDimensions(width, height, rotation) {
    const radians = rotation * Math.PI / 180;
    // Rounding trigonometric noise avoids an extra pixel at right angles.
    const cosine = Math.round(Math.abs(Math.cos(radians)) * 1e12) / 1e12;
    const sine = Math.round(Math.abs(Math.sin(radians)) * 1e12) / 1e12;
    return { width: Math.max(1, Math.ceil(width * cosine + height * sine)), height: Math.max(1, Math.ceil(width * sine + height * cosine)) };
}

function fitsSprite(size) {
    return size.width <= MAX_SPRITE_SIDE && size.height <= MAX_SPRITE_SIDE && size.width * size.height <= MAX_SPRITE_PIXELS;
}

function textMeasurementContext() {
    if (!measurementContext && (typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined')) {
        try {
            measurementContext = canvas(1, 1).getContext('2d');
        }
        catch { /* Text geometry is checked when a canvas is available. */ }
    }
    return measurementContext;
}

function spriteSizeIssue(layer, label) {
    return `${label} ${layer.type} is too large. Reduce its ${layer.type === 'text' ? 'font size or text length' : 'width or the video resolution'}.`;
}

function spriteGeometry(layer, settings, originalDimensions = settings) {
    const scale = settings.width / originalDimensions.width;
    let width, height, font, lines, lineHeight, bounds;
    const padding = 2 * scale;
    const image = layer.type === 'image' ? assets.get(layer.assetId) : undefined;
    if (layer.type === 'text') {
        font = `${layer.fontSize * scale}px ${layer.fontFamily}`;
        const measure = textMeasurementContext();
        if (!measure)
            throw new Error('Text layers need a browser with canvas support.');
        measure.font = font;
        lines = layer.text.split(/\r?\n/);
        const metrics = lines.map(line => measure.measureText(line || ' '));
        // Preserve glyph overhangs and ascenders rather than clipping italic or
        // accented characters to their advance width.
        const left = Math.max(0, ...metrics.map(metric => metric.actualBoundingBoxLeft || 0));
        const right = Math.max(1, ...metrics.map(metric => Math.max(metric.width, metric.actualBoundingBoxRight || 0)));
        const ascent = Math.max(layer.fontSize * scale, ...metrics.map(metric => metric.actualBoundingBoxAscent || 0));
        const descent = Math.max(layer.fontSize * scale * 0.3, ...metrics.map(metric => metric.actualBoundingBoxDescent || 0));
        lineHeight = layer.fontSize * scale * 1.2;
        bounds = { left, right, ascent, descent };
        width = Math.ceil(left + right + padding * 2);
        height = Math.ceil(ascent + descent + Math.max(0, lines.length - 1) * lineHeight + padding * 2);
    }
    else {
        if (!image)
            throw new Error('This image is unavailable. Add the image again.');
        width = Math.max(1, Math.round(settings.width * layer.width / 100));
        height = Math.max(1, Math.round(width * image.height / image.width));
    }
    const size = rotatedDimensions(width, height, layer.rotation);
    return { width, height, size, font, lines, lineHeight, bounds, padding, image };
}

function prepareSprite(layer, settings, originalDimensions = settings) {
    const scale = settings.width / originalDimensions.width;
    const signature = JSON.stringify([layer.type, layer.text, layer.fontFamily, layer.fontSize, layer.color, layer.align, layer.assetId, layer.width, layer.rotation, layer.opacity, settings.width, settings.height, scale]);
    const cached = sprites.get(layer.id);
    if (cached?.signature === signature) {
        sprites.delete(layer.id);
        sprites.set(layer.id, cached);
        return cached;
    }
    const { width, height, size, font, lines, lineHeight, bounds, padding, image } = spriteGeometry(layer, settings, originalDimensions);
    if (!fitsSprite({ width, height }) || !fitsSprite(size))
        throw new Error(spriteSizeIssue(layer, 'This'));
    const surface = canvas(size.width, size.height), ctx = surface.getContext('2d');
    ctx.translate(size.width / 2, size.height / 2);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.globalAlpha = layer.opacity / 100;
    if (layer.type === 'text') {
        ctx.font = font;
        ctx.fillStyle = layer.color;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        for (const [index, line] of lines.entries()) {
            const advance = ctx.measureText(line).width;
            const offset = layer.align === 'right' ? bounds.right - advance : layer.align === 'center' ? (bounds.right - advance) / 2 : 0;
            ctx.fillText(line, -width / 2 + bounds.left + padding + offset, -height / 2 + bounds.ascent + padding + index * lineHeight);
        }
    }
    else
        ctx.drawImage(image, -width / 2, -height / 2, width, height);
    const sprite = { signature, surface, width: size.width, height: size.height, png: undefined };
    // Cache one version per layer, so repeated slider changes do not retain old
    // full-resolution surfaces. Duplicates share only their imported image.
    sprites.set(layer.id, sprite);
    while (sprites.size > MAX_LAYERS)
        sprites.delete(sprites.keys().next().value);
    return sprite;
}

export function drawLayers(ctx, layers, settings, time, period) {
    const dimensions = { width: ctx.canvas.width, height: ctx.canvas.height };
    for (const layer of layers || []) {
        if (!layer?.visible || layer.opacity === 0 || validateLayers([layer]).length)
            continue;
        let sprite;
        try {
            sprite = prepareSprite(layer, dimensions, settings);
        }
        catch {
            continue; // Partially edited layers remain fixable in the editor.
        }
        const position = layerPosition(layer, dimensions.width, dimensions.height, time, period);
        const horizontal = layer.motion === 'left' || layer.motion === 'right';
        const vertical = layer.motion === 'up' || layer.motion === 'down';
        const extent = horizontal ? dimensions.width : dimensions.height;
        const copies = horizontal || vertical ? Math.max(1, Math.ceil((horizontal ? sprite.width : sprite.height) / (2 * extent))) : 0;
        const offsets = Array.from({ length: copies * 2 + 1 }, (_, index) => (index - copies) * extent);
        for (const offset of offsets)
            ctx.drawImage(sprite.surface, Math.round(position.x - sprite.width / 2 + (horizontal ? offset : 0)), Math.round(position.y - sprite.height / 2 + (vertical ? offset : 0)));
    }
}

async function pngBytes(surface) {
    const blob = typeof surface.convertToBlob === 'function' ? await surface.convertToBlob({ type: 'image/png' }) : await new Promise((resolve, reject) => surface.toBlob(value => value ? resolve(value) : reject(new Error('The layer image could not be created.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}

export async function rasterizeLayers(layers, settings, originalDimensions = settings) {
    const issues = validateLayers(layers, originalDimensions);
    if (issues.length)
        throw new Error(issues[0]);
    const result = [];
    for (const layer of layers) {
        if (!layer.visible || layer.opacity === 0)
            continue;
        const sprite = prepareSprite(layer, settings, originalDimensions);
        if (!sprite.png)
            sprite.png = await pngBytes(sprite.surface);
        result.push({ layer, width: sprite.width, height: sprite.height, png: sprite.png });
    }
    return result;
}

export function clearLayerAssets() {
    for (const image of assets.values())
        image.close?.();
    assets.clear();
    sprites.clear();
}
