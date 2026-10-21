import test from 'node:test';
import assert from 'node:assert/strict';
import { FFmpeg } from '../vendor/ffmpeg/index.js';

function fixture(t) {
    const workers = [];
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else delete globalThis.Worker; });
    globalThis.Worker = class {
        constructor() { workers.push(this); }
        postMessage(message) { this.message = message; }
        terminate() { this.terminated = true; }
        reply(type, data = true) { this.onmessage({ data: { id: this.message.id, type, data } }); }
    };
    return { ff: new FFmpeg(), workers };
}

for (const event of ['onerror', 'onmessageerror']) test(`Worker ${event} rejects pending work and the next load starts a new worker`, async t => {
    const { ff, workers } = fixture(t);
    const pending = assert.rejects(ff.load(), /video engine/);
    workers[0][event]({ preventDefault() {} }); await pending;
    assert(workers[0].terminated); assert.equal(ff.loaded, false);
    const retry = ff.load(); assert.equal(workers.length, 2); workers[1].reply('LOAD'); await retry;
    assert(ff.loaded);
    const exec = assert.rejects(ff.exec(['-version']), /video engine/);
    workers[1][event]({ preventDefault() {} }); await exec;
    assert.equal(ff.loaded, false);
});

test('Cancellation cleans up its pending message and tolerates a late worker reply', async t => {
    const { ff, workers } = fixture(t), controller = new AbortController();
    const pending = assert.rejects(ff.load({}, { signal: controller.signal }), { name: 'AbortError' });
    controller.abort(); await pending; assert.doesNotThrow(() => workers[0].reply('LOAD')); assert.equal(ff.loaded, false);
    ff.terminate(); assert.equal(ff.loaded, false);
    assert.doesNotThrow(() => workers[0].reply('LOAD')); assert.equal(ff.loaded, false);
});

test('Synchronous postMessage errors reject without retaining a pending command', async t => {
    const { ff, workers } = fixture(t);
    const loaded = ff.load(); workers[0].reply('LOAD'); await loaded;
    workers[0].postMessage = () => { throw new Error('Could not clone data'); };
    await assert.rejects(ff.exec([]), /Could not clone/); assert.doesNotThrow(() => ff.terminate());
});
