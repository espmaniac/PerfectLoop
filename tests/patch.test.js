import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionBounds, featherAlpha } from '../js/patch.js';
import { layerActive, createTextLayer, validateLayers } from '../js/layers.js';
import { layerOverlayGraph } from '../js/layer-export.js';
import { DEFAULTS } from '../js/constants.js';
import { execFileSync } from 'node:child_process';
const box = (x, y, w, h) => [{ x, y }, { x: x+w, y }, { x: x+w, y: y+h }, { x, y: y+h }];
test('Patch bounds retain exact output placement, clip padding and support small selections', () => {
    assert.deepEqual(selectionBounds(box(20, 30, 40, 50), 200, 200, 2), { left: 18, top: 28, width: 44, height: 54 });
    assert.deepEqual(selectionBounds(box(0, 0, 10, 10), 200, 200, 3), { left: 0, top: 0, width: 13, height: 13 });
    assert.equal(selectionBounds(box(3990, 0, 2, 3), 4000, 200).width, 40);
    assert.throws(() => selectionBounds([{x:0,y:0},{x:1,y:1}],100,100));
});
test('Portable feathering preserves symmetry and creates intermediate alpha without wrapping edges', () => {
    const mask = new Uint8ClampedArray(21*21);
    for(let y=6;y<15;y++) for(let x=6;x<15;x++) mask[y*21+x]=255;
    const soft=featherAlpha(mask,21,21,3);
    assert.ok(soft[10*21+5]>0 && soft[10*21+5]<128);
    assert.equal(soft[10*21+10],255);
    assert.equal(soft[0],0);
    for(let y=0;y<21;y++) for(let x=0;x<21;x++) assert.equal(soft[y*21+x],soft[y*21+20-x]);
    assert.equal(featherAlpha(mask,21,21,0),mask);
});
test('Layer intervals are half-open and repeat in finished-loop time', () => {
    const layer={startTime:.5,endTime:1.5};
    assert.equal(layerActive(layer,.499,2),false);
    assert.equal(layerActive(layer,.5,2),true);
    assert.equal(layerActive(layer,1.5,2),false);
    assert.equal(layerActive(layer,2.5,2),true);
    assert.equal(layerActive({},0,2),true);
    assert.equal(layerActive(undefined,0,2),false);
    assert.equal(layerActive({startTime:1,endTime:null},1.9,2),true);
    assert.equal(layerActive({startTime:1,endTime:null},2,2),false);
    assert.equal(layerActive({startTime:3},1,2),false);
});
test('Invalid active times are rejected while existing untimed layers stay valid', () => {
    const layer=createTextLayer();
    assert.deepEqual(validateLayers([layer]),[]);
    for (const timing of [{startTime:-1},{startTime:NaN},{endTime:Infinity},{startTime:1,endTime:1}]) assert.ok(validateLayers([{...layer,...timing}]).length);
});
let native=true;try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});}catch{native=false;}
test('Encoded overlays appear only on the selected frames, preserving duration', {skip:!native}, () => {
    const settings={...DEFAULTS,preset:'custom',width:16,height:16,fps:4,start:0,end:2,method:'natural'};
    const layer={...createTextLayer(settings),startTime:.5,endTime:1.5,motion:'none'};
    const graph=layerOverlayGraph(settings,[{layer,width:16,height:16}],'0:v','result').graph;
    const bytes=execFileSync('ffmpeg',['-v','error','-threads','1','-filter_complex_threads','1','-f','lavfi','-i','color=black:s=16x16:r=4:d=4','-f','lavfi','-i','color=white:s=16x16:r=4:d=4','-filter_complex',graph,'-map','[result]','-pix_fmt','gray','-f','rawvideo','pipe:1']);
    assert.equal(bytes.length,16*256);
    const values=Array.from({length:16},(_,i)=>bytes[i*256]);
    assert.deepEqual(values.map(v=>v>128),[false,false,true,true,true,true,false,false,false,false,true,true,true,true,false,false]);
});
