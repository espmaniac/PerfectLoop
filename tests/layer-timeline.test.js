import test from 'node:test';
import assert from 'node:assert/strict';
import {LayerTimeline} from '../js/layer-timeline.js';
import {DEFAULTS} from '../js/constants.js';

function fixture(t,layer={id:'text',type:'text',text:'Text',startTime:2,endTime:5}) {
 const state={tab:'layers',sourceURL:'source-a',info:{duration:8},s:{...DEFAULTS,method:'natural',start:0,end:8,fps:24,shift:0,layers:[layer]}};
 const box={left:0,width:800},lane={dataset:{trackLane:layer.id},getBoundingClientRect:()=>box};
 const ruler={getBoundingClientRect:()=>box},listeners=new Map();let captured=false;
 const host={hidden:false,querySelector:selector=>selector==='[data-track-ruler]'?ruler:{},
  addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),
  setPointerCapture:()=>{captured=true;},hasPointerCapture:()=>captured,releasePointerCapture:()=>{captured=false;}};
 const history=[],edits=[],seeks=[];
 const timeline=new LayerTimeline(host,{getState:()=>state,select:id=>{state.activeLayerId=id;},
  edit:(id,partial,saveHistory)=>{assert.equal(saveHistory,false);edits.push(partial);state.s.layers=state.s.layers.map(item=>item.id===id?{...item,...partial}:item);},
  seek:time=>seeks.push(time),remember:()=>history.push({...state.s.layers[0]})});
 t.after(()=>timeline.destroy());
 function begin(action='move') {
  const control={dataset:{trackEdit:action},focus(){},closest:()=>({getBoundingClientRect:()=>({left:0,right:800})})};
  lane.querySelector=()=>control;
  const target={closest:selector=>selector==='[data-track-lane]'?lane:selector==='[data-track-edit]'?control:null};
  const x=action==='end'?800:action==='start'?0:300;
  timeline.pointerDown({button:0,pointerId:1,clientX:x,target,preventDefault(){},stopPropagation(){}});return x;
 }
 const move=x=>timeline.pointerMove({pointerId:1,clientX:x,preventDefault(){}});
 return {timeline,state,history,edits,seeks,begin,move,captured:()=>captured};
}
test('A pointer gesture records one undo snapshot and moves a fixed-duration interval on the output frame grid',t=>{
 const f=fixture(t),x=f.begin();assert.equal(f.history.length,0);
 f.move(x+100);f.move(x+200);f.move(x+250);
 assert.equal(f.history.length,1);assert.deepEqual(f.history[0],{id:'text',type:'text',text:'Text',startTime:2,endTime:5});
 assert.equal(f.state.s.layers[0].startTime,4.5);assert.equal(f.state.s.layers[0].endTime,7.5);
 f.timeline.pointerEnd({pointerId:1});assert.equal(f.timeline.gesture,null);assert.equal(f.captured(),false);
});
test('Returning to a clamped starting boundary restores the original interval',t=>{
 const f=fixture(t,{id:'text',type:'text',text:'Text',startTime:0,endTime:3}),x=f.begin();
 f.move(x+100);assert.equal(f.state.s.layers[0].startTime,1);
 f.move(x-100);assert.equal(f.state.s.layers[0].startTime,0);assert.equal(f.state.s.layers[0].endTime,3);
 assert.equal(f.history.length,1);
});
test('Trimming an automatic end then dragging back restores Until end of loop',t=>{
 const f=fixture(t,{id:'text',type:'text',text:'Text',startTime:0,endTime:null}),x=f.begin('end');
 f.move(x-200);assert.equal(f.state.s.layers[0].endTime,6);
 f.move(x+30);assert.equal(f.state.s.layers[0].endTime,null);assert.equal(f.history.length,1);
});
test('Changing tabs, files, timing, deleting the layer, or starting a job stops captured edits',t=>{
 for(const change of [s=>{s.tab='edit';},s=>{s.sourceURL='source-b';},s=>{s.s.speed=2;},s=>{s.s.layers=[];},s=>{s.job={kind:'preview'};}]) {
  const f=fixture(t),x=f.begin();change(f.state);f.move(x+100);
  assert.equal(f.timeline.gesture,null);assert.equal(f.captured(),false);assert.equal(f.history.length,0);assert.equal(f.edits.length,0);
 }
});
test('A full-loop clip does not create undo entries when a move cannot change it',t=>{
 const f=fixture(t,{id:'text',type:'text',text:'Text'}),x=f.begin();f.move(x+200);
 assert.equal(f.edits.length,0);assert.equal(f.history.length,0);
});
