// Layer pixels and movement geometry are shared by canvas previews and exports.
import { isFontAvailable, isFontReady, fontFamilyCSS, loadFont } from './fonts.js';
import { effectiveFill, validateFill, fillCacheKey, textPaint } from './text-fill.js';

export const MAX_LAYERS = 8;
export const MAX_TEXT_LENGTH = 500;
export const MAX_ANIMATION_CYCLES = 10;
const MAX_IMAGE_BYTES = 20 * 1024 ** 2;
const MAX_IMAGE_PIXELS = 16 * 1024 ** 2;
const MAX_SPRITE_SIDE = 4096;
const MAX_SPRITE_PIXELS = 16 * 1024 ** 2;
const assets = new Map();
const sprites = new Map();
const motions = new Set(['none', 'right', 'left', 'down', 'up', 'along-angle', 'against-angle']);
const spins = new Set(['none', 'clockwise', 'counterclockwise']);
const alignments = new Set(['left', 'center', 'right']);
let sequence = 0;
let measurementContext;

const id = () => globalThis.crypto?.randomUUID?.() || `layer-${Date.now().toString(36)}-${++sequence}`;
const mod = (value, extent) => ((value % extent) + extent) % extent;
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const base = () => ({ id: id(), visible: true, x: 50, y: 50, rotation: 0, opacity: 100, motion: 'none', spin: 'none', motionCycles: 1, spinCycles: 1 });

export function animationCycles(layer, kind) {
    const value = layer?.[`${kind}Cycles`];
    return Number.isInteger(value) && value >= 1 && value <= MAX_ANIMATION_CYCLES ? value : 1;
}

export function animationProgress(time, period, cycles = 1) {
    // Reduce time before multiplying to keep long playback stable. Snap exact
    // subcycle boundaries and normalize the phase to [0, 1), so every pass and
    // turn starts with identical coefficients instead of accumulated residue.
    const progress = cycles * mod(time, period) / period;
    const nearest = Math.round(progress);
    return (Math.abs(progress - nearest) < 1e-12 ? nearest : progress) % 1;
}

export function createTextLayer(settings = { width: 576, height: 1024 }) {
    const fontSize = Math.max(8, Math.floor(Math.min(64, settings.width / 8, settings.height / 6)));
    return Object.freeze({ ...base(), type: 'text', name: 'Your text', text: 'Your text', fontFamily: 'sans-serif', fontSize, color: '#ffffff', align: 'center' });
}

export function duplicateLayer(layer) {
    const copy = { ...layer, id: id(), name: `${layer.name || (layer.type === 'text' ? 'Text' : 'Image')} copy` };
    if (layer.fill && typeof layer.fill === 'object') {
        copy.fill = { ...layer.fill };
        if (Array.isArray(layer.fill.stops))
            copy.fill.stops = layer.fill.stops.map(stop => stop && typeof stop === 'object' ? { ...stop } : stop);
    }
    return Object.freeze(copy);
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
        if (!spins.has(layer.spin === undefined ? 'none' : layer.spin))
            issues.push(`${label} spin direction is invalid.`);
        for (const [kind, name] of [['motion', 'movement'], ['spin', 'rotation']]) {
            const cycles = layer[`${kind}Cycles`];
            if (cycles !== undefined && (!Number.isInteger(cycles) || !finite(cycles, 1, MAX_ANIMATION_CYCLES)))
                issues.push(`${label} ${name} cycles must be a whole number between 1 and ${MAX_ANIMATION_CYCLES}.`);
        }
        if (layer.type === 'text') {
            if (typeof layer.text !== 'string' || !layer.text.trim() || layer.text.length > MAX_TEXT_LENGTH)
                issues.push(`${label} text must contain 1–${MAX_TEXT_LENGTH} characters.`);
            if (!isFontAvailable(layer.fontFamily))
                issues.push(`${label} font is invalid.`);
            if (!finite(layer.fontSize, 8, 256))
                issues.push(`${label} font size must be between 8 and 256 px.`);
            issues.push(...validateFill(effectiveFill(layer)).map(issue => `${label} ${issue}`));
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
        if (issues.length === previousIssues && Number.isFinite(settings?.width) && settings.width > 0 && (layer.type === 'image' || isFontReady(layer.fontFamily) && textMeasurementContext())) {
            const geometry = spriteGeometry(layer, settings);
            if (!fitsSprite(geometry) || !fitsSprite(geometry.size))
                issues.push(spriteSizeIssue(layer, label));
        }
    }
    return issues;
}

