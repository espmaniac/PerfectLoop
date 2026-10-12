import { openVideo, releaseVideo, seekVideo } from './media.js';
import { drawFrame } from './preview.js';
import { extractPatch, selectionBounds } from './patch.js';
import { patchCapturePlan } from './video-patch.js';
import { importVideoPatch, videoPatchBytes } from './layers.js';

export async function captureVideoPatch(url, settings, info, selection, signal, onProgress=()=>{}) {
    const { points, feather, start, end }=selection;
    const padding=feather>0 ? 3*Math.max(1,Math.round(feather/3))+1 : 0;
    const bounds=selectionBounds(points,settings.width,settings.height,padding);
    const plan=patchCapturePlan(start,end,info.duration,info.fps||settings.fps,bounds.width,bounds.height,videoPatchBytes());
    const frame=document.createElement('canvas');frame.width=settings.width;frame.height=settings.height;
    let video, frames=[];
    try {
        video=await openVideo(url,signal);
        for(const [i,time] of plan.times.entries()) {
            signal?.throwIfAborted();await seekVideo(video,time,signal);
            if(!drawFrame(frame,video,settings,false)) throw new Error('The source frame could not be decoded.');
            const crop=extractPatch(frame,points,feather);
            frames.push(await createImageBitmap(crop.canvas));crop.canvas.width=crop.canvas.height=1;
            signal?.throwIfAborted();onProgress((i+1)/plan.count,`Reading video patch frame ${i+1} of ${plan.count}…`);
        }
        const layer=importVideoPatch(frames,{sourceStart:start,sourceEnd:end,
            width:bounds.width/settings.width*100,x:(bounds.left+bounds.width/2)/settings.width*100,
            y:(bounds.top+bounds.height/2)/settings.height*100,startTime:0,endTime:null});
        frames=[];return layer;
    } finally {if(video)releaseVideo(video);frames.forEach(f=>f.close?.());frame.width=frame.height=1;}
}
