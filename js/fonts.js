// Fonts stay available for the current editing session, including undo history.
const MAX_FONT_BYTES = 20 * 1024 ** 2;
const registry = new Map();
const deviceEntries = new Map();
const uploadedEntries = [];
const pendingUploads = [];
let sequence = 0;
let generation = 0;
let discovery;

const genericFonts = [
    ['sans-serif', 'Sans serif'], ['serif', 'Serif'], ['monospace', 'Monospace'],
    ['cursive', 'Cursive'], ['fantasy', 'Fantasy'], ['system-ui', 'System UI'],
];
const bundledFonts = [
    ['inter', 'Inter'], ['noto-serif', 'Noto Serif'], ['roboto-mono', 'Roboto Mono'],
    ['oswald', 'Oswald'], ['lobster', 'Lobster'], ['pacifico', 'Pacifico'],
];

function quoteCSS(value) {
    return `"${String(value).replace(/[\\"\x00-\x1f\x7f]/g, character => `\\${character.codePointAt(0).toString(16)} `)}"`;
}

function entry(id, label, source, fontSource) {
    return {
        option: Object.freeze({ id, label, source }),
        family: source === 'generic' ? id : `PerfectLoopFont${++sequence}`,
        fontSource,
        ready: source === 'generic',
        face: undefined,
        pending: undefined,
    };
}

for (const [id, label] of genericFonts)
    registry.set(id, entry(id, label, 'generic'));
for (const [slug, label] of bundledFonts) {
    const url = new URL(`../vendor/fonts/${slug}.ttf`, import.meta.url).href;
    const id = `bundled-${slug}`;
    registry.set(id, entry(id, label, 'bundled', `url(${quoteCSS(url)})`));
}

export function fontOptions() {
    const defaults = [...registry.values()].filter(item => ['generic', 'bundled'].includes(item.option.source));
    const additions = [...registry.values()].filter(item => !['generic', 'bundled'].includes(item.option.source));
    additions.sort((a, b) => a.option.label.localeCompare(b.option.label) || a.option.id.localeCompare(b.option.id));
    return [...defaults, ...additions].map(item => item.option);
}

export function isFontAvailable(id) {
    return registry.has(id);
}

export function fontFamilyCSS(id) {
    const item = registry.get(id);
    if (!item)
        throw new Error('This font is unavailable. Choose another font or import it again.');
    return item.option.source === 'generic' ? item.family : quoteCSS(item.family);
}

export function isFontReady(id) {
    return registry.get(id)?.ready === true;
}

function fontLoadingSupported() {
    if (typeof globalThis.FontFace !== 'function' || !globalThis.document?.fonts?.add)
        throw new Error('This browser cannot load custom fonts. Choose a system font or use a browser with font loading support.');
}

function loadError(item) {
    if (item.option.source === 'device')
        return new Error(`The device font “${item.option.label}” could not be loaded. Import its font file or choose another font.`);
    return new Error(`The font “${item.option.label}” could not be loaded. Try again or choose another font.`);
}

export function loadFont(id) {
    const item = registry.get(id);
    if (!item)
        return Promise.reject(new Error('This font is unavailable. Choose another font or import it again.'));
    if (item.ready)
        return Promise.resolve(item.option);
    if (item.pending)
        return item.pending;
    const currentGeneration = generation;
    const promise = (async () => {
        fontLoadingSupported();
        let face;
        try {
            face = await new FontFace(item.family, item.fontSource).load();
        }
        catch {
            throw loadError(item);
        }
        if (generation !== currentGeneration || registry.get(id) !== item)
            throw new Error('Font loading was cancelled.');
        document.fonts.add(face);
        item.face = face;
        item.ready = true;
        return item.option;
    })().finally(() => {
        if (item.pending === promise)
            item.pending = undefined;
    });
    item.pending = promise;
    return promise;
}

function sameBytes(first, second) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}

function uniqueUploadedLabel(base) {
    const labels = new Set([...registry.values()].filter(item => item.option.source === 'uploaded').map(item => item.option.label));
    let label = base, suffix = 2;
    while (labels.has(label))
        label = `${base} (${suffix++})`;
    return label;
}

