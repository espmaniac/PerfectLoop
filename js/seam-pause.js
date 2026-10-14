import { framePlan, validate } from './logic.js';
import { scoreBoundary } from './auto-repair-core.js';

const mean = xs => xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length);
const median = xs => { const sorted=[...xs].sort((a,b)=>a-b); return sorted[Math.floor(sorted.length/2)] || 0; };

// Local frame activity, discounted for a uniform exposure change. A static
// background must not drown out moving details; exact duplicates are not required.
export function pauseActivity(a,b,width,height) {
    let brightness=0;
    for(let p=0;p<a.length;p++)brightness+=b[p]-a[p];
    brightness/=a.length;
    const tiles=[];
    for(let y=0;y<height;y+=12)for(let x=0;x<width;x+=12) {
        let sum=0,count=0;
        for(let j=y;j<Math.min(y+12,height);j++)for(let i=x;i<Math.min(x+12,width);i++) {
            const p=j*width+i;sum+=Math.abs(b[p]-a[p]-brightness);count++;
        }
        tiles.push(sum/count);
    }
    tiles.sort((a,b)=>b-a);
    return mean(tiles.slice(0,Math.max(1,Math.ceil(tiles.length*.2))));
}

export function lowActivityRun(activity, reference) {
    if(reference<.15)return 0;
    let count=0;
    for(let i=0;i<activity.length;i++) {
        // Isolated duplicate frames from FPS conversion are not a held segment.
        if(median(activity.slice(i,i+3))>=reference*.45) {
            if(count && activity[i]<reference*.45)count++;
            break;
        }
        count++;
    }
    return count;
}

export function pauseBasis(settings) {
    const p=settings.seamPause;
    return p?.base && p?.applied && ['start','end','speed'].every(key=>Math.abs(settings[key]-p.applied[key])<1e-7) ? p : null;
}

export function pauseTrim(settings, head, tail, rate, keep, info) {
    const prior=pauseBasis(settings), base=prior?.base || {start:settings.start,end:settings.end,speed:settings.speed};
    if(!Number.isFinite(rate)||rate<=0||![head,tail].every(n=>Number.isInteger(n)&&n>=0))throw new Error('Choose whole, nonnegative frame counts.');
    const start=base.start+head/rate,end=base.end-tail/rate;
    if(!(end>start))throw new Error('Leave at least three output frames after trimming.');
    const original={...settings,...base}, count=framePlan(original).frames;
    const speed=keep ? (end-start)*settings.fps/count : base.speed;
    const applied={start,end,speed}, next={...settings,...applied,repair:['start','end','speed'].some(key=>Math.abs(settings[key]-applied[key])>1e-7)?null:settings.repair};
    if(!head&&!tail) {next.speed=base.speed;next.seamPause=null;}
    else next.seamPause={base,applied,head,tail,rate,keep};
    const issues=validate(next,info);
    if(issues.length)throw new Error(issues[0]);
    return next;
}

export function detectPause({frame,width,height,count,rate,window,reference}) {
    const changes=indices=>indices.map(i=>pauseActivity(frame(i),frame(i+1),width,height));
    const ref=median(reference.map(i=>pauseActivity(frame(i),frame(i+1),width,height)));
    const headChanges=changes(Array.from({length:window},(_,i)=>i));
    const tailChanges=changes(Array.from({length:window},(_,i)=>count-window-1+i)).reverse();
    const head=lowActivityRun(headChanges,ref),tail=lowActivityRun(tailChanges,ref);
    const boundary=(h,t)=>scoreBoundary([0,1,2,3].map(i=>frame(h+i)).concat([4,3,2,1].map(i=>frame(count-t-i))),width,height);
    const baseline=boundary(0,0), result={head:0,tail:0,rawHead:head,rawTail:tail,rate,reference:ref,headActivity:mean(headChanges.slice(0,4)),tailActivity:mean(tailChanges.slice(0,4)),baseline,
        message:ref<.15?'Not enough motion to identify a seam pause.':'No sustained seam pause detected.'};
    if(!head&&!tail)return result;
    if(head===window||tail===window) {result.message='The slow section reaches the scan limit. Adjust the trim manually.';return result;}
    if(head+tail>Math.floor(count*.2)||count-head-tail<8) {result.message='The slow section is too long for a safe automatic trim. Adjust the frame counts manually.';return result;}
    let best=null;
    const options=n=>n ? Array.from({length:5},(_,i)=>n-2+i).filter(i=>i>0&&i<window) : [0];
    for(const h of options(head))for(const t of options(tail)) {
        if(h+t>count*.2||count-h-t<8)continue;
        const after=boundary(h,t);
        if(after.score>baseline.score+Math.max(.75,baseline.score*.15)||after.velocity>baseline.velocity*1.2+.5)continue;
        const beginning=mean(changes([h,h+1,h+2]));
        const ending=mean(changes([count-t-4,count-t-3,count-t-2]));
        const cost=after.score+Math.max(0,ref-Math.min(beginning,ending))*.5+Math.abs(beginning-ending)*.1;
        if(!best||cost<best.cost)best={head:h,tail:t,after,cost};
    }
    if(!best) {
        result.message='A slow section was found, but trimming it worsens the sampled join. Adjust manually and preview the seam.';return result;
    }
    return {...result,head:best.head,tail:best.tail,after:best.after,seconds:(best.head+best.tail)/rate,
        message:`Suggested trim: ${best.head} start frames and ${best.tail} end frames. Preview the seam before applying to an export.`};
}

export function assessPauseRepair(before,after,mode,beforeFrames,afterFrames,pauseBefore,pauseAfter) {
    const reasons=[];
    if(mode==='keep'&&beforeFrames!==afterFrames)reasons.push('The output length changed.');
    if(mode==='trim'&&(afterFrames>beforeFrames||afterFrames<beforeFrames*.8))reasons.push('The trim exceeds the allowed duration change.');
    if(after.detail<before.detail*.88)reasons.push('Fine detail became softer.');
    if(after.score>before.score+Math.max(.75,before.score*.15)||after.velocity>before.velocity*1.2+.5)reasons.push('The trimmed join became less continuous.');
    if(pauseBefore && pauseAfter) {
        const held=p=>(p.rawHead+p.rawTail)/p.rate;
        const deficit=p=>Math.max(0,.75-p.headActivity/Math.max(.01,p.reference))+Math.max(0,.75-p.tailActivity/Math.max(.01,p.reference));
        const fewerHeld=held(pauseBefore)>0 && held(pauseAfter)<=held(pauseBefore)*.7;
        const lessSlow=deficit(pauseBefore)>.1 && deficit(pauseAfter)<=deficit(pauseBefore)*.7;
        if(!fewerHeld&&!lessSlow)reasons.push('The rendered seam pause did not improve enough.');
        if(pauseAfter.reference<pauseBefore.reference*.6 || after.motion<before.motion*.6)reasons.push('Motion became too slow.');
    } else if(after.motion<Math.max(.1,before.motion*1.25))reasons.push('Boundary motion did not improve enough.');
    const improvement=Math.max(0,(after.motion-before.motion)/Math.max(.1,after.motion));
    return {accepted:!reasons.length,improvement,reasons};
}
