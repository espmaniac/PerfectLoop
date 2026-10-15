import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewPlayback } from '../js/preview-playback.js';

function fixture() {
    const state = {info:{duration:8}, sourceURL:'source-a', previewChoice:'result', tab:'edit', mode:'composition', renderURL:''};
    const video = {paused:true}, calls = {renders:0, plays:0};
    let dirty = true;
    const preview = {
        active: () => video,
        pause: () => {video.paused=true;},
        play: async () => {calls.plays++; video.paused=false;},
        setMode: mode => {state.mode=mode;},
    };
    const playback = new PreviewPlayback({getState:()=>state, preview, needsRender:()=>dirty,
        render:async()=>{calls.renders++;dirty=false;state.renderURL='result-a';return true;}});
    return {state,video,calls,playback,setDirty:value=>{dirty=value;}};
}
test('Edits pause Original or Result without starting a render', async()=>{
    const f=fixture();
    for(const choice of ['original','result']) {
        f.state.previewChoice=choice;f.video.paused=false;
        f.playback.stop();assert(f.video.paused);
    }
    await Promise.resolve();assert.equal(f.calls.renders,0);
});
test('Play renders the changed full result once, starts it, and reuses it on subsequent plays',async()=>{
    const f=fixture();await f.playback.play();
    assert.deepEqual(f.calls,{renders:1,plays:1});assert.equal(f.state.mode,'loop');
    await f.playback.play();assert(f.video.paused);
    await f.playback.play();assert.deepEqual(f.calls,{renders:1,plays:2});
});
test('Original and search play the source without encoding, even with changed or missing output',async()=>{
    for(const [previewChoice,tab] of [['original','edit'],['result','find']]) {
        const f=fixture();Object.assign(f.state,{previewChoice,tab});await f.playback.play();
        assert.deepEqual(f.calls,{renders:0,plays:1});assert.equal(f.state.mode,'composition');
    }
});
test('Layers Play updates a changed result and uses a cached result when available',async()=>{
    const f=fixture();f.state.tab='layers';await f.playback.play();
    assert.deepEqual(f.calls,{renders:1,plays:1});assert.equal(f.state.mode,'loop');
    f.playback.stop();f.state.mode='composition';await f.playback.play();
    assert.deepEqual(f.calls,{renders:1,plays:2});assert.equal(f.state.mode,'loop');
});
test('Failed or cancelled encoding stays paused and waits for another Play to retry',async()=>{
    const f=fixture();f.playback.render=async()=>{f.calls.renders++;return false;};
    await f.playback.play();assert.deepEqual(f.calls,{renders:1,plays:0});assert(f.video.paused);
    await Promise.resolve();assert.equal(f.calls.renders,1);
    await f.playback.play();assert.deepEqual(f.calls,{renders:2,plays:0});
    f.playback.render=async()=>{throw new Error('Failed to encode');};
    await assert.rejects(f.playback.play(),/Failed to encode/);assert.equal(f.playback.pending,false);
});
test('Rapid Play requests share one pending render',async()=>{
    const f=fixture();let finish;
    f.playback.render=()=>{f.calls.renders++;return new Promise(resolve=>{finish=()=>{f.setDirty(false);f.state.renderURL='result';resolve(true);};});};
    const first=f.playback.play();await f.playback.play();
    assert.deepEqual(f.calls,{renders:1,plays:0});finish();await first;
    assert.deepEqual(f.calls,{renders:1,plays:1});
});
test('Stopping, source changes, comparison changes, and stale results prevent delayed autoplay',async()=>{
    for(const change of [f=>f.playback.stop(),f=>{f.state.sourceURL='source-b';},f=>{f.state.previewChoice='original';},f=>{f.state.tab='find';},f=>f.setDirty(true)]) {
        const f=fixture();let finish;
        f.playback.render=()=>new Promise(resolve=>{finish=()=>{f.setDirty(false);f.state.renderURL='result';change(f);resolve(true);};});
        const pending=f.playback.play();finish();await pending;
        assert.equal(f.calls.plays,0);assert(f.video.paused);assert.equal(f.playback.pending,false);
    }
});
test('No media or another active job prevents rendering or playback',async()=>{
    const f=fixture();f.state.info.duration=0;await f.playback.play();
    f.state.info.duration=8;f.state.job={kind:'export'};await f.playback.play();
    assert.deepEqual(f.calls,{renders:0,plays:0});
});
