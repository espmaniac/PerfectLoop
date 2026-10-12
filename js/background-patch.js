import { openVideo, seekVideo, releaseVideo } from './media.js';
import { drawFrame } from './preview.js';
import { importVideoPatch, videoPatchBytes } from './layers.js';
import { framePlan } from './logic.js';
import { backgroundModel, boundaryOpacity } from './background-repair.js';

export async function captureBackgroundPatch(url, settings, region, signal, onProgress=()=>{}) {
    const left=Math.floor(region.x*settings.width),top=Math.floor(region.y*settings.height);
    const width=Math.min(settings.width-left,Math.ceil(region.width*settings.width));
    const height=Math.min(settings.height-top,Math.ceil(region.height*settings.height));
    const duration=framePlan(settings).outputFrames/settings.fps;
    // Only opacity changes; the layer renderer interpolates these alpha keyframes.
    const count=Math.max(8,Math.ceil(duration*8));
    // Includes retained donor pixels as well as the generated patch bitmaps.
    if((count+17)*width*height*4+videoPatchBytes()>64*1024**2)
        throw new Error('Local background repair exceeds the patch memory budget.');
    const frame=document.createElement('canvas');frame.width=settings.width;frame.height=settings.height;
    const crop=document.createElement('canvas');crop.width=width;crop.height=height;
    const ctx=crop.getContext('2d',{willReadFrequently:true});
    const small=document.createElement('canvas');small.width=Math.min(64,width);small.height=Math.max(1,Math.round(height*small.width/width));
    const smallCtx=small.getContext('2d',{willReadFrequently:true});
    let video,bitmaps=[];
    try {
        video=await openVideo(url,signal);
        const donors=[],samples=[];
        for(let i=0;i<17;i++) {
            signal.throwIfAborted();
            const time=settings.start+i/16*Math.max(0,settings.end-settings.start-settings.speed/settings.fps);
            await seekVideo(video,time,signal);
            if(!drawFrame(frame,video,settings,false))throw new Error('The source frame could not be decoded.');
            ctx.clearRect(0,0,width,height);ctx.drawImage(frame,left,top,width,height,0,0,width,height);
            donors.push(ctx.getImageData(0,0,width,height).data);
            smallCtx.drawImage(crop,0,0,small.width,small.height);
            samples.push(smallCtx.getImageData(0,0,small.width,small.height).data);
            onProgress((i+1)/34,'Finding repeatedly visible background…');
        }
        const model=backgroundModel(samples,small.width,small.height);
        if(model.coverage<.002)throw new Error('No reliable exposed background was found beneath the boundary defect.');
        if(model.coverage>.4)throw new Error('The changing area is too large for a conservative background repair.');
        const plate=ctx.createImageData(width,height);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
            const p=y*width+x,q=Math.floor(y*small.height/height)*small.width+Math.floor(x*small.width/width);
            const index=model.donor[q];if(index<0)continue;
            for(let c=0;c<3;c++)plate.data[p*4+c]=donors[index][p*4+c];
            plate.data[p*4+3]=Math.round(255*model.mask[q]);
        }
        const alpha=Uint8Array.from({length:width*height},(_,p)=>plate.data[p*4+3]);
        for(let i=0;i<count;i++) {
            signal.throwIfAborted();const opacity=boundaryOpacity(i/count,duration);
            for(let p=0;p<alpha.length;p++)plate.data[p*4+3]=Math.round(alpha[p]*opacity);
            ctx.putImageData(plate,0,0);bitmaps.push(await createImageBitmap(crop));
            onProgress(.5+(i+1)/count*.5,'Building a local boundary mask…');
        }
        signal.throwIfAborted();
        const layer=importVideoPatch(bitmaps,{name:'Boundary background repair',sourceStart:settings.start,sourceEnd:settings.end,
            width:width/settings.width*100,x:(left+width/2)/settings.width*100,y:(top+height/2)/settings.height*100,
            startTime:0,endTime:null,seamBlend:0});
        bitmaps=[];return layer;
    } finally {
        if(video)releaseVideo(video);bitmaps.forEach(f=>f.close());
        for(const canvas of [frame,crop,small])canvas.width=canvas.height=1;
    }
}
