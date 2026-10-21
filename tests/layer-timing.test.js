import test from 'node:test';
import assert from 'node:assert/strict';
import {adjustLayerTiming,layerInterval,loopSourceTime} from '../js/layer-timing.js';
import {DEFAULTS} from '../js/constants.js';
import {framePlan} from '../js/logic.js';

const s={...DEFAULTS,preset:'custom',start:10,end:18,fps:24,speed:1,method:'natural',shift:0};
test('Layer intervals use one finished cycle and preserve explicit outside-loop intervals',()=>{
 assert.deepEqual(layerInterval({},8),{start:0,end:8,visible:true});
 assert.deepEqual(layerInterval({startTime:2,endTime:20},8),{start:2,end:8,visible:true});
 assert.deepEqual(layerInterval({startTime:9,endTime:null},8),{start:8,end:8,visible:false});
});
test('Trimming snaps to output frames, keeps one frame, and retains automatic ends',()=>{
 const layer={startTime:2,endTime:null};
 assert.deepEqual(adjustLayerTiming(layer,'start',24,s),{startTime:3});
 assert.deepEqual(adjustLayerTiming(layer,'start',9999,s),{startTime:8-1/24});
 assert.deepEqual(adjustLayerTiming(layer,'end',-48,s),{endTime:6});
 assert.deepEqual(adjustLayerTiming({startTime:2,endTime:6},'end',9999,s),{endTime:null});
 assert.deepEqual(adjustLayerTiming(layer,'end',-9999,s),{endTime:2+1/24});
 assert.equal(adjustLayerTiming(layer,'end',24,s),null);
});
test('Moving keeps the interval length, clamps at both ends, and does not mutate the original',()=>{
 const layer={startTime:2,endTime:5},before=JSON.stringify(layer);
 assert.deepEqual(adjustLayerTiming(layer,'move',24,s),{startTime:3,endTime:6});
 assert.deepEqual(adjustLayerTiming(layer,'move',-999,s),{startTime:0,endTime:3});
 assert.deepEqual(adjustLayerTiming(layer,'move',999,s),{startTime:5,endTime:null});
 assert.equal(JSON.stringify(layer),before);
 assert.equal(adjustLayerTiming({},'move',24,s),null);
 assert.equal(adjustLayerTiming({startTime:20,endTime:null},'move',24,s),null);
 assert.equal(adjustLayerTiming(layer,'move',NaN,s),null);
});
test('Timing follows processed duration, speed, and frame rate rather than source seconds',()=>{
 const trial={...s,method:'crossfade',transition:1,fps:30,speed:2};
 const duration=framePlan(trial).duration;
 assert.equal(duration,3);
 assert.deepEqual(adjustLayerTiming({},'start',15,trial),{startTime:.5});
 assert.deepEqual(adjustLayerTiming({},'end',-15,trial),{endTime:2.5});
});
test('Finished-time scrubbing maps natural, dissolve, reversed, eased, and shifted frames into the source',()=>{
 assert.equal(loopSourceTime(s,2),12+.5/24);
 const blend={...s,method:'crossfade',transition:1};
 assert.equal(loopSourceTime(blend,0),11+.5/24);
 const ping={...s,method:'pingpong'},n=framePlan(ping).frames;
 assert.equal(loopSourceTime(ping,n/24),s.start+(n-2+.5)/24);
 assert.equal(loopSourceTime(ping,framePlan(ping).duration),s.start+1.5/24);
 const eased={...s,method:'smooth-pingpong'};
 assert(loopSourceTime(eased,1)<loopSourceTime(ping,1));
 assert.ok(Math.abs(loopSourceTime({...s,shift:50},0)-(14+.5/24))<1e-9);
});
