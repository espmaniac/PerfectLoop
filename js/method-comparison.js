import { openVideo, seekVideo, releaseVideo } from './media.js';
import { framePlan } from './logic.js';
import { scoreBoundary } from './auto-repair-core.js';
import { methodContext, methodTrials, methodFit, recommendMethod, localDifference, frameDetail } from './method-fit.js';

async function reader(result, signal) {
    const url=URL.createObjectURL(result.blob);
    let video;
    try {
        video=await openVideo(url,signal);
        const width=result.width,height=result.height,count=result.frames;
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true}),cache=new Map();
        const frame=async index=>{
            signal.throwIfAborted();
            index=((index%count)+count)%count;
            if(cache.has(index))return cache.get(index);
            await seekVideo(video,Math.min(video.duration-.001,(index+.5)/result.fps),signal);
            ctx.drawImage(video,0,0,width,height);
            const rgba=ctx.getImageData(0,0,width,height).data;
            const pixels=Float32Array.from({length:width*height},(_,p)=>rgba[p*4]*.2126+rgba[p*4+1]*.7152+rgba[p*4+2]*.0722);
            if(cache.size>=96)cache.delete(cache.keys().next().value);
            cache.set(index,pixels);return pixels;
        };
        const boundary=async (index,reference)=>{
            const frames=[];
            for(const offset of [0,1,2,3,-4,-3,-2,-1])frames.push(await frame(index+offset));
            return scoreBoundary(frames,width,height,reference);
        };
        return {frame,boundary,width,height,count,close:()=>{releaseVideo(video);URL.revokeObjectURL(url);}};
    } catch(error) { if(video)releaseVideo(video);URL.revokeObjectURL(url);throw error; }
}

export async function compareLoopMethods({file,settings,info,engine,signal,onProgress=()=>{}}) {
    signal.throwIfAborted();
    const rows=methodTrials(settings,info),ratio=Math.min(1,Math.max(160/Math.max(settings.width,settings.height),16/Math.min(settings.width,settings.height)));
    const width=Math.max(16,Math.round(settings.width*ratio/2)*2),height=Math.max(16,Math.round(settings.height*ratio/2)*2);
    const plan=framePlan({...settings,method:'natural'});
    // Comparison examines framed source motion. Layers and repairs stay untouched.
    const reduced=trial=>({...trial,preset:'custom',width,height,format:'mp4',audio:'strip',quality:'high',repeats:1,targetMB:0,layers:[],repair:null});
    let original;
    try {
        const baseline=await engine.render(file,reduced({...settings,method:'natural',shift:0}),info,(p,t,display)=>onProgress(p*.15,`Reference: ${t}`,display));
        signal.throwIfAborted();original=await reader(baseline,signal);
        const originalBoundary=await original.boundary(0);
        let ordinaryError=0;
        for(const fraction of [.2,.4,.6,.8]) ordinaryError=Math.max(ordinaryError,(await original.boundary(Math.round(fraction*original.count))).score);
        for(const [i,row] of rows.entries()) {
            signal.throwIfAborted();
            if(row.unavailable)continue;
            let processed;
            try {
                if(row.id==='natural')processed=original;
                else {
                    const result=await engine.render(file,reduced(row.settings),info,(p,t,display)=>onProgress(.15+(i+p)/rows.length*.8,`${row.name}: ${t}`,display));
                    signal.throwIfAborted();processed=await reader(result,signal);
                }
                const boundaryReport=await processed.boundary(0,originalBoundary);
                const boundaryError=boundaryReport.score;
                const motionRetention=originalBoundary.motion>.25 ? Math.min(1,boundaryReport.motion/originalBoundary.motion) : 1;
                const points=[.25,.5,.75].map(f=>Math.round(f*processed.count));
                const blended=['crossfade','offset'].includes(row.id),shift=Math.round(processed.count*row.settings.shift/100);
                const cycleIndex=index=>((index-shift)%processed.count+processed.count)%processed.count;
                let ghostRisk=0,detailLoss=0,darkening=0;
                if(blended) {
                    const k=framePlan(row.settings).overlap,join=plan.frames-2*k;
                    points.push(cycleIndex(join),cycleIndex(join+Math.floor(k/2)));
                    for(const fraction of [.25,.5,.75]) {
                        const offset=Math.min(k-1,Math.round((k-1)*fraction));
                        const a=await original.frame(plan.frames-k+offset),b=await original.frame(offset);
                        const mixed=await processed.frame(cycleIndex(join+offset));
                        ghostRisk=Math.max(ghostRisk,localDifference(a,b,width,height)/255*100);
                        const reference=(frameDetail(a,width)+frameDetail(b,width))/2;
                        if(reference>.1)detailLoss=Math.max(detailLoss,1-frameDetail(mixed,width)/reference);
                    }
                } else if(row.id.includes('pingpong')) {
                    points.push(plan.frames-1);
                } else if(row.id==='fade') {
                    for(const index of [0,processed.count-1]) {
                        const a=await original.frame(index),b=await processed.frame(index);
                        const luminance=frame=>frame.reduce((sum,value)=>sum+value,0)/frame.length;
                        const reference=luminance(a);
                        if(reference>5)darkening=Math.max(darkening,1-luminance(b)/reference);
                        const detail=frameDetail(a,width);
                        if(detail>.1)detailLoss=Math.max(detailLoss,1-frameDetail(b,width)/detail);
                    }
                }
                let internalError=0;
                for(const point of points)internalError=Math.max(internalError,(await processed.boundary(point)).score);
                Object.assign(row,methodFit(row.id,{boundaryError,internalError,ordinaryError,ghostRisk,motionRetention,detailLoss:Math.max(0,detailLoss),darkening:Math.max(0,darkening)}));
            } catch(error) {
                signal.throwIfAborted();
                row.unavailable=error.message;
            } finally {if(processed && processed!==original)processed.close();}
            onProgress(.15+(i+1)/rows.length*.8,`${row.name} checked`);
        }
        signal.throwIfAborted();
        return {context:methodContext(settings),rows,recommended:recommendMethod(rows)?.id || null};
    } finally {original?.close();}
}
