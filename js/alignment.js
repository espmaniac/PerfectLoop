export const ALIGNMENTS = [['left','Left'],['center-x','Horizontal center'],['right','Right'],['top','Top'],['center-y','Vertical center'],['bottom','Bottom']];
export function alignmentDelta(corners, width, height, alignment) {
    const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    switch(alignment) {
        case 'left':return {x:-left,y:0};
        case 'center-x':return {x:width/2-(left+right)/2,y:0};
        case 'right':return {x:width-right,y:0};
        case 'top':return {x:0,y:-top};
        case 'center-y':return {x:0,y:height/2-(top+bottom)/2};
        case 'bottom':return {x:0,y:height-bottom};
        default:throw new Error('Unknown alignment.');
    }
}
