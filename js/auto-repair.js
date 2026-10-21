import { analyzeSeamPause } from './seam-pause-analysis.js';
import { pauseTrim, assessPauseRepair } from './seam-pause.js';
import { openVideo, seekVideo, releaseVideo } from './media.js';
import { framePlan, validate } from './logic.js';
import { analyzeLoopRepair } from './repair-analysis.js';
import { scoreBoundary, defectRegion, assessRepair } from './auto-repair-core.js';
import { captureBackgroundPatch } from './background-patch.js';
import { captureVideoPatch } from './video-patch-capture.js';
import { discardImportedImageLayer, videoPatchExportBytes, MAX_LAYERS } from './layers.js';

async function inspectResult(result, signal, reference) {
    const url=URL.createObjectURL(result.blob);let video;
    try {
        video=await openVideo(url,signal);
        const ratio=Math.min(1,160/result.width,240/result.height);
        const width=Math.max(1,Math.round(result.width*ratio)),height=Math.max(1,Math.round(result.height*ratio));
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true}),frames=[];
        const count=Math.max(8,Math.round(result.duration*result.fps));
        for(const index of [0,1,2,3,count-4,count-3,count-2,count-1]) {
            signal?.throwIfAborted();await seekVideo(video,Math.min(video.duration-.001,(index+.25)/result.fps),signal);
            ctx.drawImage(video,0,0,width,height);
            const pixels=ctx.getImageData(0,0,width,height).data;
            frames.push(Float32Array.from({length:width*height},(_,p)=>pixels[p*4]*.2126+pixels[p*4+1]*.7152+pixels[p*4+2]*.0722));
        }
        return scoreBoundary(frames,width,height,reference);
    } finally {if(video)releaseVideo(video);URL.revokeObjectURL(url);}
}

async function inspectPause(result,settings,signal,sourceRate) {
    const url=URL.createObjectURL(result.blob);
    try {
        return await analyzeSeamPause(url,{...settings,start:0,end:result.duration,width:result.width,height:result.height,
            fit:'contain',zoom:100,cropX:50,cropY:50,rotate:0,mirror:false,speed:1,fps:result.fps},
            {fps:Math.min(result.fps,sourceRate||result.fps),videoDuration:result.duration},signal);
    } finally {URL.revokeObjectURL(url);}
}

export function autoRepairCandidates(settings, analysis, mode, info={duration:settings.end}) {
    const candidates=[], plan=framePlan(settings);
    if(settings.method==='natural' && !settings.shift && (analysis.pause?.head || analysis.pause?.tail)) {
        try { candidates.push({label:mode==='keep'?'Remove seam pause (length preserved)':'Remove seam pause',pause:true,
            settings:pauseTrim({...settings,seamPause:null},analysis.pause.head,analysis.pause.tail,analysis.pause.rate,mode==='keep',info)}); }
        catch(error) {candidates.push({label:'Remove seam pause',unavailable:error.message,settings});}
    }
    const repair={version:1,brightness:analysis.brightness,shiftX:analysis.shiftX,shiftY:analysis.shiftY,strength:.75,
        flicker:analysis.flickerUseful,alignment:analysis.alignmentUseful};
    if(repair.flicker||repair.alignment) candidates.push({label:repair.flicker && repair.alignment ? 'Brightness and alignment correction' : repair.flicker ? 'Brightness correction' : 'Alignment correction',settings:{...settings,repair}});
    // Changing a reverse or shifted loop into a forward loop would change intent.
    if(['natural','crossfade','offset'].includes(settings.method) && !settings.shift) {
        const overlap=Math.max(2,Math.min(Math.round(.3*settings.fps),Math.floor(plan.frames*.1)));
        if(plan.frames>=12) {
            const transition=overlap/settings.fps;
            const speed=mode==='keep' ? (settings.end-settings.start)*settings.fps/(plan.outputFrames+overlap+1e-6) : settings.speed;
            if(settings.method!=='crossfade' || Math.abs(settings.transition-transition)>1/settings.fps || Math.abs(settings.speed-speed)>.001 || settings.repair)
                candidates.push({label:mode==='keep'?'Forward seam blend (length preserved)':'Forward seam blend',settings:{...settings,method:'crossfade',transition,speed,repair:null}});
        }
        if(mode==='trim' && analysis.cut) candidates.push({label:'Better loop boundaries',settings:{...settings,start:analysis.cut.start,end:analysis.cut.end,repair:null}});
    }
    return candidates;
}

