import { openVideo,seekVideo,releaseVideo } from './media.js';
import { videoTransform } from './framing.js';
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
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true}),frames=new Map();
        const reference=[.2,.35,.5,.65,.8].map(f=>Math.min(count-2,Math.round(count*f)));
        const needed=new Set([...Array.from({length:window+4},(_,i)=>i),...Array.from({length:window+4},(_,i)=>count-1-i),...reference.flatMap(i=>[i,i+1])]);
        // No more than 258 boundary/reference frames are retained for high-FPS sources.
        for(const [i,index] of [...needed].entries()) {
            signal?.throwIfAborted();
            await seekVideo(video,Math.min(end-.001,settings.start+(index+.5)/rate),signal);
            ctx.fillStyle=settings.background;ctx.fillRect(0,0,width,height);
            const t=videoTransform(settings,video.videoWidth,video.videoHeight,width,height);
            ctx.save();ctx.translate(width/2+t.offsetX,height/2+t.offsetY);ctx.scale(settings.mirror?-t.sx:t.sx,t.sy);
            ctx.rotate(settings.rotate*Math.PI/180);ctx.drawImage(video,-video.videoWidth/2,-video.videoHeight/2);ctx.restore();
            const rgba=ctx.getImageData(0,0,width,height).data;
            frames.set(index,Float32Array.from({length:width*height},(_,p)=>rgba[p*4]*.2126+rgba[p*4+1]*.7152+rgba[p*4+2]*.0722));
            onProgress((i+1)/needed.size,'Checking motion at the beginning and end…');
        }
        const result=detectPause({frame:i=>frames.get(i),width,height,count,rate,window,reference});
        // Tile data is only needed while analyzing and should not enter app history.
        const compact=report=>report ? {score:report.score,velocity:report.velocity,motion:report.motion,detail:report.detail}:undefined;
        return {...result,baseline:compact(result.baseline),after:compact(result.after),sourceEnd:end};
    } finally {releaseVideo(video);}
}