export function angleTrajectory(layer, frameWidth, frameHeight, spriteWidth = 0, spriteHeight = 0) {
    if (!['along-angle', 'against-angle'].includes(layer.motion))
        return null;
    if (![frameWidth, frameHeight].every(value => Number.isFinite(value) && value > 0) || ![layer.x, layer.y, layer.rotation].every(Number.isFinite))
        return null;
    const x = layer.x / 100 * frameWidth, y = layer.y / 100 * frameHeight;
    const radians = layer.rotation * Math.PI / 180;
    const direction = layer.motion === 'against-angle' ? -1 : 1;
    // Snap trigonometric residuals to zero so cardinal angles use one slab.
    const dx = direction * Math.round(Math.cos(radians) * 1e12) / 1e12;
    const dy = direction * Math.round(Math.sin(radians) * 1e12) / 1e12;
    let min = -Infinity, max = Infinity;
    for (const [anchor, unit, extent, size] of [[x, dx, frameWidth, spriteWidth], [y, dy, frameHeight, spriteHeight]]) {
        if (unit === 0)
            continue;
        const padding = Number.isFinite(size) && size > 0 ? size / 2 : 0;
        const first = (-padding - anchor) / unit;
        const last = (extent + padding - anchor) / unit;
        min = Math.max(min, Math.min(first, last));
        max = Math.min(max, Math.max(first, last));
    }
    // A line through the anchor crosses this expanded frame. Its endpoints
    // place the whole rotated sprite outside the video before wrapping.
    const distance = max - min;
    return Number.isFinite(distance) && distance > 0 ? { x, y, dx, dy, min, distance } : null;
}

export function layerPosition(layer, width, height, time, period, spriteBounds = { width: 0, height: 0 }) {
    let x = layer.x / 100 * width, y = layer.y / 100 * height;
    if (!(period > 0) || !Number.isFinite(period) || !Number.isFinite(time))
        return { x, y };
    const progress = animationProgress(time, period, animationCycles(layer, 'motion'));
    const trajectory = angleTrajectory(layer, width, height, spriteBounds?.width, spriteBounds?.height);
    if (trajectory) {
        const displacement = trajectory.min + mod(-trajectory.min + trajectory.distance * progress, trajectory.distance);
        x = trajectory.x + trajectory.dx * displacement;
        y = trajectory.y + trajectory.dy * displacement;
    }
    else if (layer.motion === 'right' || layer.motion === 'left')
        x = mod(x + (layer.motion === 'right' ? 1 : -1) * progress * width, width);
    else if (layer.motion === 'down' || layer.motion === 'up')
        y = mod(y + (layer.motion === 'down' ? 1 : -1) * progress * height, height);
    return { x, y };
}

export function layerRotation(layer, time, period) {
    const rotation = Number.isFinite(layer?.rotation) ? layer.rotation : 0;
    const direction = layer?.spin === 'clockwise' ? 1 : layer?.spin === 'counterclockwise' ? -1 : 0;
    if (!direction || !(period > 0) || !Number.isFinite(period) || !Number.isFinite(time))
        return mod(rotation, 360);
    return mod(rotation + direction * 360 * animationProgress(time, period, animationCycles(layer, 'spin')), 360);
}

function spinsLayer(layer) {
    return layer.spin === 'clockwise' || layer.spin === 'counterclockwise';
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
        if (!isFontReady(layer.fontFamily))
            throw new Error('This font is still loading. Wait for the font before rendering.');
        font = `${layer.fontSize * scale}px ${fontFamilyCSS(layer.fontFamily)}`;
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
    // A single unrotated image serves every animated angle. Its safe square
    // contains the content's diagonal plus two source pixels on each side,
    // scaled with the preview, and at least one output pixel for interpolation.
    // Corners remain visible throughout a full turn in canvas and FFmpeg.
    const diameter = spinsLayer(layer) ? Math.ceil(Math.hypot(width, height)) + Math.max(2, Math.ceil(4 * scale)) : 0;
    const size = diameter ? { width: diameter, height: diameter } : rotatedDimensions(width, height, layer.rotation);
    return { width, height, size, font, lines, lineHeight, bounds, padding, image };
}

