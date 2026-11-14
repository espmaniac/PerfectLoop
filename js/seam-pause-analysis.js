import { openVideo,releaseVideo } from './media.js';
import { lumaCanvas,readLuma } from './frame-reader.js';
import { detectPause } from './seam-pause.js';

export async function analyzeSeamPause(url,settings,info,signal,onProgress=()=>{}) {
    const video=await openVideo(url,signal);
    try {
        const rate=info.fps||settings.fps,end=Math.min(settings.end,info.videoDuration||video.duration);
        const count=Math.floor((end-settings.start)*rate+1e-7);
        if(count<8)throw new Error('Select at least eight source frames to detect a pause.');
        const window=Math.min(Math.max(2,Math.floor(count*.2)),Math.max(2,Math.ceil(rate)),120);
        const ratio=Math.min(1,160/Math.max(settings.width,settings.height));
        const width=Math.max(1,Math.round(settings.width*ratio)),height=Math.max(1,Math.round(settings.height*ratio));
        const target=lumaCanvas(width,height),frames=new Map();
        const reference=[.2,.35,.5,.65,.8].map(f=>Math.min(count-2,Math.round(count*f)));
        const needed=new Set([...Array.from({length:window+4},(_,i)=>i),...Array.from({length:window+4},(_,i)=>count-1-i),...reference.flatMap(i=>[i,i+1])]);
        // No more than 258 boundary/reference frames are retained for high-FPS sources.
        for(const [i,index] of [...needed].entries()) {
            signal?.throwIfAborted();
            frames.set(index,await readLuma(video,Math.min(end-.001,settings.start+(index+.5)/rate),target,signal,settings));
            onProgress((i+1)/needed.size,'Checking motion at the beginning and end…');
        }
        const result=detectPause({frame:i=>frames.get(i),width,height,count,rate,window,reference});
        // Tile data is only needed while analyzing and should not enter app history.
        const compact=report=>report ? {score:report.score,velocity:report.velocity,motion:report.motion,detail:report.detail}:undefined;
        return {...result,baseline:compact(result.baseline),after:compact(result.after),sourceEnd:end};
    } finally {releaseVideo(video);}
}