export async function importFontFile(file) {
    if (!file || !/\.(ttf|otf|woff2?)$/i.test(file.name || '') || typeof file.arrayBuffer !== 'function')
        throw new Error('Choose a TTF, OTF, WOFF, or WOFF2 font file.');
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_FONT_BYTES)
        throw new Error('Choose a non-empty font file no larger than 20 MB.');
    fontLoadingSupported();
    const currentGeneration = generation;
    let bytes;
    try {
        bytes = new Uint8Array(await file.arrayBuffer());
    }
    catch {
        throw new Error('This font file could not be read. Choose the file again.');
    }
    if (!bytes.length || bytes.length > MAX_FONT_BYTES)
        throw new Error('Choose a non-empty font file no larger than 20 MB.');
    if (generation !== currentGeneration)
        throw new Error('Font loading was cancelled.');
    const existing = uploadedEntries.find(item => sameBytes(item.bytes, bytes));
    if (existing)
        return existing.option;
    const pending = pendingUploads.find(item => sameBytes(item.bytes, bytes));
    if (pending)
        return pending.promise;
    const id = `uploaded-${++sequence}`;
    const label = file.name.replace(/\.(ttf|otf|woff2?)$/i, '') || 'Uploaded font';
    const item = entry(id, label, 'uploaded');
    const upload = { bytes, promise: undefined };
    upload.promise = (async () => {
        let face;
        try {
            face = await new FontFace(item.family, bytes.buffer).load();
        }
        catch {
            throw new Error('This font file could not be loaded. Choose a valid TTF, OTF, WOFF, or WOFF2 file.');
        }
        if (generation !== currentGeneration)
            throw new Error('Font loading was cancelled.');
        document.fonts.add(face);
        item.face = face;
        item.ready = true;
        // Allocate the display name after decoding, so simultaneous uploads
        // with different contents and the same filename stay distinguishable.
        item.option = Object.freeze({ ...item.option, label: uniqueUploadedLabel(label) });
        registry.set(id, item);
        uploadedEntries.push({ bytes, option: item.option });
        return item.option;
    })().finally(() => {
        const index = pendingUploads.indexOf(upload);
        if (index >= 0)
            pendingUploads.splice(index, 1);
    });
    pendingUploads.push(upload);
    return upload.promise;
}

export function deviceFontsSupported() {
    return globalThis.isSecureContext === true && typeof globalThis.queryLocalFonts === 'function';
}

function deviceFontError(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError')
        return new Error('Access to device fonts was not allowed. Allow font access in your browser or import a font file instead.');
    return new Error('Device fonts could not be read. Try again or import a font file instead.');
}

export function discoverDeviceFonts() {
    if (!deviceFontsSupported())
        return Promise.reject(new Error('This browser cannot list device fonts. Use a supported browser on HTTPS or import a font file instead.'));
    if (discovery)
        return discovery;
    // Call the permission-gated API immediately, before any asynchronous work,
    // so the browser still sees the user's button click as the activation.
    let request;
    try {
        request = globalThis.queryLocalFonts();
    }
    catch (error) {
        return Promise.reject(deviceFontError(error));
    }
    const currentGeneration = generation;
    const promise = Promise.resolve(request).then(async metadata => {
        if (generation !== currentGeneration)
            throw new Error('Font discovery was cancelled.');
        if (!Array.isArray(metadata))
            throw new Error('The browser returned an invalid device font list.');
        if (!metadata.length && globalThis.navigator?.permissions?.query) {
            let permission;
            try {
                permission = await navigator.permissions.query({ name: 'local-fonts' });
            }
            catch { /* Some browsers expose discovery without this permission query. */ }
            if (permission?.state === 'denied')
                throw Object.assign(new Error('Device font access was denied.'), { name: 'NotAllowedError' });
            if (generation !== currentGeneration)
                throw new Error('Font discovery was cancelled.');
        }
        const options = [];
        const seen = new Set();
        for (const font of metadata) {
            const postscriptName = typeof font?.postscriptName === 'string' ? font.postscriptName.trim() : '';
            const fullName = typeof font?.fullName === 'string' ? font.fullName.trim() : '';
            if (!postscriptName || !fullName)
                continue;
            const key = JSON.stringify([postscriptName, fullName]);
            if (seen.has(key))
                continue;
            seen.add(key);
            let item = deviceEntries.get(key);
            if (!item) {
                const id = `device-${++sequence}`;
                item = entry(id, fullName, 'device', `local(${quoteCSS(postscriptName)}), local(${quoteCSS(fullName)})`);
                deviceEntries.set(key, item);
                registry.set(id, item);
            }
            options.push(item.option);
        }
        return options.sort((first, second) => first.label.localeCompare(second.label) || first.id.localeCompare(second.id));
    }).catch(error => {
        if (generation !== currentGeneration)
            throw new Error('Font discovery was cancelled.');
        throw deviceFontError(error);
    }).finally(() => {
        if (discovery === promise)
            discovery = undefined;
    });
    discovery = promise;
    return promise;
}

export function clearFonts() {
    generation++;
    for (const [id, item] of registry) {
        if (item.face)
            globalThis.document?.fonts?.delete?.(item.face);
        if (['generic', 'bundled'].includes(item.option.source)) {
            item.face = undefined;
            item.ready = item.option.source === 'generic';
            item.pending = undefined;
        }
        else
            registry.delete(id);
    }
    deviceEntries.clear();
    uploadedEntries.length = 0;
    pendingUploads.length = 0;
    discovery = undefined;
}
