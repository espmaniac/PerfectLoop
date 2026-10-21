import test from 'node:test';
import assert from 'node:assert/strict';
import { Preview } from '../js/preview.js';
import { DEFAULTS } from '../js/constants.js';

class FakeElement {
    constructor() {
        this.listeners = new Map();
        this.attributes = new Map();
        this.style = { setProperty() {} };
    }
    addEventListener(name, listener) {
        const listeners = this.listeners.get(name) || [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
    }
    dispatch(name) { for (const listener of this.listeners.get(name) || []) listener(); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { delete this[name]; }
}

class FakeVideo extends FakeElement {
    constructor(color) {
        super();
        Object.assign(this, {
            color, videoWidth: 640, videoHeight: 360, readyState: 2,
            currentTime: 1, duration: 3, paused: true, seeking: false,
        });
    }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; this.dispatch('pause'); }
    load() { this.readyState = 0; this.videoWidth = this.videoHeight = 0; }
}

class FakeCanvas extends FakeElement {
    constructor() {
        super();
        this._width = this._height = 16;
        this.pixel = null;
        this.context = {
            canvas: this,
            fillStyle: '#000000',
            fillRect: () => { this.pixel = this.context.fillStyle; },
            clearRect: () => { this.pixel = null; },
            drawImage: video => { this.pixel = video.color; },
            save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
        };
    }
    get width() { return this._width; }
    set width(value) { this._width = value; this.pixel = null; }
    get height() { return this._height; }
    set height(value) { this._height = value; this.pixel = null; }
    getContext() { return this.context; }
}

function fixture(t) {
    const previous = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame']
        .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const source = new FakeVideo('#2468ac'), output = new FakeVideo('#64ac24');
    const canvas = new FakeCanvas();
    const elements = new Map([
        ['#source-video', source], ['#loop-video', output], ['#preview-canvas', canvas],
        ['[data-action="play"]', new FakeElement()],
        ['#transport-time', new FakeElement()],
    ]);
    let nextId = 0, now = 101;
    const frames = new Map();
    globalThis.document = { querySelector: selector => elements.get(selector), createElement: tag => {
        assert.equal(tag,'canvas'); return new FakeCanvas();
    } };
    globalThis.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const state = {
        mode: 'loop', renderURL: 'rendered-loop.mp4',
        render: { width: 640, height: 360, duration: 3, fps: 30 },
        info: { width: 640, height: 360, duration: 3, fps: 30 },
        s: { ...DEFAULTS, start: 0, end: 3 },
    };
    const times = [];
    const preview = new Preview(() => state, mode => { state.mode = mode; }, (time, mode) => times.push({ time, mode }), {needsRender:()=>Boolean(state.needsRender)});
    t.after(() => {
        preview.destroy();
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    preview.refresh();
    return {
        preview, state, source, output, canvas, times, transport: elements.get('#transport-time'), playButton: elements.get('[data-action="play"]'),
        tick(time = now) {
            const [id, callback] = frames.entries().next().value;
            frames.delete(id);
            callback(time);
            now = time + 16;
        },
    };
}

test('Saved frames use the selected output dimensions independently of display and decoded preview sizes', t => {
    const f=fixture(t);
    Object.assign(f.state,{mode:'composition',previewChoice:'original'});
    Object.assign(f.state.s,{width:1080,height:1920});f.preview.refresh();
    assert.equal(f.canvas.width,540);assert.equal(f.canvas.height,960);
    const sourceTime=f.source.currentTime;f.source.paused=false;
    const original=f.preview.captureFrame();
    assert.equal(original.width,1080);assert.equal(original.height,1920);assert.equal(original.pixel,f.source.color);
    assert.equal(f.canvas.width,540);assert.equal(f.canvas.height,960);
    assert.equal(f.source.currentTime,sourceTime);assert.equal(f.source.paused,false);
    f.state.mode='loop';f.state.previewChoice='result';
    for(const [width,height] of [[1920,1080],[2048,2048],[3840,2160],[320,180]]) {
        Object.assign(f.state.s,{width,height});const result=f.preview.captureFrame();
        assert.equal(result.width,width);assert.equal(result.height,height);assert.equal(result.pixel,f.output.color);
    }
});

test('Saving a source/search frame applies output framing instead of stretching the source into another aspect ratio', t => {
    const f=fixture(t);Object.assign(f.state,{mode:'source',previewChoice:'original',tab:'find'});
    Object.assign(f.state.s,{width:1080,height:1920,fit:'contain',zoom:100,cropX:50,cropY:50,rotate:0});
    const create=document.createElement,transforms=[];
    document.createElement=tag=>{const canvas=create(tag);canvas.context.translate=(...values)=>transforms.push(['translate',...values]);canvas.context.scale=(...values)=>transforms.push(['scale',...values]);return canvas;};
    const frame=f.preview.captureFrame();
    assert.deepEqual(transforms,[['translate',540,960],['scale',1.6875,1.6875]]);
    assert.equal(frame.width,1080);assert.equal(frame.height,1920);
});

test('Invalid dimensions and incomplete seeks cannot produce empty frame downloads', t => {
    const f=fixture(t);
    for(const width of [0,NaN,Infinity,15,3841,1080.5]) {
        f.state.s.width=width;assert.throws(()=>f.preview.captureFrame(),/output dimensions/);
    }
    f.state.s.width=1080;f.output.seeking=true;
    assert.throws(()=>f.preview.captureFrame(),/finish loading/);
    f.output.seeking=false;f.output.readyState=1;
    assert.throws(()=>f.preview.captureFrame(),/finish loading/);
});

test('Layer timeline seeks can retain finished time independently of the sampled source frame', t => {
    const f=fixture(t);f.state.info.duration=20;f.source.duration=20;Object.assign(f.state.s,{start:10,end:18});
    f.preview.seek(14.25,'composition',7);
    assert.equal(f.source.currentTime,14.25);assert.equal(f.preview.compositionTime,7);
    f.preview.seek(12,'composition');assert.equal(f.preview.compositionTime,2);
});

test('Play describes updating the result and encoding progress even while playback stays paused', t => {
    const f=fixture(t);Object.assign(f.state,{previewChoice:'result',tab:'edit',needsRender:true});
    f.preview.refresh();assert.equal(f.playButton.getAttribute('aria-label'),'Update and play result');
    assert.equal(f.playButton.getAttribute('aria-busy'),'false');
    f.state.job={kind:'preview'};f.preview.syncPlayButton();
    assert.equal(f.playButton.getAttribute('aria-label'),'Updating result');
    assert.equal(f.playButton.getAttribute('aria-busy'),'true');
    f.state.job=null;f.preview.refresh();
    assert.equal(f.playButton.getAttribute('aria-label'),'Update and play result');
    f.state.previewChoice='original';f.preview.refresh();
    assert.equal(f.playButton.getAttribute('aria-label'),'Play preview');
    f.state.previewChoice='result';f.state.needsRender=false;f.preview.refresh();
    assert.equal(f.playButton.getAttribute('aria-label'),'Play preview');
});

test('Composition positions and scales the rotated video while Source and Loop retain their encoded frames', t => {
    const f = fixture(t), transforms = [];
    f.state.mode = 'composition';
    Object.assign(f.state.s, { width: 180, height: 180, fit: 'contain', zoom: 50, cropX: 0, cropY: 100, rotate: 90, mirror: true });
    f.canvas.context.translate = (...values) => transforms.push(['translate', ...values]);
    f.canvas.context.scale = (...values) => transforms.push(['scale', ...values]);
    f.canvas.context.rotate = angle => transforms.push(['rotate', angle]);
    f.preview.refresh(); f.tick();
    assert.deepEqual(transforms, [['translate', 135, 720], ['scale', -0.75, 0.75], ['rotate', Math.PI / 2]]);
    for (const mode of ['source', 'loop']) {
        transforms.length = 0;
        f.state.mode = mode; f.preview.refresh(); f.tick();
        assert.deepEqual(transforms, [], `${mode} uses its original pixels rather than applying framing twice`);
    }
});

test('Loop preview keeps its last decoded frame while the next frame is unavailable', t => {
    const f = fixture(t);
    f.tick();
    assert.equal(f.canvas.pixel, '#64ac24');

    f.output.currentTime = 0;
    f.output.readyState = 1;
    f.output.seeking = true;
    f.output.color = '#000000';
    f.tick();
    assert.equal(f.canvas.pixel, '#64ac24', 'decoder waiting must not blank the canvas');

    f.output.readyState = 2;
    f.tick();
    assert.equal(f.canvas.pixel, '#64ac24', 'a seek must finish before its frame is displayed');

    f.output.seeking = false;
    f.output.color = '#ac2468';
    f.tick();
    assert.equal(f.canvas.pixel, '#ac2468', 'the decoded loop head replaces the retained frame');
});

test('Completing a paused seek refreshes the frame even at the same playback time', t => {
    const f = fixture(t);
    for (const [mode, video] of [['loop', f.output], ['source', f.source]]) {
        f.preview.setMode(mode);
        f.tick();
        video.seeking = true;
        f.tick();
        video.seeking = false;
        video.color = '#ac2468';
        video.dispatch('seeked');
        f.tick();
        assert.equal(f.canvas.pixel, '#ac2468', `${mode} updates after seeking`);
    }
});

test('A valid black frame remains visible in the rendered video', t => {
    const f = fixture(t);
    f.tick();
    f.output.currentTime = 1.1;
    f.output.color = '#000000';
    f.tick();
    assert.equal(f.canvas.pixel, '#000000');
});

test('Replacing active media clears the previous image before the new video loads', t => {
    const f = fixture(t);
    f.tick();
    f.preview.setOutput('replacement-loop.mp4');
    assert.notEqual(f.canvas.pixel, '#64ac24');

    f.preview.setMode('source');
    f.tick();
    assert.equal(f.canvas.pixel, '#2468ac');
    f.preview.setSource('replacement-source.mp4');
    assert.notEqual(f.canvas.pixel, '#2468ac');
});

test('Refreshing unchanged dimensions preserves the active preview frame', t => {
    const f = fixture(t);
    f.tick();
    assert.equal(f.canvas.pixel, '#64ac24');
    f.preview.refresh();
    f.tick();
    assert.equal(f.canvas.pixel, '#64ac24');
});

test('Playback publishes the active media time on every animation frame', t => {
    const f = fixture(t);
    f.source.currentTime = 2;
    f.output.currentTime = 0.25;
    f.tick();
    f.output.currentTime = 0.5;
    f.tick();
    f.preview.setMode('source');
    f.tick();
    assert.deepEqual(f.times, [
        { time: 0.25, mode: 'loop' },
        { time: 0.5, mode: 'loop' },
        { time: 2, mode: 'source' },
    ]);
});

test('Timeline seeking preserves Loop mode while source selection still seeks Source', t => {
    const f = fixture(t);
    f.preview.seek(1.5, 'loop');
    assert.equal(f.state.mode, 'loop');
    assert.equal(f.output.currentTime, 1.5);
    assert.equal(f.source.currentTime, 1);
    assert.deepEqual(f.times.at(-1), { time: 1.5, mode: 'loop' });
    f.preview.seek(10, 'loop');
    assert.equal(f.output.currentTime, 2.999, 'output seeking stops before the rendered end');

    f.preview.seek(2);
    assert.equal(f.state.mode, 'source');
    assert.equal(f.source.currentTime, 2);
    assert.equal(f.output.currentTime, 2.999);
    assert.deepEqual(f.times.at(-1), { time: 2, mode: 'source' });
});

test('Composition animation completes its processed cycle without resetting when the source repeats', t => {
    const f = fixture(t);
    f.preview.setMode('composition');
    f.source.paused = false;
    f.tick();
    const initial = f.preview.compositionTime;
    f.source.currentTime = f.state.s.end;
    f.tick();
    assert.equal(f.source.currentTime, f.state.s.start);
    assert.ok(f.preview.compositionTime > initial, 'layer movement continues through the source boundary');
    f.preview.seek(1.5, 'composition');
    assert.equal(f.preview.compositionTime, 1.5);
    f.preview.step(1);
    assert.equal(f.preview.compositionTime, 1.5 + 1 / f.state.s.fps);
    f.preview.setMode('source');
    f.tick();
    assert.equal(f.canvas.pixel, f.source.color, 'Source still shows the original video');
});

function setSearchRange(f) {
    f.state.tab = 'find';
    f.state.opts = { from: 40, to: 56 };
    f.state.info.duration = f.source.duration = 60;
    f.state.s.start = 0;
    f.state.s.end = 7;
    f.preview.setMode('source');
}

test('Find playback explores a late search range independently of the render trim', async t => {
    const f = fixture(t);
    setSearchRange(f);
    f.preview.seek(45);
    await f.preview.play();
    assert.equal(f.source.currentTime, 45, 'playing a late source position must not jump to the render trim');
    f.source.currentTime = 56;
    f.tick();
    assert.equal(f.source.currentTime, 40, 'the search end wraps to the search start');
    assert.deepEqual(f.times.at(-1), { time: 40, mode: 'source' });
    f.preview.pause();
    f.preview.seek(3);
    await f.preview.play();
    assert.equal(f.source.currentTime, 40, 'playing outside the search interval starts inside it');
    assert.equal(f.state.s.start, 0);
    assert.equal(f.state.s.end, 7);
});

test('Find stepping uses source frames within the active search bounds', t => {
    const f = fixture(t);
    setSearchRange(f);
    f.source.currentTime = 45;
    f.preview.step(1);
    assert.equal(f.source.currentTime, 45 + 1 / 30);
    f.source.currentTime = 40;
    f.preview.step(-1);
    assert.equal(f.source.currentTime, 40);
    f.source.currentTime = 56;
    f.preview.step(1);
    assert.equal(f.source.currentTime, 56 - 1 / 30);
    assert.equal(f.state.s.start, 0);
    assert.equal(f.state.s.end, 7);
});

test('Find range edits affect an active preview and ended playback immediately', t => {
    const f = fixture(t);
    setSearchRange(f);
    f.source.currentTime = 45;
    f.source.paused = false;
    f.state.opts = { from: 48, to: 54 };
    f.tick();
    assert.equal(f.source.currentTime, 48);
    f.source.currentTime = 60;
    f.source.paused = true;
    f.source.dispatch('ended');
    assert.equal(f.source.currentTime, 48);
    assert.equal(f.source.paused, false);
    f.preview.pause();
    f.preview.seek(52);
    f.tick(250);
    assert.equal(f.transport.textContent, '00:52.000 / 01:00.000', 'timestamps retain absolute source coordinates');
});

test('Leaving Find restores the render trim while Composition and Loop keep their own timing', async t => {
    const f = fixture(t);
    setSearchRange(f);
    f.source.currentTime = 45;
    f.state.tab = 'edit';
    await f.preview.play();
    assert.equal(f.source.currentTime, 0);
    f.preview.pause();
    f.state.tab = 'find';
    f.preview.setMode('composition');
    f.source.currentTime = 45;
    await f.preview.play();
    assert.equal(f.source.currentTime, 0, 'Composition still uses the output trim');
    f.preview.setMode('loop');
    f.output.currentTime = 1;
    f.preview.step(1);
    assert.equal(f.output.currentTime, 1 + 1 / 30);
    await f.preview.play();
    assert.equal(f.output.currentTime, 1 + 1 / 30, 'Loop playback does not use the source search range');
    f.tick();
    assert.deepEqual(f.times.at(-1), { time: 1 + 1 / 30, mode: 'loop' });
});

test('Find playback waits for metadata and keeps invalid bounds out of the media element', async t => {
    const f = fixture(t);
    setSearchRange(f);
    f.state.info.duration = 0;
    f.source.currentTime = 1;
    await f.preview.play();
    f.preview.step(1);
    f.source.dispatch('ended');
    assert.equal(f.source.currentTime, 1);
    assert.equal(f.source.paused, true);
    f.state.info.duration = 60;
    f.state.opts = { from: 55, to: 80 };
    await f.preview.play();
    assert.equal(f.source.currentTime, 55);
    f.source.currentTime = 60;
    f.tick();
    assert.equal(f.source.currentTime, 55);
    f.preview.pause();
    f.state.opts.to = NaN;
    await f.preview.play();
    f.preview.step(1);
    assert.equal(f.source.currentTime, 55);
    assert.equal(f.source.paused, true);
});

test('Framed Original preserves transforms and excludes layers and loop effects', t => {
    const f = fixture(t), transforms = [];
    f.state.mode = 'composition';f.state.previewChoice = 'original';
    Object.assign(f.state.s,{width:180,height:180,fit:'contain',zoom:50,cropX:0,cropY:100,rotate:90,mirror:true,method:'pingpong',
        layers:[{type:'text',visible:true,placement:'below',text:'Excluded from Original'},{type:'text',visible:true,text:'Also excluded'}]});
    f.canvas.context.translate = (...values)=>transforms.push(['translate',...values]);
    f.canvas.context.scale = (...values)=>transforms.push(['scale',...values]);
    f.canvas.context.rotate = angle=>transforms.push(['rotate',angle]);
    f.preview.refresh();f.tick();
    assert.deepEqual(transforms,[['translate',135,720],['scale',-.75,.75],['rotate',Math.PI/2]]);
    assert.equal(f.canvas.pixel,'#2468ac');
    assert.match(f.transport.textContent,/\/ 00:03\.000$/,'Original uses the source range duration rather than doubled Ping-pong time');
    const dimensions=[f.canvas.width,f.canvas.height];
    f.state.render={width:180,height:180,duration:6,fps:30};f.state.mode='loop';f.state.previewChoice='result';
    f.preview.refresh();f.tick();assert.deepEqual([f.canvas.width,f.canvas.height],dimensions);
    assert.equal(f.canvas.pixel,'#64ac24');
});

test('Seam playback repeats tail and head while skipping the middle and stops on manual seeking', async t => {
    const f=fixture(t);await f.preview.playSeam();
    assert.equal(f.output.currentTime,2);assert.equal(f.preview.seamPreview,true);
    f.output.currentTime=.5;f.tick();assert.equal(f.output.currentTime,.5);
    f.output.currentTime=1.2;f.tick();assert.equal(f.output.currentTime,2);
    f.output.currentTime=2.5;f.tick();assert.equal(f.output.currentTime,2.5);
    f.preview.pause();assert.equal(f.preview.seamPreview,false);assert.equal(f.output.paused,true);
    await f.preview.playSeam();f.preview.seek(1,'loop');assert.equal(f.preview.seamPreview,false);
});

test('Short-cycle seam playback uses nonoverlapping head and tail windows', async t => {
    const f=fixture(t);f.state.render.duration=.6;f.output.duration=.6;
    await f.preview.playSeam();assert(Math.abs(f.output.currentTime-.4)<1e-9);
    f.output.currentTime=.25;f.tick();assert(Math.abs(f.output.currentTime-.4)<1e-9);
});
