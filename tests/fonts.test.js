import test from 'node:test';
import assert from 'node:assert/strict';
import { fontOptions, isFontAvailable, fontFamilyCSS, isFontReady, loadFont, importFontFile, discoverDeviceFonts, deviceFontsSupported, clearFonts } from '../js/fonts.js';

const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const file = (name, bytes = [1, 2, 3, 4]) => ({ name, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
const optionId = result => typeof result === 'string' ? result : result.id;

async function browser(run) {
    const names = ['FontFace', 'document', 'queryLocalFonts', 'isSecureContext', 'navigator'];
    const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const faces = [], loads = [], installed = new Set(), controls = { load: () => Promise.resolve() };
    const external = { family: 'External page font' };
    installed.add(external);
    class Face {
        constructor(family, source) {
            this.family = family;
            this.source = source;
            this.status = 'unloaded';
            faces.push(this);
        }
        load() {
            this.status = 'loading';
            loads.push(this);
            return Promise.resolve().then(() => controls.load(this)).then(() => {
                this.status = 'loaded';
                return this;
            }, error => {
                this.status = 'error';
                throw error;
            });
        }
    }
    for (const [name, value] of Object.entries({ FontFace: Face, document: { fonts: { add: face => { installed.add(face); }, delete: face => installed.delete(face), check: () => true, ready: Promise.resolve() } }, queryLocalFonts: undefined, isSecureContext: true, navigator: {} }))
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    clearFonts();
    try {
        await run({ faces, loads, installed, external, controls });
    }
    finally {
        clearFonts();
        for (const name of names) {
            if (previous.get(name))
                Object.defineProperty(globalThis, name, previous.get(name));
            else
                delete globalThis[name];
        }
    }
}

test('Generic fonts remain available to older layers while named bundled fonts require decoding', async () => {
    await browser(async () => {
        for (const id of ['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy']) {
            assert.ok(isFontAvailable(id));
            assert.ok(isFontReady(id));
            await loadFont(id);
            assert.ok(fontFamilyCSS(id).length > 0);
        }
        const bundled = fontOptions().filter(option => option.source === 'bundled');
        assert.equal(bundled.length, 6);
        for (const option of bundled) {
            assert.ok(isFontAvailable(option.id));
            assert.equal(isFontReady(option.id), false, 'A browser fallback check does not make an undecoded font ready');
        }
        assert.equal(isFontAvailable('missing-font'), false);
        assert.equal(isFontReady('missing-font'), false);
        assert.throws(() => fontFamilyCSS('missing-font'));
        await assert.rejects(loadFont('missing-font'));
    });
});

test('Bundled font requests share decoding, publish readiness only after loading, and allow a failed load to retry', async () => {
    await browser(async ({ faces, loads, installed, controls }) => {
        const id = fontOptions().find(option => option.source === 'bundled').id;
        const gate = deferred(), started = deferred();
        controls.load = face => { started.resolve(face); return gate.promise; };
        const first = loadFont(id), second = loadFont(id);
        const face = await started.promise;
        assert.equal(faces.length, 1);
        assert.equal(loads.length, 1);
        assert.equal(isFontReady(id), false);
        assert.equal(installed.has(face), false, 'Pending fonts cannot be used by canvas');
        gate.resolve();
        await Promise.all([first, second]);
        assert.ok(installed.has(face));
        assert.ok(isFontReady(id));
        await loadFont(id);
        assert.equal(loads.length, 1, 'A loaded font is reused');

        const retryId = fontOptions().filter(option => option.source === 'bundled')[1].id;
        controls.load = () => Promise.reject(new SyntaxError('Corrupt font bytes'));
        await assert.rejects(loadFont(retryId));
        assert.equal(isFontReady(retryId), false);
        controls.load = () => Promise.resolve();
        await loadFont(retryId);
        assert.ok(isFontReady(retryId), 'Transient failures do not permanently cache fallback readiness');
    });
});

test('Concurrent uploads deduplicate identical bytes after decoding and use safe CSS family aliases', async () => {
    await browser(async ({ faces, controls }) => {
        const gate = deferred(), started = deferred();
        controls.load = face => { started.resolve(face); return gate.promise; };
        const first = importFontFile(file('Display"; serif; url(example).TTF'));
        const second = importFontFile(file('Same font with another name.woff2'));
        const face = await started.promise;
        assert.equal(faces.length, 1, 'The same bytes share one decode even while requests overlap');
        assert.equal(fontOptions().filter(option => option.source === 'uploaded').length, 0, 'Pending uploads do not replace the available font catalog');
        gate.resolve();
        const [a, b] = await Promise.all([first, second]);
        const id = optionId(a);
        assert.equal(optionId(b), id);
        assert.ok(isFontAvailable(id) && isFontReady(id));
        assert.equal(fontOptions().filter(option => option.source === 'uploaded').length, 1);
        assert.match(face.family, /^[a-z0-9_-]+$/i);
        const css = fontFamilyCSS(id);
        assert.ok(css.includes(face.family));
        assert.equal(/serif;|url\(/i.test(css), false, 'Display names are never inserted as CSS family declarations');
        assert.equal(optionId(await importFontFile(file('Duplicate.otf'))), id);
        assert.equal(faces.length, 1, 'Later imports reuse the retained font for undoable layers');
        controls.load = () => Promise.resolve();
        assert.notEqual(optionId(await importFontFile(file('Duplicate.otf', [4, 3, 2, 1]))), id, 'Different bytes remain distinct even when the filename matches');
    });
});

test('Different uploaded fonts with the same basename remain distinguishable and exact duplicates retain their labels', async () => {
    await browser(async () => {
        const [first, second] = await Promise.all([
            importFontFile(file('Brand Display.TTF', [7, 7, 1])),
            importFontFile(file('Brand Display.woff2', [7, 7, 2])),
        ]);
        assert.notEqual(first.id, second.id);
        assert.notEqual(first.label, second.label, 'Selectable labels distinguish different font bytes');
        assert.notEqual(fontFamilyCSS(first.id), fontFamilyCSS(second.id));
        assert.ok(isFontReady(first.id) && isFontReady(second.id));
        const duplicate = await importFontFile(file('Brand Display.otf', [7, 7, 1]));
        assert.deepEqual(duplicate, first);
        assert.equal(fontOptions().filter(option => option.source === 'uploaded').length, 2);
    });
});

test('Rejected font files and unavailable decoding leave existing fonts and catalog intact', async () => {
    await browser(async ({ controls }) => {
        const selected = optionId(await importFontFile(file('Keep.woff')));
        const catalog = fontOptions(), css = fontFamilyCSS(selected);
        let reads = 0;
        for (const invalid of [
            { name: 'not-a-font.svg', size: 4, arrayBuffer: async () => { reads++; return new ArrayBuffer(4); } },
            { name: 'too-large.ttf', size: 21 * 1024 ** 2, arrayBuffer: async () => { reads++; return new ArrayBuffer(4); } },
        ])
            await assert.rejects(importFontFile(invalid));
        assert.equal(reads, 0, 'Unsupported and oversized files are rejected before reading bytes');
        controls.load = () => Promise.reject(new SyntaxError('Invalid font data'));
        await assert.rejects(importFontFile(file('Broken.otf', [9, 8, 7, 6])));
        await assert.rejects(importFontFile({ name: 'Unreadable.woff2', size: 4, arrayBuffer: async () => { throw new Error('Read failed'); } }));
        const decoder = globalThis.FontFace;
        globalThis.FontFace = undefined;
        await assert.rejects(importFontFile(file('Unsupported.ttf', [8, 8, 8, 8])));
        globalThis.FontFace = decoder;
        assert.deepEqual(fontOptions(), catalog);
        assert.ok(isFontReady(selected));
        assert.equal(fontFamilyCSS(selected), css);
    });
});

test('Device font access preserves click activation, registers every face lazily, and safely isolates names from CSS', async () => {
    await browser(async ({ faces }) => {
        let activated = true, queries = 0;
        const metadata = [
            { family: 'Family', fullName: 'Family Regular', postscriptName: 'Family-Regular' },
            { family: 'Family', fullName: 'Family Bold', postscriptName: 'Family-Bold' },
            { family: 'A"; serif; url(example)', fullName: 'A"; serif; url(example)', postscriptName: 'Odd"Name\\Face' },
        ];
        globalThis.queryLocalFonts = () => {
            assert.equal(activated, true, 'The API is called before the click task loses activation');
            queries++;
            return Promise.resolve(metadata);
        };
        assert.ok(deviceFontsSupported());
        const pending = discoverDeviceFonts();
        assert.equal(queries, 1, 'Font discovery invokes the browser API synchronously');
        activated = false;
        await pending;
        const options = fontOptions().filter(option => option.source === 'device');
        assert.equal(options.length, 3, 'Distinct styles from the same family remain selectable');
        assert.equal(faces.length, 0, 'Listing fonts does not eagerly decode every installed face');
        for (const option of options) {
            assert.ok(isFontAvailable(option.id));
            assert.equal(isFontReady(option.id), false);
        }
        await loadFont(options[2].id);
        assert.equal(faces.length, 1);
        assert.match(faces[0].family, /^[a-z0-9_-]+$/i);
        assert.equal(/serif;|url\(/i.test(fontFamilyCSS(options[2].id)), false);
        activated = true;
        await discoverDeviceFonts();
        assert.equal(fontOptions().filter(option => option.source === 'device').length, 3, 'Repeated discovery does not duplicate faces');
    });
});

test('Unsupported, insecure or denied device font access leaves the catalog unchanged', async () => {
    await browser(async () => {
        const catalog = fontOptions();
        assert.equal(deviceFontsSupported(), false);
        await assert.rejects(discoverDeviceFonts());
        globalThis.queryLocalFonts = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        globalThis.isSecureContext = false;
        assert.equal(deviceFontsSupported(), false);
        await assert.rejects(discoverDeviceFonts());
        globalThis.isSecureContext = true;
        assert.ok(deviceFontsSupported());
        await assert.rejects(discoverDeviceFonts());
        globalThis.queryLocalFonts = () => Promise.resolve({ fonts: [] });
        await assert.rejects(discoverDeviceFonts());
        assert.deepEqual(fontOptions(), catalog);
    });
});

test('Clearing fonts cancels pending imports without registering stale faces or deleting page-owned fonts', async () => {
    await browser(async ({ controls, installed, external }) => {
        const gate = deferred(), started = deferred();
        controls.load = face => { started.resolve(face); return gate.promise; };
        const pending = importFontFile(file('Pending.ttf'));
        const rejected = assert.rejects(pending);
        const face = await started.promise;
        clearFonts();
        gate.resolve();
        await rejected;
        assert.equal(fontOptions().filter(option => option.source === 'uploaded').length, 0);
        assert.equal(installed.has(face), false, 'A completed stale decode is not installed');
        assert.ok(installed.has(external), 'Fonts owned by the containing page survive registry cleanup');
        assert.ok(isFontReady('sans-serif'));
    });
});

test('An empty device font list distinguishes denied permission from an allowed empty catalog', async () => {
    await browser(async () => {
        const catalog = fontOptions();
        globalThis.queryLocalFonts = () => Promise.resolve([]);
        globalThis.navigator.permissions = { query: async options => {
            assert.equal(options.name, 'local-fonts');
            return { state: 'denied' };
        } };
        await assert.rejects(discoverDeviceFonts(), /not allowed|allow font access/i);
        assert.deepEqual(fontOptions(), catalog);
        globalThis.navigator.permissions.query = async () => ({ state: 'granted' });
        assert.deepEqual(await discoverDeviceFonts(), []);
        globalThis.navigator.permissions.query = async () => { throw new TypeError('Unsupported permission name'); };
        assert.deepEqual(await discoverDeviceFonts(), [], 'Discovery still works when the optional permission query is unsupported');
    });
});

test('Finishing cancelled work cannot clear the replacement load or discovery request', async () => {
    await browser(async ({ controls, faces, installed }) => {
        const id = fontOptions().find(option => option.source === 'bundled').id;
        const oldGate = deferred(), freshGate = deferred(), oldStarted = deferred(), freshStarted = deferred();
        let loads = 0;
        controls.load = face => {
            loads++;
            if (loads === 1) {
                oldStarted.resolve(face);
                return oldGate.promise;
            }
            freshStarted.resolve(face);
            return freshGate.promise;
        };
        const old = loadFont(id), rejected = assert.rejects(old);
        const oldFace = await oldStarted.promise;
        clearFonts();
        const fresh = loadFont(id);
        const freshFace = await freshStarted.promise;
        oldGate.resolve();
        await rejected;
        const joined = loadFont(id);
        assert.equal(faces.length, 2, 'The new pending load still receives coalesced requests');
        freshGate.resolve();
        await Promise.all([fresh, joined]);
        assert.ok(isFontReady(id) && installed.has(freshFace));
        assert.equal(installed.has(oldFace), false);

        const oldQuery = deferred(), freshQuery = deferred();
        let queries = 0;
        globalThis.queryLocalFonts = () => ++queries === 1 ? oldQuery.promise : freshQuery.promise;
        const firstDiscovery = discoverDeviceFonts(), discarded = assert.rejects(firstDiscovery);
        clearFonts();
        const replacement = discoverDeviceFonts();
        oldQuery.resolve([{ fullName: 'Discarded Face', postscriptName: 'Discarded-Face' }]);
        await discarded;
        const shared = discoverDeviceFonts();
        assert.equal(queries, 2, 'The replacement discovery remains pending after old cleanup');
        freshQuery.resolve([{ fullName: 'Retained Face', postscriptName: 'Retained-Face' }]);
        await Promise.all([replacement, shared]);
        assert.deepEqual(fontOptions().filter(option => option.source === 'device').map(option => option.label), ['Retained Face']);
    });
});