function prepareSprite(layer, settings, originalDimensions = settings) {
    const scale = settings.width / originalDimensions.width;
    const spinning = spinsLayer(layer);
    const signature = JSON.stringify([layer.type, layer.text, layer.fontFamily, layer.fontSize, layer.type === 'text' ? fillCacheKey(effectiveFill(layer)) : null, layer.align, layer.assetId, layer.width, spinning ? 'spin' : layer.rotation, layer.opacity, settings.width, settings.height, scale]);
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
    if (!spinning)
        ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.globalAlpha = layer.opacity / 100;
    if (layer.type === 'text') {
        ctx.font = font;
        ctx.fillStyle = textPaint(ctx, effectiveFill(layer), width, height);
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
    const sprite = { signature, surface, width: size.width, height: size.height, contentWidth: width, contentHeight: height, png: undefined };
    // Cache one version per layer, so repeated slider changes do not retain old
    // full-resolution surfaces. Duplicates share only their imported image.
    sprites.set(layer.id, sprite);
    while (sprites.size > MAX_LAYERS)
        sprites.delete(sprites.keys().next().value);
    return sprite;
}

function drawableSprite(layer, settings, dimensions) {
    if (!(dimensions?.width > 0 && dimensions?.height > 0) || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)
        || !layer?.visible || layer.opacity === 0 || validateLayers([layer]).length || layer.type === 'text' && !isFontReady(layer.fontFamily))
        return null;
    try {
        return prepareSprite(layer, dimensions, settings);
    }
    catch {
        return null; // Partially edited layers remain fixable in the editor.
    }
}

function spriteCopies(layer, sprite, dimensions, time, period) {
    const position = layerPosition(layer, dimensions.width, dimensions.height, time, period, sprite);
    const horizontal = layer.motion === 'left' || layer.motion === 'right';
    const vertical = layer.motion === 'up' || layer.motion === 'down';
    const extent = horizontal ? dimensions.width : dimensions.height;
    const count = horizontal || vertical ? Math.max(1, Math.ceil((horizontal ? sprite.width : sprite.height) / (2 * extent))) : 0;
    return Array.from({ length: count * 2 + 1 }, (_, index) => {
        const offset = (index - count) * extent;
        const left = Math.round(position.x - sprite.width / 2 + (horizontal ? offset : 0));
        const top = Math.round(position.y - sprite.height / 2 + (vertical ? offset : 0));
        return { left, top, centerX: left + sprite.width / 2, centerY: top + sprite.height / 2 };
    });
}

function selectionCopy(layer, sprite, copy, time, period) {
    const rotation = layerRotation(layer, time, period), radians = rotation * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const width = sprite.contentWidth, height = sprite.contentHeight;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({
        x: copy.centerX + x * width / 2 * cosine - y * height / 2 * sine,
        y: copy.centerY + x * width / 2 * sine + y * height / 2 * cosine,
    }));
    return { centerX: copy.centerX, centerY: copy.centerY, width, height, rotation, corners };
}

// Editor outlines use content bounds, rather than the large transparent square
// reserved for a spinning sprite. Copy placement matches drawing pixel for pixel.
export function layerSelectionGeometry(layer, settings, time, period, dimensions = settings) {
    const sprite = drawableSprite(layer, settings, dimensions);
    if (!sprite)
        return [];
    return spriteCopies(layer, sprite, dimensions, time, period)
        .map(copy => selectionCopy(layer, sprite, copy, time, period))
        .filter(copy => Math.max(...copy.corners.map(point => point.x)) > 0 && Math.min(...copy.corners.map(point => point.x)) < dimensions.width
            && Math.max(...copy.corners.map(point => point.y)) > 0 && Math.min(...copy.corners.map(point => point.y)) < dimensions.height);
}

