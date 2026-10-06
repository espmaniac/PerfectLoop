import { clamp, framePlan } from './logic.js';
import { videoTransform } from './framing.js';
import { hitTestLayers, layerSelectionGeometry, layerDragPosition } from './layers.js';

// Pointer editing writes settings through the app's existing update functions.
// The app owns playback, undo snapshots, and drawing the selection overlay.
export class PreviewEditor {
    constructor(canvas, getState, { beginEdit, editVideo, selectLayer, editLayer, remember, getTime, onChange = () => {} }) {
        Object.assign(this, { canvas, getState, beginEdit, editVideo, selectLayer, editLayer, remember, getTime, onChange });
        this.dragging = null;
        this.originalCursor = canvas.style.cursor;
        this.originalTouchAction = canvas.style.touchAction;
        this.pointerDown = this.pointerDown.bind(this);
        this.pointerMove = this.pointerMove.bind(this);
        this.pointerEnd = this.pointerEnd.bind(this);
        canvas.addEventListener('pointerdown', this.pointerDown);
        this.refresh();
    }

    allowed(state = this.getState()) {
        return !state.job && Boolean(state.file) && state.info?.width > 0 && state.info?.height > 0 && state.info?.duration > 0
            && state.wallpaperScreen === 'editor' && ['edit', 'layers'].includes(state.tab);
    }

    valid() {
        const state = this.getState(), drag = this.dragging;
        if (!drag || !this.allowed(state) || state.mode !== 'composition' || state.tab !== drag.tab || state.file !== drag.file
            || state.sourceURL !== drag.sourceURL || state.info.width !== drag.sourceWidth || state.info.height !== drag.sourceHeight
            || state.info.duration !== drag.duration || this.canvas.width !== drag.width || this.canvas.height !== drag.height)
            return false;
        const box = this.canvas.getBoundingClientRect();
        if (Math.abs(box.width - drag.box.width) > 0.5 || Math.abs(box.height - drag.box.height) > 0.5)
            return false;
        const framing = [state.s.width, state.s.height, state.s.fit, state.s.zoom, state.s.rotate, state.s.mirror];
        if (framing.some((value, index) => value !== drag.framing[index]))
            return false;
        if (drag.layerId) {
            const layer = state.s.layers?.find(item => item.id === drag.layerId);
            if (state.activeLayerId !== drag.layerId || !layer?.visible || layer.opacity === 0)
                return false;
        }
        return true;
    }

    refresh() {
        if (this.dragging && !this.valid()) this.finish();
        const enabled = this.allowed();
        this.canvas.dataset.editable = String(enabled);
        this.canvas.dataset.dragging = String(Boolean(this.dragging));
        this.canvas.style.cursor = enabled ? this.dragging ? 'grabbing' : 'grab' : this.originalCursor;
        this.canvas.style.touchAction = enabled ? 'none' : this.originalTouchAction;
    }

    selection() {
        const state = this.getState();
        if (!this.allowed(state) || state.mode !== 'composition' || state.tab !== 'layers')
            return [];
        const layer = state.s.layers?.find(item => item.id === state.activeLayerId);
        return layerSelectionGeometry(layer, state.s, this.getTime(), framePlan(state.s).duration,
            { width: this.canvas.width, height: this.canvas.height });
    }

    pointerDown(event) {
        if (event.button !== 0 || event.isPrimary === false || this.dragging || !this.allowed())
            return;
        // Switching from Source or Loop can resize the preview. Pause and enter
        // Composition before recording its dimensions or testing layer pixels.
        if (this.beginEdit() === false)
            return;
        const state = this.getState();
        if (!this.allowed(state) || state.mode !== 'composition')
            return;
        const box = this.canvas.getBoundingClientRect(), width = this.canvas.width, height = this.canvas.height;
        if (!(box.width > 0 && box.height > 0 && width > 0 && height > 0))
            return;
        const x = (event.clientX - box.left) * width / box.width;
        const y = (event.clientY - box.top) * height / box.height;
        const time = this.getTime(), period = framePlan(state.s).duration;
        const hit = state.tab === 'layers'
            ? hitTestLayers(state.s.layers, state.s, time, period, x, y, { width, height }) : null;
        if (hit) this.selectLayer(hit.layer.id);
        const current = this.getState();
        if (!this.allowed(current) || current.mode !== 'composition' || current.tab !== state.tab || current.file !== state.file)
            return;
        const transform = videoTransform(current.s, current.info.width, current.info.height, width, height);
        this.dragging = {
            pointerId: event.pointerId, tab: current.tab, file: current.file, sourceURL: current.sourceURL,
            sourceWidth: current.info.width, sourceHeight: current.info.height, duration: current.info.duration,
            width, height, box, clientX: event.clientX, clientY: event.clientY,
            framing: [current.s.width, current.s.height, current.s.fit, current.s.zoom, current.s.rotate, current.s.mirror],
            layerId: hit?.layer.id, layer: hit?.layer, settings: current.s, time, period,
            cropX: current.s.cropX, cropY: current.s.cropY,
            availableX: width - transform.scaledWidth, availableY: height - transform.scaledHeight,
            remembered: false,
        };
        event.preventDefault();
        this.canvas.focus?.({ preventScroll: true });
        this.canvas.addEventListener('pointermove', this.pointerMove);
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.canvas.addEventListener(name, this.pointerEnd);
        try {
            this.canvas.setPointerCapture(event.pointerId);
        }
        catch {
            this.finish();
            return;
        }
        this.refresh();
        this.onChange();
    }

    pointerMove(event) {
        const drag = this.dragging;
        if (!drag || event.pointerId !== drag.pointerId)
            return;
        if (!this.valid()) {
            this.finish();
            return;
        }
        event.preventDefault();
        const dx = (event.clientX - drag.clientX) * drag.width / drag.box.width;
        const dy = (event.clientY - drag.clientY) * drag.height / drag.box.height;
        const state = this.getState();
        let partial, previous;
        if (drag.layerId) {
            partial = layerDragPosition(drag.layer, drag.settings, drag.time, drag.period, dx, dy, { width: drag.width, height: drag.height });
            previous = state.s.layers.find(layer => layer.id === drag.layerId);
        }
        else {
            partial = {
                cropX: Math.abs(drag.availableX) > 1e-8 ? clamp(drag.cropX + dx / drag.availableX * 100, 0, 100) : drag.cropX,
                cropY: Math.abs(drag.availableY) > 1e-8 ? clamp(drag.cropY + dy / drag.availableY * 100, 0, 100) : drag.cropY,
            };
            previous = state.s;
        }
        if (Object.entries(partial).every(([key, value]) => previous[key] === value))
            return;
        if (!drag.remembered) {
            this.remember();
            drag.remembered = true;
        }
        if (drag.layerId) this.editLayer(drag.layerId, partial);
        else this.editVideo(partial);
        this.onChange();
    }

    pointerEnd(event) {
        if (event.pointerId === this.dragging?.pointerId) this.finish();
    }

    finish() {
        const drag = this.dragging;
        if (!drag)
            return;
        this.dragging = null;
        this.canvas.removeEventListener('pointermove', this.pointerMove);
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.canvas.removeEventListener(name, this.pointerEnd);
        if (this.canvas.hasPointerCapture?.(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
        this.refresh();
        this.onChange();
    }

    destroy() {
        this.finish();
        this.canvas.removeEventListener('pointerdown', this.pointerDown);
        this.canvas.style.cursor = this.originalCursor;
        this.canvas.style.touchAction = this.originalTouchAction;
    }
}
