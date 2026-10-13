import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentDelta } from '../js/alignment.js';
import { alignVideoToFrame,videoSelectionGeometry } from '../js/framing.js';
import { DEFAULTS } from '../js/constants.js';
import { layerOverlayGraph } from '../js/layer-export.js';
test('all video edge alignments include rotation, mirror and zoom',()=>{
    for(const fit of ['contain','cover','stretch'])for(const rotate of [0,33,90])for(const zoom of [50,150]) {
        const s={...DEFAULTS,width:320,height:240,fit,rotate,zoom,cropX:25,cropY:70,mirror:true};
        for(const key of ['left','right','top','bottom','center-x','center-y']) {
            const next={...s,...alignVideoToFrame(s,{width:160,height:90},key)};
            const shape=videoSelectionGeometry(next,{width:160,height:90});
            const remaining=alignmentDelta(shape.corners,320,240,key);
            assert.ok(Math.abs(remaining.x)<1e-6 && Math.abs(remaining.y)<1e-6,`${fit}/${rotate}/${zoom}/${key}`);
        }
    }
});
test('export composites lower layers, masked video, then upper layers',()=>{
    const layer={x:50,y:50,motion:'none',spin:'none',rotation:0};
    const sprites=[{layer:{...layer,placement:'below'},width:64,height:64},{layer,width:64,height:64}];
    const result=layerOverlayGraph({...DEFAULTS,end:2},sprites);
    assert.ok(result.inputs.includes('video-mask.png'));
    assert.ok(result.graph.indexOf('[layer-base][layer-0-0]') < result.graph.indexOf('[layer-composite-0-0][video-foreground]'));
    assert.ok(result.graph.includes('[video-composite][layer-1-0]'));
    assert.ok(result.graph.includes('[3:v]format=gray'));
});
test('legacy foreground-only export does not need a mask',()=>{
    const result=layerOverlayGraph({...DEFAULTS,end:2},[{layer:{x:50,y:50,motion:'none',spin:'none',rotation:0},width:64,height:64}]);
    assert.ok(!result.inputs.includes('video-mask.png'));
    assert.ok(!result.graph.includes('alphamerge'));
});

test('rotated video occludes lower layers only inside its actual rectangle',async()=>{
    const {pointInsideVideo}=await import('../js/framing.js');
    const s={...DEFAULTS,width:128,height:128,fit:'contain',zoom:50,rotate:35};
    const info={width:128,height:128};
    assert.equal(pointInsideVideo(s,info,64,64),true);
    assert.equal(pointInsideVideo(s,info,33,33),false);
    assert.equal(pointInsideVideo(s,info,8,8),false);
});
