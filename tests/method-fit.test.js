import { createTextLayer } from '../js/layers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { methodTrials, methodFit, recommendMethod, methodContext, localDifference } from '../js/method-fit.js';
import { DEFAULTS } from '../js/constants.js';

test('A dissolve cannot win solely from a perfect boundary when it doubles or softens details',()=>{
    const natural=methodFit('natural',{boundaryError:5});
    const blend=methodFit('crossfade',{boundaryError:0,ghostRisk:70,detailLoss:.3});
    assert.ok(natural.score>blend.score);
    assert.equal(blend.seamFit,100);
    assert.equal(blend.detail,70);
});

test('Moving a visible transition into the cycle does not hide it from the fit score',()=>{
    const natural=methodFit('natural',{boundaryError:10,internalError:5,ordinaryError:5});
    const offset=methodFit('offset',{boundaryError:0,internalError:65,ordinaryError:5});
    assert.ok(offset.score<natural.score);
});

test('Black endpoints do not produce a perfect overall fit; reverse effects disclose their changed motion',()=>{
    const fade=methodFit('fade',{boundaryError:0,darkening:1,detailLoss:1});
    assert.equal(fade.seamFit,100);assert.ok(fade.score<50);
    assert.equal(fade.effect,'Fades through black');
    assert.equal(methodFit('pingpong',{boundaryError:0}).effect,'Reverses motion');
});

test('Any available method may be recommended, including reverse and fade effects',()=>{
    for(const id of ['natural','crossfade','offset','pingpong','smooth-pingpong','fade']) {
        const rows=[{id,score:90},{id:'other',score:50},{id:'unavailable',score:100,unavailable:'Too long'}];
        assert.equal(recommendMethod(rows).id,id);
    }
    assert.equal(recommendMethod([{id:'natural',unavailable:'Invalid source'}]),null);
});

test('A near tie preserves natural motion only when its seam is already good',()=>{
    assert.equal(recommendMethod([{id:'natural',score:80,seamFit:95},{id:'crossfade',score:83}]).id,'natural');
    assert.equal(recommendMethod([{id:'natural',score:80,seamFit:95},{id:'crossfade',score:90}]).id,'crossfade');
    assert.equal(recommendMethod([{id:'natural',score:67,seamFit:67},{id:'smooth-pingpong',score:70}]).id,'smooth-pingpong');
});

test('Method trials respect output constraints and report their actual duration without changing source settings',()=>{
    const settings={...DEFAULTS,start:0,end:6},snapshot=JSON.stringify(settings);
    const rows=methodTrials(settings,{duration:8,width:768,height:768});
    assert.equal(rows.find(r=>r.id==='natural').duration,6);
    assert.equal(rows.find(r=>r.id==='crossfade').duration,5.5);
    assert.equal(rows.find(r=>r.id==='offset').settings.shift,50);
    assert.match(rows.find(r=>r.id==='pingpong').unavailable,/3–8/);
    assert.equal(rows.find(r=>r.id==='natural').unavailable,'');
    assert.equal(JSON.stringify(settings),snapshot);
    assert.equal(methodTrials({...settings,preset:'custom'},{duration:8}).find(r=>r.id==='pingpong').unavailable,'');
});

test('Comparison context survives manual method choices and layer edits, but not source framing or overlap changes',()=>{
    const context=methodContext(DEFAULTS);
    assert.equal(methodContext({...DEFAULTS,method:'offset',shift:50,layers:[{...createTextLayer(),text:'Changed'}],repair:{flicker:true}}),context);
    for(const change of [{cropX:25},{zoom:150},{transition:.25},{fps:24},{end:8},{preset:'custom'}])assert.notEqual(methodContext({...DEFAULTS,...change}),context);
});

test('Local comparison exposes a small defect despite an unchanged background',()=>{
    const a=new Float32Array(120*120).fill(40),b=a.slice();
    for(let y=36;y<48;y++)for(let x=24;x<36;x++)b[y*120+x]=220;
    assert.ok(localDifference(a,b,120,120)>8);
    assert.equal(localDifference(a,a,120,120),0);
});


test('Slowing or freezing boundary motion is not a free continuity improvement',()=>{
    const moving=methodFit('smooth-pingpong',{boundaryError:0,motionRetention:1});
    const frozen=methodFit('smooth-pingpong',{boundaryError:0,motionRetention:0});
    assert.equal(moving.seamFit,frozen.seamFit);
    assert.ok(moving.score-frozen.score>=12);
    assert.equal(frozen.motion,0);
});


test('Method eligibility includes layers even though visual scores compare source video',()=>{
    const invalid={...createTextLayer(),opacity:200};
    const settings={...DEFAULTS,preset:'custom',layers:[invalid]};
    assert.ok(methodTrials(settings,{duration:8}).every(row=>row.unavailable.includes('opacity')));
    assert.notEqual(methodContext(settings),methodContext({...settings,layers:[]}));
});
