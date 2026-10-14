import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoPreview } from '../js/auto-preview.js';
function fixture() {
    let next=0; const timers=new Map(), renders=[];
    const queue=new AutoPreview(key=>renders.push(key), {
        setTimer: callback=>{ timers.set(++next,callback); return next; },
        clearTimer: id=>timers.delete(id),
    });
    return { queue, renders, flush:()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());}, timers };
}
test('Rapid edits generate only the latest complete revision',()=>{
    const f=fixture();f.queue.sync('six-seconds',true);f.queue.sync('eight-seconds',true);
    f.queue.sync('eight-seconds',true);assert.equal(f.timers.size,1);
    f.flush();assert.deepEqual(f.renders,['eight-seconds']);
});
test('Cancellation or failure does not repeatedly render the same revision',()=>{
    const f=fixture();f.queue.sync('clip',true);f.flush();f.queue.sync('clip',true);f.flush();
    assert.deepEqual(f.renders,['clip']);
    f.queue.retry();f.queue.sync('clip',true);f.flush();assert.deepEqual(f.renders,['clip','clip']);
});
test('Original, search, editing gestures and other jobs suspend queued work',()=>{
    const f=fixture();f.queue.sync('clip',true);f.queue.sync('clip',false);f.flush();assert.equal(f.renders.length,0);
    f.queue.sync('clip',true);f.flush();assert.deepEqual(f.renders,['clip']);
});
test('A new source and a new edit can render after a cancelled revision',()=>{
    const f=fixture();for(const key of ['source-a:1','source-a:2','source-b:2']) {f.queue.sync(key,true);f.flush();}
    assert.equal(f.renders.length,3);
});
