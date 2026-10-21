import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { VideoEngine } from '../js/engine.js';

function fixture() {
    const engine = new VideoEngine(), callbacks = {};
    const worker = { loaded: false, terminate() { this.terminated = true; }, on: (event, callback) => { callbacks[event] = callback; },
        async load() { this.loaded = true; } };
    engine.ff = worker; engine.listeners();
    engine.assets = { async load() { return {}; }, invalidateScripts() {} };
    return { engine, worker, callbacks };
}

test('Cancel aborts the first download; a new load starts without the old promise clearing it', async () => {
    const { engine, worker } = fixture();
    let firstSignal, releaseSecond;
    engine.assets.load = (_, { signal }) => { firstSignal = signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); };
    const first = assert.rejects(engine.load(() => {}), { name: 'AbortError' });
    await flush(); engine.cancel(); assert(firstSignal.aborted); assert(worker.terminated);
    engine.cancelled = false;
    engine.assets.load = () => new Promise(resolve => { releaseSecond = resolve; });
    const fresh = engine.ff; fresh.load = async () => { fresh.loaded = true; };
    const second = engine.load(() => {}); await first; await flush();
    assert(engine.loading); releaseSecond({}); await second;
    assert(fresh.loaded); assert(engine.everLoaded); assert.equal(engine.loading, undefined);
});

test('Concurrent callers share startup and a failed startup gets a fresh worker for retry', async () => {
    const { engine, worker } = fixture();
    let loads = 0, invalidated = 0;
    engine.assets.load = async () => { loads++; return {}; };
    engine.assets.invalidateScripts = () => invalidated++;
    worker.load = async () => { throw new Error('Module download failed'); };
    const first = engine.load(() => {}), second = engine.load(() => {});
    await Promise.all([assert.rejects(first, /Module download failed/), assert.rejects(second, /Module download failed/)]);
    assert.equal(loads, 1); assert.equal(invalidated, 1); assert(worker.terminated);
    assert.notEqual(engine.ff, worker); assert.equal(engine.loading, undefined);
    engine.ff.load = async () => { engine.ff.loaded = true; };
    await engine.load(() => {}); assert(engine.ff.loaded); assert.equal(loads, 2);
});

test('A silent worker startup times out, terminates, and releases the loading state', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { engine, worker } = fixture(); worker.load = () => new Promise(() => {});
    const pending = assert.rejects(engine.load(() => {}), /stopped responding/);
    await flush(); t.mock.timers.tick(60_000); await pending;
    assert(worker.terminated); assert.equal(engine.loading, undefined);
});

test('Selected-frame processing fails cleanly when a worker goes silent', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { engine, worker } = fixture(); worker.exec = () => new Promise(() => {});
    const pending = assert.rejects(engine.exec([], 8, 0.04, 0.35, 'Preparing the selected frames…', () => {}), /stopped responding/);
    await flush(); engine.logs.push('Input #0: sample.mp4'); t.mock.timers.tick(120_000); await pending;
    assert(worker.terminated); assert.equal(engine.heartbeat, undefined);
});

test('Logs and frame progress keep a genuinely busy worker alive', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { engine, callbacks } = fixture(); let done;
    const pending = engine.workerCall(() => new Promise(resolve => { done = resolve; }), 'Processing', 100);
    await flush(); t.mock.timers.tick(90); callbacks.log({ message: 'Decoding' });
    t.mock.timers.tick(90); callbacks.progress({ time: 1000 });
    t.mock.timers.tick(90); done(0); assert.equal(await pending, 0);
    assert.equal(engine.heartbeat, undefined);
});

test('Cleanup after a worker crash discards mount state before the next filesystem is created', async () => {
    const { engine, worker } = fixture(); engine.mounted = true;
    await engine.cleanup();
    assert.equal(engine.mounted, false); assert.notEqual(engine.ff, worker); assert(worker.terminated);
});

test('Engine download display uses its own percent while render progress stays weighted', async () => {
    const { engine } = fixture(), reports = [];
    engine.assets.load = async (_, { onProgress }) => {
        onProgress(.5, 'Downloading the video engine: 5 of 10 MB…');
        onProgress(1, 'Unpacking the video engine…', { progress: null });
        return {};
    };
    await engine.load((fraction, message, display) => reports.push({ fraction, message, display }));
    const download = reports.find(report => report.message.startsWith('Downloading'));
    assert.equal(download.fraction, .015); assert.equal(download.display.progress, .5);
    assert(reports.filter(report => !report.message.startsWith('Downloading')).every(report => report.display.progress === null));
});
