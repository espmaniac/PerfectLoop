import { validateLayers, videoPatchExportBytes } from './layers.js';
import { METHODS } from './constants.js';
import { clamp, framePlan, validate } from './logic.js';

function overlayIssues(settings) {
    const layers = settings.layers || [];
    const issues = validateLayers(layers,settings);
    if (!issues.length && videoPatchExportBytes(layers,settings)>256*1024**2)
        issues.push('Video patches exceed the full-resolution export memory budget.');
    return issues;
}

export function methodContext(settings) {
    const keys = ['start','end','speed','transition','curve','fps','width','height','fit','zoom','cropX','cropY','rotate','mirror','background','interpolate','preset','format','repeats','wallpaperPoster'];
    return JSON.stringify([keys.map(key => [key,settings[key]]), METHODS.map(method => overlayIssues({...settings,method:method.id}))]);
}

export function methodTrials(settings, info) {
    return METHODS.map(method => {
        const trial = { ...settings, method: method.id, shift: method.id === 'offset' ? 50 : 0, repair: null };
        return { id: method.id, name: method.name, settings: trial, duration: framePlan(trial).duration,
            unavailable: [...validate(trial,info),...overlayIssues(trial)].join(' ') };
    });
}

export function frameDetail(frame, width) {
    let detail = 0;
    for (let p = width; p < frame.length; p++) {
        if (p % width) detail += Math.abs(frame[p]-frame[p-1]);
        detail += Math.abs(frame[p]-frame[p-width]);
    }
    return detail / Math.max(1,frame.length*2);
}

export function localDifference(a, b, width, height) {
    const tiles = [];
    for (let y=0;y<height;y+=12) for (let x=0;x<width;x+=12) {
        let sum=0,count=0;
        for (let j=y;j<Math.min(y+12,height);j++) for (let i=x;i<Math.min(x+12,width);i++) {
            sum += Math.abs(a[j*width+i]-b[j*width+i]); count++;
        }
        tiles.push(sum/count);
    }
    tiles.sort((a,b)=>b-a);
    const strongest=tiles.slice(0,Math.max(1,Math.ceil(tiles.length*.2)));
    return strongest.reduce((a,b)=>a+b,0)/strongest.length;
}

// Evaluate the whole cycle, including internal joins and transition artifacts.
// A perfect file boundary alone must not reward a dissolve or black frame.
export function methodFit(id, measurements) {
    const { boundaryError, internalError=0, ordinaryError=0, ghostRisk=0, detailLoss=0, darkening=0, motionRetention=1 } = measurements;
    const continuityError=Math.max(boundaryError,Math.max(0,internalError-ordinaryError));
    const seamFit=100*Math.exp(-boundaryError/25);
    const continuityFit=100*Math.exp(-continuityError/25);
    const reversal=id==='pingpong'||id==='smooth-pingpong';
    const effectCost=reversal?12:id==='fade'?8:id==='natural'?0:2;
    const artifactCost=ghostRisk*.6 + detailLoss*25 + darkening*30 + (1-clamp(motionRetention,0,1))*12;
    return { score:clamp(continuityFit-artifactCost-effectCost,0,100), seamFit,
        detail:100*(1-clamp(detailLoss,0,1)), motion:100*clamp(motionRetention,0,1), ghostRisk, darkening:darkening*100,
        effect:reversal?'Reverses motion':id==='fade'?'Fades through black':id==='natural'?'Original forward motion':'Forward dissolve' };
}

export function recommendMethod(rows) {
    const valid=rows.filter(row=>!row.unavailable && Number.isFinite(row.score));
    if (!valid.length) return null;
    const best=[...valid].sort((a,b)=>b.score-a.score)[0];
    const natural=valid.find(row=>row.id==='natural');
    // Avoid changing an already good cycle for an insignificant estimated gain.
    return natural && best.score-natural.score<=4 ? natural : best;
}
