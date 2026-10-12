import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBoundary, defectRegion, assessRepair } from '../js/auto-repair-core.js';
import { autoRepairCandidates } from '../js/auto-repair.js';
import { DEFAULTS } from '../js/constants.js';
import { framePlan } from '../js/logic.js';

test('A localized discontinuity is not hidden by a static background',()=>{
    const width=120,height=120;
    const frames=Array.from({length:8},()=>new Float32Array(width*height).fill(40));
    for(let k=0;k<4;k++)for(let y=36;y<48;y++)for(let x=24;x<36;x++)frames[k][y*width+x]=220;
    const report=scoreBoundary(frames,width,height);
    assert.ok(report.excess>5);
    const region=defectRegion(report);assert.ok(region);
    assert.ok(region.x<=.2 && region.y<=.3 && region.x+region.width>=.3 && region.y+region.height>=.4);
    assert.ok(region.width*region.height<.1);
    assert.equal(scoreBoundary(Array(8).fill(frames[0]),width,height).score,0);
});

test('Diffuse changes do not pretend to be a reliable small patch region',()=>{
    const frames=Array.from({length:8},(_,i)=>new Float32Array(120*120).fill(i<4?120:40));
    assert.equal(defectRegion(scoreBoundary(frames,120,120)),null);
});

test('Auto repair rejects blur, frozen motion, worse direction continuity, and excessive trimming',()=>{
    const before={score:10,detail:20,motion:5,velocity:8};
    const improved={score:5,detail:20,motion:5,velocity:4};
    assert.equal(assessRepair(before,improved,'keep',120,120).accepted,true);
    for(const change of [{detail:15},{motion:1},{velocity:10},{score:9}])
        assert.equal(assessRepair(before,{...improved,...change},'keep',120,120).accepted,false);
    assert.equal(assessRepair(before,improved,'keep',120,119).accepted,false);
    assert.equal(assessRepair(before,improved,'trim',120,90).accepted,false);
    assert.equal(assessRepair(before,improved,'trim',120,100).accepted,true);
    assert.equal(assessRepair(before,improved,'trim',120,125).accepted,false);
});

test('Keep duration preserves exact output frame count and never mutates settings',()=>{
    const analysis={brightness:[0,0,0],flickerUseful:false,alignmentUseful:false,shiftX:0,shiftY:0,cut:{start:1,end:4,score:3}};
    for(const fps of [24,30,60])for(const end of [1,6.57,12.123])for(const method of ['natural','crossfade','offset']) {
        const settings={...DEFAULTS,preset:'custom',method,start:.123,end,fps,speed:1.3,shift:0};
        const snapshot=JSON.stringify(settings),count=framePlan(settings).outputFrames;
        const candidates=autoRepairCandidates(settings,analysis,'keep');
        assert.ok(candidates.length);
        for(const candidate of candidates)assert.equal(framePlan(candidate.settings).outputFrames,count);
        assert.equal(JSON.stringify(settings),snapshot);
    }
    assert.equal(autoRepairCandidates({...DEFAULTS,method:'pingpong'},analysis,'trim').length,0);
});

test('A small strong defect takes priority over a larger mild mismatch',()=>{
    const tiles=[{x:0,y:0,width:12,height:12,excess:30}];
    for(let x=48;x<96;x+=12)for(let y=48;y<96;y+=12)tiles.push({x,y,width:12,height:12,excess:8});
    const region=defectRegion({width:120,height:120,excess:10,tiles});
    assert.deepEqual(region,{x:0,y:0,width:.15,height:.15});
});