// At a paused animation phase, changing an angled path's anchor can also change
// its travel distance. Solve the anchor from the desired displayed position so
// the painted layer follows the pointer without changing its animation.
export function layerDragPosition(layer, settings, time, period, deltaX, deltaY, dimensions = settings) {
    const direct = { x: Math.max(0, Math.min(100, layer.x + deltaX / dimensions.width * 100)),
        y: Math.max(0, Math.min(100, layer.y + deltaY / dimensions.height * 100)) };
    if (!['along-angle', 'against-angle'].includes(layer.motion) || !(period > 0) || !Number.isFinite(time) || deltaX === 0 && deltaY === 0)
        return direct;
    const sprite = drawableSprite(layer, settings, dimensions);
    if (!sprite)
        return direct;
    const initial = layerPosition(layer, dimensions.width, dimensions.height, time, period, sprite);
    const target = { x: initial.x + deltaX, y: initial.y + deltaY };
    const trajectory = angleTrajectory({ ...layer, x: target.x / dimensions.width * 100, y: target.y / dimensions.height * 100 },
        dimensions.width, dimensions.height, sprite.width, sprite.height);
    if (!trajectory)
        return direct;
    const progress = animationProgress(time, period, animationCycles(layer, 'motion'));
    const candidates = [direct];
    for (const wrap of [0, 1]) {
        const displacement = trajectory.distance * (progress - wrap);
        candidates.push({
            x: Math.max(0, Math.min(100, (target.x - trajectory.dx * displacement) / dimensions.width * 100)),
            y: Math.max(0, Math.min(100, (target.y - trajectory.dy * displacement) / dimensions.height * 100)),
        });
    }
    let nearest = direct, bestDistance = Infinity;
    for (const candidate of candidates) {
        const displayed = layerPosition({ ...layer, ...candidate }, dimensions.width, dimensions.height, time, period, sprite);
        const distance = (displayed.x - target.x) ** 2 + (displayed.y - target.y) ** 2;
        if (distance < bestDistance) {
            nearest = candidate;
            bestDistance = distance;
        }
    }
    return nearest;
}

// Hit the actual painted pixel in the topmost visible copy. Transparent image
// areas, text gaps, and the empty padding around spinning layers pass through.
export function hitTestLayers(layers, settings, time, period, x, y, dimensions = settings) {
    if (!(x >= 0 && x < dimensions.width && y >= 0 && y < dimensions.height))
        return null;
    for (let index = (layers || []).length - 1; index >= 0; index--) {
        const layer = layers[index], sprite = drawableSprite(layer, settings, dimensions);
        if (!sprite)
            continue;
        const copies = spriteCopies(layer, sprite, dimensions, time, period);
        for (let copyIndex = copies.length - 1; copyIndex >= 0; copyIndex--) {
            const copy = copies[copyIndex];
            let pixelX = x - copy.left, pixelY = y - copy.top;
            if (spinsLayer(layer)) {
                const radians = layerRotation(layer, time, period) * Math.PI / 180;
                const dx = x - copy.centerX, dy = y - copy.centerY;
                pixelX = dx * Math.cos(radians) + dy * Math.sin(radians) + sprite.width / 2;
                pixelY = -dx * Math.sin(radians) + dy * Math.cos(radians) + sprite.height / 2;
            }
            if (!(pixelX >= 0 && pixelX < sprite.width && pixelY >= 0 && pixelY < sprite.height))
                continue;
            try {
                if (sprite.surface.getContext('2d').getImageData(Math.floor(pixelX), Math.floor(pixelY), 1, 1).data[3] > 0)
                    return { layer, copy: selectionCopy(layer, sprite, copy, time, period) };
            }
            catch { /* A sprite without readable pixels cannot be selected. */ }
        }
    }
    return null;
}

export function drawLayers(ctx, layers, settings, time, period) {
    const dimensions = { width: ctx.canvas.width, height: ctx.canvas.height };
    for (const layer of layers || []) {
        const sprite = drawableSprite(layer, settings, dimensions);
        if (!sprite)
            continue;
        for (const { left, top } of spriteCopies(layer, sprite, dimensions, time, period)) {
            if (spinsLayer(layer)) {
                ctx.save();
                ctx.translate(left + sprite.width / 2, top + sprite.height / 2);
                ctx.rotate(layerRotation(layer, time, period) * Math.PI / 180);
                ctx.drawImage(sprite.surface, -sprite.width / 2, -sprite.height / 2);
                ctx.restore();
            }
            else
                ctx.drawImage(sprite.surface, left, top);
        }
    }
}

async function pngBytes(surface) {
    const blob = typeof surface.convertToBlob === 'function' ? await surface.convertToBlob({ type: 'image/png' }) : await new Promise((resolve, reject) => surface.toBlob(value => value ? resolve(value) : reject(new Error('The layer image could not be created.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}

export async function rasterizeLayers(layers, settings, originalDimensions = settings) {
    let issues = validateLayers(layers, originalDimensions);
    if (issues.length)
        throw new Error(issues[0]);
    await Promise.all(layers.filter(layer => layer.type === 'text' && layer.visible && layer.opacity !== 0).map(layer => loadFont(layer.fontFamily)));
    // Font metrics become authoritative only after the selected face loads.
    issues = validateLayers(layers, originalDimensions);
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