// Candidate assets stay provisional until Apply. The caller owns cleanup afterward.
export async function autoRepair({file,url,settings,info,mode,engine,signal,onProgress=()=>{}}) {
    let patch=null, retained=null;
    const assets=[];
    try {
        signal.throwIfAborted();
        let sourceInfo=info;
        if(settings.method==='natural' && !settings.shift) {
            const metadata=info.videoDuration && info.fps ? info : await engine.inspect(file,(p,t,display)=>onProgress(p*.02,t,display));
            signal.throwIfAborted();sourceInfo={...info,...metadata};
            settings={...settings,end:Math.min(settings.end,sourceInfo.videoDuration||settings.end)};
        }
        const before=await engine.render(file,settings,info,(p,t,display)=>onProgress(p*.2,`Original: ${t}`,display),true,null,'high');
        signal.throwIfAborted();
        const baseline=await inspectResult(before,signal);
        const region=defectRegion(baseline);
        let pause=null;const trials=[];
        if(settings.method==='natural' && !settings.shift) {
            try {pause=await analyzeSeamPause(url,settings,sourceInfo,signal,(p,t)=>onProgress(.2+p*.05,t));}
            catch(error) {signal.throwIfAborted();trials.push({label:'Seam pause detection',reasons:[error.message]});}
        }
        if(baseline.excess<1 && baseline.score<2 && !pause?.head && !pause?.tail) return {before,best:null,baseline,region,trials,message:'No strong boundary defect was detected. Your settings have not changed.'};
        const analysis=await analyzeLoopRepair(url,settings,signal,(p,t)=>onProgress(.2+p*.1,t));
        const candidates=autoRepairCandidates(settings,{...analysis,pause},mode,info);
        if(region && settings.method==='natural' && !settings.shift && !settings.repair && settings.layers.length<MAX_LAYERS) {
            try {
                const background=await captureBackgroundPatch(url,settings,region,signal,(p,t)=>onProgress(.3+p*.05,t));
                assets.push(background);
                candidates.push({label:'Local background restoration',settings:{...settings,layers:[background,...settings.layers]},patch:background});
            } catch(error) {
                signal.throwIfAborted();
                if(error.name==='AbortError')throw error;
                trials.push({label:'Local background restoration',reasons:[error.message]});
            }
        }
        if(region && ['natural','crossfade','offset'].includes(settings.method) && !settings.shift && settings.end-settings.start<=8 && settings.layers.length<MAX_LAYERS) {
            const x=region.x*settings.width,y=region.y*settings.height,w=region.width*settings.width,h=region.height*settings.height;
            try {
                patch=await captureVideoPatch(url,settings,info,{points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],
                    feather:Math.min(12,Math.max(2,Math.round(settings.width*.008))),start:settings.start,end:settings.end},signal,
                    (p,t)=>onProgress(.35+p*.05,t));
                patch={...patch,name:'Auto repair patch',seamBlend:15};
                assets.push(patch);
                if(videoPatchExportBytes([patch,...settings.layers],settings)>256*1024**2) {
                    discardImportedImageLayer(patch);assets.splice(assets.indexOf(patch),1);patch=null;
                    trials.push({label:'Local video patch',reasons:['The detected region exceeds the full-resolution patch memory budget.']});
                } else candidates.push({label:'Local video patch',settings:{...settings,layers:[patch,...settings.layers]},patch});
            } catch(error) {
                signal.throwIfAborted();
                if(error.name==='AbortError') throw error;
                trials.push({label:'Local video patch',reasons:[error.message]});
            }
        }
        let best=null, renderedPauseBefore=null;
        const preferPause=baseline.excess<=baseline.temporal+baseline.velocity*.35;
        for(const [index,candidate] of candidates.entries()) {
            signal.throwIfAborted();
            if(candidate.unavailable) {trials.push({label:candidate.label,reasons:[candidate.unavailable]});continue;}
            const issues=validate(candidate.settings,info);
            if(videoPatchExportBytes(candidate.settings.layers,candidate.settings)>256*1024**2) issues.push('This candidate exceeds the full-resolution patch memory budget.');
            if(issues.length) {trials.push({label:candidate.label,reasons:issues});continue;}
            try {
                const result=await engine.render(file,candidate.settings,info,(p,t,display)=>onProgress(.4+.6*(index+p)/candidates.length,`${candidate.label}: ${t}`,display),true,null,'high');
                signal.throwIfAborted();
                const score=await inspectResult(result,signal,baseline);
                let pauseAfter;
                if(candidate.pause) {
                    renderedPauseBefore ||= await inspectPause(before,settings,signal,sourceInfo.fps);
                    pauseAfter=await inspectPause(result,candidate.settings,signal,sourceInfo.fps);
                }
                const decision=(candidate.pause ? assessPauseRepair : assessRepair)(baseline,score,mode,framePlan(settings).outputFrames,framePlan(candidate.settings).outputFrames,renderedPauseBefore,pauseAfter);
                trials.push({label:candidate.label,...decision});
                // Prefer a localized edit when its measured improvement is effectively tied.
                const localTie=best && !best.pause && candidate.patch && !best.patch && decision.improvement>=best.improvement-.03;
                if(decision.accepted && !(best?.pause && preferPause && !candidate.pause) && (!best||score.score<best.score.score||localTie||(candidate.pause&&preferPause))) best={...candidate,result,score,improvement:decision.improvement};
            } catch(error) {
                signal.throwIfAborted();
                if(error.name==='AbortError') throw error;
                trials.push({label:candidate.label,reasons:[error.message]});
            }
        }
        signal.throwIfAborted();
        retained=best?.patch;
        return {before,best,baseline,region,trials,message:best?'A candidate improved the sampled seam checks. Watch both loops before applying.':'No candidate passed the improvement checks. Keep the original and try a manual patch or another range.'};
    } finally {for(const asset of assets)if(asset!==retained)discardImportedImageLayer(asset);}
}
