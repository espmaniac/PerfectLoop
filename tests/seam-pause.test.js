import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseActivity,lowActivityRun,pauseTrim,pauseBasis,detectPause,assessPauseRepair } from '../js/seam-pause.js';
import { autoRepairCandidates } from '../js/auto-repair.js';
import { DEFAULTS,METHODS } from '../js/constants.js';
import { framePlan } from '../js/logic.js';

const settings={...DEFAULTS,preset:'custom',method:'natural',start:0,end:8};
const info={duration:8};
test('Pause activity ignores uniform exposure shifts and exposes small moving details',()=>{
 const a=new Float32Array(64*64).fill(40),b=new Float32Array(64*64).fill(60);
 assert.equal(pauseActivity(a,b,64,64),0);
 for(let y=20;y<30;y++)for(let x=20;x<30;x++)b[y*64+x]=150;
 assert(pauseActivity(a,b,64,64)>2);
});
test('Isolated duplicate cadence is not a sustained pause, and static footage has no trim suggestion',()=>{
 assert.equal(lowActivityRun([0,2,2,0,2,2],2),0);
 assert.equal(lowActivityRun([0,0,0,0,2,2],2),4);
 assert.equal(lowActivityRun([0,0,0],0),0);
});
test('Trimming by source frames preserves method, framing and layers and is reversible without accumulating trims',()=>{
 const s={...settings,cropX:25,layers:[{id:'test',visible:false}]},before=JSON.stringify(s);
 const trimmed=pauseTrim(s,4,2,24,false,info);
 assert.equal(trimmed.start,4/24);assert.equal(trimmed.end,8-2/24);assert.equal(trimmed.speed,1);
 assert.equal(trimmed.layers,s.layers);assert.equal(trimmed.cropX,25);assert.equal(JSON.stringify(s),before);
 assert.equal(pauseTrim(trimmed,4,2,24,false,info).start,trimmed.start);
 const reset=pauseTrim(trimmed,0,0,24,false,info);
 assert.equal(reset.start,0);assert.equal(reset.end,8);assert.equal(reset.speed,1);assert.equal(reset.seamPause,null);
 assert.equal(pauseBasis({...trimmed,start:1}),null);
});
test('Keep duration preserves every method output frame count at different frame rates',()=>{
 for(const fps of [24,30,60])for(const method of METHODS) {
  const s={...settings,fps,method:method.id};const trial=pauseTrim(s,4,2,24,true,info);
  assert.equal(framePlan(trial).outputFrames,framePlan(s).outputFrames);
  assert.ok(trial.speed<1);
 }
});
test('Invalid trims and impossible duration preservation fail before applying',()=>{
 for(const [head,tail,keep] of [[-1,0,false],[1.5,0,false],[100,100,false],[168,0,true]])
  assert.throws(()=>pauseTrim(settings,head,tail,24,keep,info));
 const corrected={...settings,repair:{version:1,brightness:[0,0,0],shiftX:0,shiftY:0,strength:1,flicker:false,alignment:false}};
 assert.equal(pauseTrim(corrected,0,0,24,false,info).repair,corrected.repair);
});
test('Detection finds near-static boundary runs despite noise and preserves a continuous moving cycle',()=>{
 const count=120,width=64,height=64;
 const frames=Array.from({length:count},(_,index)=>{
  const phase=Math.max(0,Math.min(1,(index-8)/103))*Math.PI*2;
  const cx=32+12*Math.cos(phase),cy=32+12*Math.sin(phase);
  return Float32Array.from({length:width*height},(_,p)=>40+120*Math.exp(-((p%width-cx)**2+(Math.floor(p/width)-cy)**2)/10)+(index%2)*.001);
 });
 const report=detectPause({frame:i=>frames[i],width,height,count,rate:24,window:12,reference:[24,40,60,80,94]});
 assert.ok(report.head>=6,JSON.stringify(report));assert.ok(report.tail>=6,JSON.stringify(report));
 assert.ok(report.head+report.tail<=count*.2);
 const staticFrames=Array.from({length:count},()=>frames[0]);
 const still=detectPause({frame:i=>staticFrames[i],width,height,count,rate:24,window:12,reference:[24,40,60,80,94]});
 assert.equal(still.head+still.tail,0);
});
test('Automatic repair can improve a held seam without a large endpoint-pixel score reduction',()=>{
 const before={score:1,velocity:1,motion:.1,detail:20},after={score:1.2,velocity:1,motion:2,detail:20};
 assert(assessPauseRepair(before,after,'keep',120,120).accepted);
 for(const change of [{score:4},{motion:.1},{detail:10},{velocity:4}])assert(!assessPauseRepair(before,{...after,...change},'keep',120,120).accepted);
 assert(!assessPauseRepair(before,after,'keep',120,119).accepted);
 assert(!assessPauseRepair(before,after,'trim',120,80).accepted);
});
test('Auto repair proposes the same reversible pause trim and preserves reverse-method intent',()=>{
 const analysis={brightness:[],flickerUseful:false,alignmentUseful:false,pause:{head:4,tail:2,rate:24}};
 for(const mode of ['keep','trim']) {
  const row=autoRepairCandidates(settings,analysis,mode,info).find(row=>row.pause);
  assert(row);assert.equal(row.settings.seamPause.head,4);assert.equal(row.settings.method,'natural');
  if(mode==='keep')assert.equal(framePlan(row.settings).outputFrames,framePlan(settings).outputFrames);
 }
 assert(!autoRepairCandidates({...settings,method:'pingpong'},analysis,'trim',info).some(row=>row.pause));
});

test('Rendered pause reduction is checked directly rather than requiring a large average-motion change',()=>{
 const before={score:1,velocity:1,motion:1,detail:20},after={score:1.2,velocity:1,motion:1.15,detail:20};
 const frozen={rawHead:4,rawTail:0,rate:24,reference:2,headActivity:.5,tailActivity:2};
 const moving={rawHead:0,rawTail:0,rate:24,reference:2,headActivity:1.8,tailActivity:2};
 assert(assessPauseRepair(before,after,'keep',120,120,frozen,moving).accepted);
 assert(!assessPauseRepair(before,after,'keep',120,120,frozen,frozen).accepted);
 assert(!assessPauseRepair(before,after,'keep',120,120,frozen,{...moving,reference:.5}).accepted);
});

test('Keeping duration allows the exact minimum playback speed without floating-point rejection',()=>{
 const trial=pauseTrim(settings,144,0,24,true,info);
 assert.equal(trial.speed,.25);assert.equal(framePlan(trial).outputFrames,framePlan(settings).outputFrames);
});
