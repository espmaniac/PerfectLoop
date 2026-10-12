// Small spatial tiles prevent a mostly static background from hiding a local jump.
const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const topMean = values => mean([...values].sort((a,b) => b-a).slice(0, Math.max(1, Math.ceil(values.length * .2))));
export function scoreBoundary(frames, width, height, reference) {
    if (frames.length < 8 || frames.some(frame => frame.length !== width * height)) throw new Error('Not enough boundary frames.');
    // First four frames followed by last four, in chronological order.
    const first = frames[0], next = frames[1], last = frames[7], previous = frames[6];
    const tiles = [], size = 12;
    let detail = 0, motion = 0, samples = 0;
    for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
        let jump = 0, ordinary = 0, acceleration = 0, count = 0;
        for (let j = y; j < Math.min(height,y+size); j++) for (let i = x; i < Math.min(width,x+size); i++) {
            const p = j*width+i, seam = first[p]-last[p];
            const before = last[p]-previous[p], after = next[p]-first[p];
            jump += Math.abs(seam); ordinary += (Math.abs(before)+Math.abs(after))/2;
            acceleration += Math.abs(seam-(before+after)/2); count++;
        }
        tiles.push({ x, y, width: Math.min(size,width-x), height: Math.min(size,height-y), jump: jump/count,
            excess: Math.max(0,(jump-ordinary*1.5)/count), motion: acceleration/count });
    }
    const focus=(reference?.tiles || tiles).filter(t=>t.excess>Math.max(2.5,(reference?.excess||topMean(tiles.map(t=>t.excess)))*.6));
    const selected=focus.length?focus:tiles;
    const indices=[];
    for(const tile of selected) for(let y=Math.max(1,tile.y);y<tile.y+tile.height;y++) for(let x=Math.max(1,tile.x);x<tile.x+tile.width;x++) indices.push(y*width+x);
    for (const frame of frames) for (const p of indices) {
        detail += Math.abs(frame[p]-frame[p-1])+Math.abs(frame[p]-frame[p-width]); samples++;
    }
    for(let k=1;k<frames.length;k++) if(k!==4) motion += mean(indices.map(p=>Math.abs(frames[k][p]-frames[k-1][p])));
    const excess = topMean(tiles.map(t=>t.excess));
    const jump = topMean(tiles.map(t=>t.jump)), velocity = topMean(tiles.map(t=>t.motion));
    return { score: excess + velocity*.35, excess, jump, velocity, detail: detail/Math.max(1,samples), motion: motion/6, tiles, width, height };
}

export function defectRegion(report) {
    const threshold = Math.max(2.5, report.excess*.6);
    const tiles = report.tiles.filter(t=>t.excess>threshold);
    if (!tiles.length) return null;
    // Separate distant defects instead of covering the entire scene with one patch.
    const pending=new Set(tiles), groups=[];
    while(pending.size) {
        const first=pending.values().next().value,group=[first];pending.delete(first);
        for(let i=0;i<group.length;i++)for(const tile of [...pending]) {
            if(Math.abs(tile.x-group[i].x)<=12 && Math.abs(tile.y-group[i].y)<=12){group.push(tile);pending.delete(tile);}
        }
        groups.push(group);
    }
    // Prioritize defect intensity rather than area, so small moving objects are not
    // displaced by a much larger region with a mild background mismatch.
    groups.sort((a,b)=>mean(b.map(t=>t.excess))-mean(a.map(t=>t.excess)));
    for(const group of groups) {
        const left=Math.max(0,Math.min(...group.map(t=>t.x))-6), top=Math.max(0,Math.min(...group.map(t=>t.y))-6);
        const right=Math.min(report.width,Math.max(...group.map(t=>t.x+t.width))+6);
        const bottom=Math.min(report.height,Math.max(...group.map(t=>t.y+t.height))+6);
        const region={x:left/report.width,y:top/report.height,width:(right-left)/report.width,height:(bottom-top)/report.height};
        if(region.width*region.height<=.35)return region;
    }
    return null;
}

// A score is a screening heuristic, not a probability of a seamless result.
// Do not reward a frozen/blurred dissolve solely for matching endpoint pixels.
export function assessRepair(before, after, mode, beforeFrames, afterFrames) {
    const reasons=[];
    if (mode==='keep' && beforeFrames!==afterFrames) reasons.push('The output length changed.');
    if (mode==='trim' && afterFrames>beforeFrames) reasons.push('The output became longer.');
    if (mode==='trim' && afterFrames<beforeFrames*.8) reasons.push('More than 20% of the loop was removed.');
    if (after.detail < before.detail*.88) reasons.push('Fine detail became softer near the seam.');
    if (before.motion>0.25 && after.motion<before.motion*.6) reasons.push('Motion became too slow near the seam.');
    if (after.velocity>before.velocity*1.05+.25) reasons.push('Motion continuity became worse.');
    const improvement=(before.score-after.score)/Math.max(.1,before.score);
    if (improvement<.2 || before.score-after.score<.5) reasons.push('The measured improvement is too small.');
    return { accepted: reasons.length===0, improvement, reasons };
}
