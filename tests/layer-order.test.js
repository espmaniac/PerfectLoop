import test from 'node:test';
import assert from 'node:assert/strict';
import { layerStack, moveLayerInStack } from '../js/layer-order.js';
import { layerOverlayGraph } from '../js/layer-export.js';
import { DEFAULTS } from '../js/constants.js';
const ids = layers => layerStack(layers).map(layer=>layer.id);
const a={id:'a',type:'image'}, b={id:'b',type:'text'}, c={id:'c',placement:'below',type:'image'};

test('The unified stack includes video and preserves the rendering order of legacy interleaved layers',()=>{
    assert.deepEqual(ids([a,c,b]),['c','video','a','b']);
});

test('An overlay crosses video in either direction without mutating its saved state',()=>{
    const source=[a,c,b],snapshot=JSON.stringify(source);
    const below=moveLayerInStack(source,'a','down');
    assert.deepEqual(ids(below),['c','a','video','b']);
    assert.equal(below.find(l=>l.id==='a').placement,'below');
    assert.equal(below.find(l=>l.id==='b'),b);
    assert.deepEqual(ids(moveLayerInStack(below,'a','up')),ids(source));
    assert.equal(JSON.stringify(source),snapshot);
});

test('Video arrows move the source through the same stack without exporting a video overlay',()=>{
    const lowered=moveLayerInStack([a,c,b],'video','down');
    assert.deepEqual(ids(lowered),['video','c','a','b']);
    assert.equal(lowered.length,3);
    assert.equal(lowered.find(l=>l.id==='c').placement,'above');
    const raised=moveLayerInStack([a,c,b],'video','up');
    assert.deepEqual(ids(raised),['c','a','video','b']);
    assert.equal(raised.find(l=>l.id==='a').placement,'below');
});

test('Boundary arrows and invalid actions are no-ops; hidden layers retain their stack positions',()=>{
    const source=[a,c,{...b,visible:false}];
    assert.equal(moveLayerInStack(source,'b','up'),source);
    assert.equal(moveLayerInStack(source,'c','down'),source);
    assert.equal(moveLayerInStack(source,'missing','up'),source);
    assert.equal(moveLayerInStack(source,'a','delete'),source);
    assert.equal(moveLayerInStack([], 'video','up').length,0);
    assert.deepEqual(ids(moveLayerInStack(source,'a','up')),['c','video','b','a']);
});

test('Export overlays composite the video between layers reordered across it',()=>{
    const layers=moveLayerInStack([a,b],'a','down');
    const settings={...DEFAULTS,preset:'custom',method:'natural',width:96,height:96};
    const sprites=layers.map(layer=>({layer:{...layer,x:50,y:50,opacity:100,motion:'none',rotation:0},width:32,height:32}));
    const {graph}=layerOverlayGraph(settings,sprites);
    assert.ok(graph.indexOf('[video-composite]')>graph.indexOf('[layer-base][layer-0-0]'));
    assert.ok(graph.includes('[video-composite][layer-1-0]'));
});
