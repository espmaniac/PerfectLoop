import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundModel, boundaryOpacity } from '../js/background-repair.js';
const frames=(value)=>Array.from({length:17},()=>Uint8ClampedArray.from({length:16*16*4},(_,i)=>i%4===3?255:value));
test('a transient boundary object uses repeatedly observed background',()=>{
    const input=frames(80),p=8*16+8;
    for(let c=0;c<3;c++)input[0][p*4+c]=240;
    const model=backgroundModel(input,16,16);
    assert.equal(model.mask[p],1);
    assert.equal(input[model.donor[p]][p*4],80);
    assert.ok(model.coverage<.2);
});
test('moving backgrounds and unchanged objects are not painted over',()=>{
    const input=frames(80);
    assert.equal(backgroundModel(input,16,16).coverage,0);
    input.forEach((f,i)=>{for(let p=0;p<256;p++)for(let c=0;c<3;c++)f[p*4+c]=i*15;});
    assert.equal(backgroundModel(input,16,16).coverage,0);
});
test('compression noise does not trigger object removal',()=>{
    const input=frames(80);input[0].fill(86);input.at(-1).fill(75);
    assert.equal(backgroundModel(input,16,16).coverage,0);
});
test('background overlay is confined to the boundary and meets continuously',()=>{
    assert.equal(boundaryOpacity(0,6),1);
    assert.equal(boundaryOpacity(1,6),1);
    assert.equal(boundaryOpacity(.5,6),0);
    assert.equal(boundaryOpacity(.1,6),0);
    assert.ok(Math.abs(boundaryOpacity(.02,6)-boundaryOpacity(.98,6))<1e-12);
    assert.ok(boundaryOpacity(.01,6)>boundaryOpacity(.03,6));
});
