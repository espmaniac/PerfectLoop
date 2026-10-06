import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { prepareVideoFile } from '../js/source-file.js';

test('Unavailable selections explain how to finish a Photos or iCloud download and retry through Files', async () => {
    const help = /Photos or iCloud.*downloading.*Files/;
    await assert.rejects(prepareVideoFile(new File([], 'cloud.mov')), help);
    const unreadable = new File(['video bytes'], 'cloud.mov');
    unreadable.slice = () => ({ arrayBuffer: async () => { throw new DOMException('Not readable', 'NotReadableError'); } });
    await assert.rejects(prepareVideoFile(unreadable), help);
    const emptyRead = new File(['video bytes'], 'cloud.mov');
    emptyRead.slice = () => ({ arrayBuffer: async () => new ArrayBuffer(0) });
    await assert.rejects(prepareVideoFile(emptyRead), help);
    await assert.rejects(prepareVideoFile({ size: 100, name: 'not-a-file.mp4' }), /Choose a video file/);
});

test('Missing and generic container MIME types are repaired without changing source bytes or timestamps', async () => {
    const bytes = Uint8Array.from({ length: 96 }, (_, index) => index);
    const types = [
        ['cloud.MOV', 'application/octet-stream', 'video/quicktime'],
        ['download.mp4', '', 'video/mp4'],
        ['clip.m4v', '', 'video/mp4'],
        ['clip.webm', 'application/octet-stream', 'video/webm'],
        ['clip.mkv', '', 'video/x-matroska'],
        ['clip.avi', '', 'video/x-msvideo'],
    ];
    for (const [name, type, expectedType] of types) {
        const source = new File([bytes], name, { type, lastModified: 123456 });
        const prepared = await prepareVideoFile(source);
        assert.notEqual(prepared, source);
        assert.equal(prepared.type, expectedType);
        assert.equal(prepared.name, source.name);
        assert.equal(prepared.size, source.size);
        assert.equal(prepared.lastModified, source.lastModified);
        assert.deepEqual(new Uint8Array(await prepared.arrayBuffer()), bytes);
        assert.equal(source.type, type, 'The selected File is not modified');
    }
});

test('Specific MIME types and unknown containers keep the selected Blob or File', async () => {
    for (const file of [
        new File(['video'], 'camera.MOV', { type: 'video/quicktime' }),
        new File(['video'], 'camera.mov', { type: 'video/mp4' }),
        new File(['video'], 'camera.mov', { type: 'application/x-custom-container' }),
        new File(['video'], 'unknown.container', { type: 'application/octet-stream' }),
        new Blob(['video']),
    ]) assert.equal(await prepareVideoFile(file), file);
});

test('Checking a large source reads only its first 64 bytes, and MIME normalization does not read the full video', async () => {
    const bytes = new Uint8Array(1024 * 1024);
    bytes[0] = 1; bytes[63] = 2; bytes[bytes.length - 1] = 3;
    const file = new File([bytes], 'large.mov');
    const slice = file.slice.bind(file), reads = [];
    file.arrayBuffer = () => { throw new Error('A full video read must not be needed'); };
    file.slice = (from, to) => { reads.push([from, to]); return slice(from, to); };
    const prepared = await prepareVideoFile(file);
    assert.deepEqual(reads, [[0, 64]]);
    assert.equal(prepared.type, 'video/quicktime');
    assert.equal(prepared.size, bytes.length);
    assert.deepEqual(new Uint8Array(await prepared.arrayBuffer()), bytes);
    const short = new File(['123'], 'short.mov');
    const shortSlice = Blob.prototype.slice.bind(short);
    short.slice = (from, to) => { assert.deepEqual([from, to], [0, 3]); return shortSlice(from, to); };
    assert.equal((await prepareVideoFile(short)).size, 3);
});

test('Cancellation before and during a prefix read remains an AbortError and cannot return a prepared file', async () => {
    const before = new AbortController(); before.abort();
    const file = new File(['video'], 'camera.mov');
    let reads = 0;
    file.slice = () => { reads++; throw new Error('Cancelled selections must not be read'); };
    await assert.rejects(prepareVideoFile(file, before.signal), { name: 'AbortError' });
    assert.equal(reads, 0);

    const during = new AbortController();
    let resolveRead;
    const delayed = new File(['video'], 'cloud.mov');
    delayed.slice = () => ({ arrayBuffer: () => new Promise(resolve => { resolveRead = resolve; }) });
    const pending = prepareVideoFile(delayed, during.signal);
    during.abort();
    resolveRead(new Uint8Array([1]).buffer);
    await assert.rejects(pending, { name: 'AbortError' });

    const abortedRead = new File(['video'], 'cloud.mov');
    const original = new DOMException('Read cancelled', 'AbortError');
    abortedRead.slice = () => ({ arrayBuffer: async () => { throw original; } });
    await assert.rejects(prepareVideoFile(abortedRead), error => error === original);
});

function pendingReadFixture(t) {
    const previous = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    const timers = new Map(), listeners = new Set();
    let nextTimer = 0;
    globalThis.setTimeout = (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; };
    globalThis.clearTimeout = id => timers.delete(id);
    t.after(() => Object.assign(globalThis, previous));
    const controller = new AbortController();
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (event, callback, options) => { listeners.add(callback); add(event, callback, options); };
    controller.signal.removeEventListener = (event, callback) => { listeners.delete(callback); remove(event, callback); };
    let complete, fail;
    const file = new File(['video'], 'cloud.mov');
    file.slice = () => ({ arrayBuffer: () => new Promise((resolve, reject) => { complete = resolve; fail = reject; }) });
    return { file, controller, timers, listeners, complete: value => complete(value), fail: error => fail(error) };
}

test('A stalled Photos read cancels immediately and late completion cannot return a prepared source', async t => {
    const f = pendingReadFixture(t);
    const pending = prepareVideoFile(f.file, f.controller.signal);
    assert.equal(f.timers.size, 1);
    assert.equal(f.listeners.size, 1);
    f.controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
    f.complete(new Uint8Array([1]).buffer);
    await Promise.resolve();
    assert.equal(f.timers.size, 0);
    await assert.rejects(pending, { name: 'AbortError' });
});

test('A stalled Photos read times out with retry help, and timers and listeners are released on every result', async t => {
    const f = pendingReadFixture(t);
    const pending = prepareVideoFile(f.file, f.controller.signal);
    const timer = [...f.timers.values()][0];
    assert.equal(timer.delay, 20_000);
    timer.callback();
    await assert.rejects(pending, error => error.name !== 'AbortError' && /Photos or iCloud.*downloading.*Files/.test(error.message));
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
    f.fail(new Error('A late read failure must not become an unhandled rejection'));
    await Promise.resolve();
    const ready = new File(['video'], 'available.mp4', { type: 'video/mp4' });
    assert.equal(await prepareVideoFile(ready, f.controller.signal), ready);
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
    const failed = new File(['video'], 'failed.mp4');
    failed.slice = () => { throw new Error('Read failed immediately'); };
    await assert.rejects(prepareVideoFile(failed, f.controller.signal), /Photos or iCloud/);
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
});
