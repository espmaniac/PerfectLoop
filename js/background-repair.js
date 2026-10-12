// Only use background colors actually observed repeatedly at the same location.
// This deliberately refuses moving backgrounds and persistent occlusions.
export function backgroundModel(frames, width, height) {
    const pixels=width*height;
    if(frames.length<9 || frames.some(f=>f.length!==pixels*4)) throw new Error('Not enough background samples.');
    const donor=new Int16Array(pixels).fill(-1), mask=new Float32Array(pixels);
    const distance=(a,b,p)=>Math.max(...[0,1,2].map(c=>Math.abs(a[p*4+c]-b[p*4+c])));
    for(let p=0;p<pixels;p++) {
        let best=-1,support=0;
        for(let i=1;i<frames.length-1;i++) {
            let count=0;
            for(let j=1;j<frames.length-1;j++) if(distance(frames[i],frames[j],p)<12) count++;
            if(count>support){support=count;best=i;}
        }
        if(support<(frames.length-2)*.75) continue;
        donor[p]=best;
        const jump=distance(frames[0],frames.at(-1),p);
        const foreground=Math.max(distance(frames[0],frames[best],p),distance(frames.at(-1),frames[best],p));
        if(jump>22 && foreground>25) mask[p]=1;
    }
    // Expand thin object edges, then feather only inside confirmed background.
    const expanded=new Float32Array(pixels),soft=new Float32Array(pixels);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++) {
            const xx=x+dx,yy=y+dy;
            if(xx>=0&&xx<width&&yy>=0&&yy<height&&mask[yy*width+xx])expanded[y*width+x]=1;
        }
    }
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        let sum=0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
            const xx=x+dx,yy=y+dy;
            if(xx>=0&&xx<width&&yy>=0&&yy<height)sum+=expanded[yy*width+xx];
        }
        if(donor[y*width+x]>=0)soft[y*width+x]=sum/9;
    }
    return {donor,mask:soft,coverage:soft.reduce((a,b)=>a+b,0)/pixels};
}

export function boundaryOpacity(phase, duration) {
    const distance=Math.min(phase,1-phase)*duration;
    const window=Math.min(.4,duration*.15);
    return distance>=window?0:(1+Math.cos(Math.PI*distance/window))/2;
}
