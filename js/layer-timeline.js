import {clamp,framePlan,timecode} from './logic.js';
import {layerStack} from './layer-order.js';
import {adjustLayerTiming,layerInterval} from './layer-timing.js';
import {escapeHTML,icon} from './ui.js';

const kind=layer=>layer.id==='video'?'Video':layer.videoPatch?'Video patch':layer.patch?'Patch':layer.type==='text'?'Text':'Image';
const name=layer=>layer.id==='video'?'Video':layer.type==='text'?layer.text.trim()||'Empty text':layer.name||'Image';

export class LayerTimeline {
    constructor(host,{getState,select,edit,seek,remember}) {
        Object.assign(this,{host,getState,select,edit,seek,remember});
        this.time=0;this.key='';this.rows=new Map();
        host.innerHTML=`<div class="layer-timeline-heading"><h3>Layer timing</h3><span>One finished loop · <b data-track-duration></b></span></div>
          <div class="layer-track-scale"><span>Layer</span><div data-track-ruler class="layer-track-ruler" role="slider" tabindex="0" aria-label="Layer timeline playhead" aria-valuemin="0" aria-describedby="layer-track-help"></div></div>
          <div data-track-rows></div><p class="micro" id="layer-track-help">Drag a clip to move its active interval; drag its edges to trim. Arrow keys adjust one frame, Shift + arrows ten frames. Intervals repeat every loop.</p>`;
        this.ruler=host.querySelector('[data-track-ruler]');this.rowsHost=host.querySelector('[data-track-rows]');
        this.handlers={pointerdown:e=>this.pointerDown(e),pointermove:e=>this.pointerMove(e),
            pointerup:e=>this.pointerEnd(e),pointercancel:e=>this.pointerEnd(e),lostpointercapture:e=>this.pointerEnd(e),
            click:e=>{const button=e.target.closest('[data-track-select]');if(button&&this.editable())this.select(button.dataset.trackSelect);},
            keydown:e=>this.keyDown(e)};
        for(const [event,handler] of Object.entries(this.handlers))host.addEventListener(event,handler);
    }
    duration() {return framePlan(this.getState().s).duration;}
    editable() {
        const st=this.getState(),duration=this.duration();
        return st.tab==='layers'&&!st.job&&st.info.duration>0&&Number.isFinite(duration)&&duration>0&&Number.isInteger(st.s.fps)&&st.s.fps>0;
    }
    context() {
        const st=this.getState();return JSON.stringify([st.sourceURL,st.s.start,st.s.end,st.s.speed,st.s.fps,st.s.method,st.s.transition,st.s.curve,st.s.shift]);
    }
    validGesture() {
        const g=this.gesture;
        return g&&this.editable()&&g.context===this.context()&&(!g.id||g.id==='video'||this.getState().s.layers.some(layer=>layer.id===g.id));
    }
    render() {
        const st=this.getState(),duration=this.duration();
        this.host.hidden=st.tab!=='layers'||!st.info.duration||!Number.isFinite(duration)||duration<=0;
        if(this.gesture&&!this.validGesture())this.finishGesture();
        if(this.host.hidden)return;
        const stack=layerStack(st.s.layers).reverse(),key=JSON.stringify(stack.map(layer=>[layer.id,kind(layer)]));
        if(this.key!==key) {
            this.finishGesture();this.key=key;
            this.rowsHost.innerHTML=stack.map(layer=>{
                const id=escapeHTML(layer.id),video=layer.id==='video';
                return `<div class="layer-track-row" data-track-row="${id}">
                  <button class="layer-track-label" data-track-select="${id}" aria-pressed="false"><span>${icon(video?'Film':layer.type==='text'?'Type':'Layers',16)}</span><span><b></b><small></small></span></button>
                  <div class="layer-track-lane" data-track-lane="${id}"><div class="layer-track-clip">
                    ${video?'':'<button class="layer-track-edge start" data-track-edit="start" role="slider" aria-describedby="layer-track-help"></button>'}
                    <button class="layer-track-body" ${video?'':'data-track-edit="move" role="slider"'} aria-describedby="layer-track-help"><span>${kind(layer)}</span><small></small></button>
                    ${video?'':'<button class="layer-track-edge end" data-track-edit="end" role="slider" aria-describedby="layer-track-help"></button>'}
                  </div><div class="layer-track-playhead" aria-hidden="true"></div></div></div>`;
            }).join('');
            this.rows=new Map([...this.rowsHost.querySelectorAll('[data-track-row]')].map(row=>[row.dataset.trackRow,row]));
        }
        this.host.querySelector('[data-track-duration]').textContent=`${duration.toFixed(3)}s`;
        this.ruler.innerHTML=Array.from({length:5},(_,i)=>`<span>${timecode(duration*i/4)}</span>`).join('');
        this.ruler.setAttribute('aria-valuemax',String(duration));this.ruler.setAttribute('aria-disabled',String(!this.editable()));
        for(const layer of stack) {
            const video=layer.id==='video',row=this.rows.get(layer.id),interval=video?{start:0,end:duration,visible:true}:layerInterval(layer,duration),label=name(layer);
            row.classList.toggle('selected',st.activeLayerId===layer.id);row.classList.toggle('muted',!video&&layer.visible===false);
            const select=row.querySelector('[data-track-select]');select.setAttribute('aria-pressed',String(st.activeLayerId===layer.id));select.title=label;
            select.querySelector('b').textContent=label;
            const timing=`${timecode(interval.start)}–${timecode(interval.end)}`;
            select.querySelector('small').textContent=video?'Full loop':!interval.visible?'Outside loop':`${timing}${layer.endTime==null?' · until end':''}`;
            const clip=row.querySelector('.layer-track-clip');clip.hidden=!interval.visible;
            clip.style.left=`${interval.start/duration*100}%`;clip.style.width=`${(interval.end-interval.start)/duration*100}%`;
            const body=row.querySelector('.layer-track-body');body.querySelector('small').textContent=timing;
            body.title=video?'Click to preview the video at this time':`${label} · drag to move; shorten a full-loop interval before moving it`;
            body.setAttribute('aria-label',video?'Seek video track':`Move ${label} active interval`);
            for(const control of row.querySelectorAll('[data-track-edit]')) {
                const edge=control.dataset.trackEdit,value=edge==='end'?interval.end:interval.start;
                control.setAttribute('aria-valuemin',String(edge==='end'?Math.min(interval.end,interval.start+1/st.s.fps):0));
                control.setAttribute('aria-valuemax',String(edge==='start'?Math.max(interval.start,interval.end-1/st.s.fps):edge==='move'?duration-(interval.end-interval.start):duration));
                control.setAttribute('aria-valuenow',String(value));control.setAttribute('aria-valuetext',edge==='move'?timing:timecode(value));
                if(edge!=='move')control.setAttribute('aria-label',`Adjust ${label} ${edge} time`);
            }
            for(const button of row.querySelectorAll('button'))button.disabled=!this.editable();
        }
        this.renderPlayhead(this.time);
    }
    renderPlayhead(time) {
        this.time=time;
        if(this.gesture&&!this.validGesture())this.finishGesture();
        if(this.host.hidden)return;
        const duration=this.duration(),visible=Number.isFinite(time)&&time>=0&&time<=duration;
        for(const row of this.rows.values()) {
            const head=row.querySelector('.layer-track-playhead');head.hidden=!visible;head.style.left=`${clamp(time/duration,0,1)*100}%`;
        }
        this.ruler.setAttribute('aria-valuenow',String(clamp(time,0,duration)));this.ruler.setAttribute('aria-valuetext',timecode(clamp(time,0,duration)));
    }
    pointTime(event,box) {return clamp((event.clientX-box.left)/box.width,0,1)*this.duration();}
    previewInterval(id,edge) {
        const st=this.getState(),layer=st.s.layers.find(layer=>layer.id===id);
        if(!layer)return;
        const interval=layerInterval(layer,this.duration());
        this.seek(edge==='end'?Math.max(interval.start,interval.end-1/st.s.fps):interval.start);
    }
    pointerDown(event) {
        if(event.button!==0||!this.editable())return;
        const lane=event.target.closest('[data-track-lane]'),ruler=event.target.closest('[data-track-ruler]');
        if(!lane&&!ruler)return;
        event.preventDefault();event.stopPropagation();this.finishGesture();
        let control=event.target.closest('[data-track-edit]'),action=control?.dataset.trackEdit||'scrub',id=lane?.dataset.trackLane;
        if(control&&action!=='move') {
            const box=control.closest('.layer-track-clip').getBoundingClientRect();
            action=Math.abs(event.clientX-box.left)<=Math.abs(event.clientX-box.right)?'start':'end';
            control=lane.querySelector(`[data-track-edit="${action}"]`);
        }
        if(id)this.select(id);
        control?.focus({preventScroll:true});
        const st=this.getState(),layer=st.s.layers.find(layer=>layer.id===id),box=(lane||ruler).getBoundingClientRect();
        if(!box.width)return;
        this.gesture={id,action,layer:layer?{...layer}:null,box,x:event.clientX,pointerId:event.pointerId,context:this.context(),remembered:false,lastDelta:0};
        this.host.setPointerCapture(event.pointerId);
        if(action==='start'||action==='end')this.previewInterval(id,action);else this.seek(this.pointTime(event,box));
    }
    pointerMove(event) {
        const g=this.gesture;if(!g||event.pointerId!==g.pointerId)return;
        if(!this.validGesture()){this.finishGesture();return;}
        event.preventDefault();
        if(g.action==='scrub'){this.seek(this.pointTime(event,g.box));return;}
        const st=this.getState(),delta=Math.round((event.clientX-g.x)/g.box.width*this.duration()*st.s.fps);
        if(delta===g.lastDelta)return;g.lastDelta=delta;
        const partial=adjustLayerTiming(g.layer,g.action,delta,st.s);
        // Returning to the initial pointer position restores the original values.
        const value=partial||(g.remembered?{startTime:g.layer.startTime??0,endTime:g.layer.endTime??null}:null);
        if(!value)return;
        if(!g.remembered){this.remember();g.remembered=true;}
        this.edit(g.id,value,false);this.previewInterval(g.id,g.action);
    }
    pointerEnd(event) {if(this.gesture?.pointerId===event.pointerId)this.finishGesture();}
    finishGesture() {
        const g=this.gesture;this.gesture=null;
        if(g&&this.host.hasPointerCapture?.(g.pointerId))this.host.releasePointerCapture(g.pointerId);
    }
    keyDown(event) {
        if(event.key==='Escape'){this.finishGesture();return;}
        const control=event.target.closest('[data-track-edit]'),ruler=event.target.closest('[data-track-ruler]');
        if((!control&&!ruler)||!this.editable()||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();this.finishGesture();
        const st=this.getState(),frames=Math.round(this.duration()*st.s.fps),step=event.shiftKey?10:1;
        const delta=event.key==='Home'?-frames:event.key==='End'?frames:event.key==='ArrowRight'?step:-step;
        if(ruler){this.seek(event.key==='Home'?0:event.key==='End'?this.duration():this.time+delta/st.s.fps);return;}
        const id=control.closest('[data-track-row]').dataset.trackRow,layer=st.s.layers.find(layer=>layer.id===id);
        if(!layer)return;
        this.select(id);const partial=adjustLayerTiming(layer,control.dataset.trackEdit,delta,st.s);
        if(partial){this.remember();this.edit(id,partial,false);this.previewInterval(id,control.dataset.trackEdit);}
    }
    destroy() {
        this.finishGesture();for(const [event,handler] of Object.entries(this.handlers))this.host.removeEventListener(event,handler);
    }
}
