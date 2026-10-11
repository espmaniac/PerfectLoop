import test from 'node:test';
import assert from 'node:assert/strict';
import { patchCapturePlan, patchSamples, patchFade, MAX_PATCH_BYTES } from '../js/video-patch.js';
import { layerOverlayGraph } from '../js/layer-export.js';
import { DEFAULTS } from '../js/constants.js';

test('Donor capture stays inside the fragment and budgets all retained patch assets', () => {
    const plan = patchCapturePlan(40, 42, 60, 60, 100, 50);
    assert.equal(patchCapturePlan(.9, 1, 1, 30, 10, 10).count, 3);
    assert.equal(plan.count, 60);
    assert.equal(plan.times[0], 40);
    assert.ok(plan.times.at(-1) < 42);
    assert.equal(plan.bytes, 1200000);
    for (const [start, end] of [[-1, 2], [2, 1], [0, 9], [59, 61], [0, NaN]])
        assert.throws(() => patchCapturePlan(start, end, 60, 30, 100, 50));
    assert.throws(() => patchCapturePlan(0, 2, 3, 30, 100, 50, MAX_PATCH_BYTES));
});

test('Patch blend preserves alpha and joins forward motion continuously across the seam', () => {
    const layer = { startTime: 1, endTime: 4, seamBlend: 20 };
    const vector = time => {
        const values = new Array(60).fill(0);
        for (const { index, weight } of patchSamples(layer, time, 5, 60)) {
            assert.ok(index >= 0 && index < 60 && weight >= 0);
            values[index] += weight;
        }
        assert.ok(Math.abs(values.reduce((a,b)=>a+b)-1) < 1e-9);
        return values;
    };
    assert.deepEqual(vector(1), vector(6));
    for (const t of [1, 1.5, 2.7, 3.9]) {
        const a = vector(t), b = vector(t+5);
        assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-10));
    }
    const a=vector(1), b=vector(4-1e-8);
    assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-6));
    const first = patchSamples({seamBlend:0},0,2,60);
    assert.deepEqual(first,[{index:0,weight:1}]);
    assert.deepEqual(patchSamples({seamBlend:0},1,2,60),[{index:30,weight:1}]);
});

test('Patch fades are bounded by the active interval and repeat with finished-loop time', () => {
    const layer={startTime:1,endTime:3,fadeIn:.5,fadeOut:.5};
    for(const [time,alpha] of [[0,0],[1,0],[1.25,.5],[1.5,1],[2,1],[2.75,.5],[3,0],[5.25,.5]])
        assert.equal(patchFade(layer,time,4),alpha);
    assert.equal(patchFade({...layer,fadeIn:60,fadeOut:60},2,4),1);
    assert.equal(patchFade({},0,4),1);
    assert.equal(patchFade({startTime:5},1,4),0);
});

test('Animated overlay inputs use timed PNG sequences while static layers remain looped stills', () => {
    const settings={...DEFAULTS,method:'natural',start:0,end:2};
    const layer={x:50,y:50,rotation:0,motion:'none',opacity:100};
    const result=layerOverlayGraph(settings,[{layer,width:40,height:40,animated:true},{layer,width:40,height:40}]);
    assert.deepEqual(result.inputs,['-framerate',String(settings.fps),'-i','layer-0-%06d.png','-loop','1','-framerate',String(settings.fps),'-i','layer-1.png']);
    assert.match(result.graph,/shortest=1/);
});
