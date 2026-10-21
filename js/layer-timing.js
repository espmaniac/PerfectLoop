import {clamp, framePlan} from './logic.js';

export function layerInterval(layer, duration) {
    const start=clamp(layer.startTime ?? 0,0,duration);
    const end=clamp(layer.endTime ?? duration,0,duration);
    return {start,end,visible:end>start};
}

// Timeline edits snap to finished frames; numeric Active time fields can retain
// subframe values until the user edits that edge on the timeline.
export function adjustLayerTiming(layer, kind, deltaFrames, settings) {
    const {duration,outputFrames}=framePlan(settings),fps=settings.fps;
    if(!Number.isFinite(duration)||duration<=0||!Number.isInteger(fps)||fps<=0||!Number.isInteger(deltaFrames)||!deltaFrames)return null;
    const interval=layerInterval(layer,duration);
    if(!interval.visible)return null;
    const a=clamp(Math.round(interval.start*fps),0,outputFrames-1);
    const b=clamp(Math.round(interval.end*fps),a+1,outputFrames);
    let partial;
    if(kind==='start')partial={startTime:clamp(a+deltaFrames,0,b-1)/fps};
    else if(kind==='end') {
        const end=clamp(b+deltaFrames,a+1,outputFrames);
        partial={endTime:end===outputFrames?null:end/fps};
    } else if(kind==='move') {
        const start=clamp(a+deltaFrames,0,outputFrames-(b-a)),end=start+b-a;
        partial={startTime:start/fps,endTime:end===outputFrames?null:end/fps};
    } else return null;
    return Object.entries(partial).some(([key,value])=>value!==(layer[key] ?? (key==='startTime'?0:null))) ? partial:null;
}

// A live draft shows a source frame, not the final blend/repair. Map finished
// time back to its primary source frame so reverse and shifted cycles scrub in
// the correct part of the source while layer timing uses the finished clock.
export function loopSourceTime(settings, time) {
    const {frames,overlap,outputFrames}=framePlan(settings);
    let index=clamp(Math.floor(time*settings.fps+1e-7),0,outputFrames-1);
    index=(index+Math.round(outputFrames*settings.shift/100))%outputFrames;
    if(settings.method==='crossfade'||settings.method==='offset')index+=overlap;
    else if(settings.method.includes('pingpong')) {
        if(index>=frames)index=2*frames-2-index;
        if(settings.method==='smooth-pingpong')index=Math.round((1-Math.cos(Math.PI*index/(frames-1)))*(frames-1)/2);
    }
    return clamp(settings.start+(index+.5)*settings.speed/settings.fps,settings.start,Math.max(settings.start,settings.end-.001));
}
