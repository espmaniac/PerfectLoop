import { clamp, framePlan } from './logic.js';
import { videoTransform } from './framing.js';
import { hitTestLayers, layerSelectionGeometry, layerDragPosition, layerResize } from './layers.js';

const layerValues = layer => ['x', 'y', 'width', 'fontSize', 'rotation', 'motion', 'spin', 'motionCycles', 'spinCycles', 'opacity',
    'text', 'fontFamily', 'align', 'assetId', 'visible'].map(key => layer?.[key]);

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
        if (state.s.cropX !== drag.expectedCropX || state.s.cropY !== drag.expectedCropY)
            return false;
        if (this.getTime() !== drag.time || framePlan(state.s).duration !== drag.period)
            return false;
        if (drag.layerId) {
            const layer = state.s.layers?.find(item => item.id === drag.layerId);
            if (state.activeLayerId !== drag.layerId || !layer?.visible || layer.opacity === 0
                || layerValues(layer).some((value, index) => value !== drag.expectedLayer[index]))
                return false;
        }
        return true;
    }

    refresh() {
        if (this.dragging && !this.valid()) this.finish();
        const enabled = this.allowed();
        this.canvas.dataset.editable = String(enabled);
        this.canvas.dataset.dragging = String(Boolean(this.dragging));
        const cursor = this.dragging?.kind === 'resize' ? this.dragging.diagonal.x * this.dragging.diagonal.y >= 0 ? 'nwse-resize' : 'nesw-resize' : 'grabbing';
        this.canvas.style.cursor = enabled ? this.dragging ? cursor : this.getState().tab === 'layers' ? 'default' : 'grab' : this.originalCursor;
        this.canvas.style.touchAction = enabled ? 'none' : this.originalTouchAction;
    }

    selection() {
        const state = this.getState();
        if (!this.allowed(state) || state.mode !== 'composition')
            return [];
        if (state.tab === 'edit') {
            const transform = videoTransform(state.s, state.info.width, state.info.height, this.canvas.width, this.canvas.height);
            const box = this.canvas.getBoundingClientRect(), width = this.canvas.width, height = this.canvas.height;
            const left = (width - transform.scaledWidth) / 2 + transform.offsetX;
            const top = (height - transform.scaledHeight) / 2 + transform.offsetY;
            // Insets at the frame boundary keep the whole handle reachable
            // when the source is cropped larger than the composition.
            const insetX = Math.min(width / 4, 8 * width / box.width), insetY = Math.min(height / 4, 8 * height / box.height);
            const x1 = left <= 0 ? insetX : left, y1 = top <= 0 ? insetY : top;
            const x2 = left + transform.scaledWidth >= width ? width - insetX : left + transform.scaledWidth;
            const y2 = top + transform.scaledHeight >= height ? height - insetY : top + transform.scaledHeight;
            if (!(x2 > x1 && y2 > y1)) return [];
            return [{ type: 'video', centerX: (x1 + x2) / 2, centerY: (y1 + y2) / 2, width: x2 - x1, height: y2 - y1, rotation: 0,
                corners: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }] }];
        }
        const layer = state.s.layers?.find(item => item.id === state.activeLayerId);
        return layerSelectionGeometry(layer, state.s, this.getTime(), framePlan(state.s).duration,
            { width: this.canvas.width, height: this.canvas.height }).map(shape => ({ ...shape, type: layer.type }));
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
        if (state.tab === 'layers' && !hit)
            return;
        if (hit) this.selectLayer(hit.layer.id);
        const current = this.getState();
        if (!this.allowed(current) || current.mode !== 'composition' || current.tab !== state.tab || current.file !== state.file)
            return;
        this.startGesture(event, current, hit?.layer, { kind: 'move', time, period });
    }

    startResize(event, copyIndex, cornerIndex) {
        return this.beginResize(event, copyIndex, cornerIndex, true);
    }

    resizeByKeyboard(copyIndex, cornerIndex, dx, dy) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx === 0 && dy === 0)
            return false;
        const shape = this.selection()[copyIndex], corner = shape?.corners[cornerIndex];
        if (!corner)
            return false;
        const box = this.canvas.getBoundingClientRect();
        const event = { button: 0, isPrimary: true, pointerId: null, clientX: box.left + corner.x / this.canvas.width * box.width,
            clientY: box.top + corner.y / this.canvas.height * box.height, preventDefault() {} };
        if (!this.beginResize(event, copyIndex, cornerIndex, false))
            return false;
        this.pointerMove({ ...event, clientX: event.clientX + dx / this.canvas.width * box.width,
            clientY: event.clientY + dy / this.canvas.height * box.height });
        this.finish();
        return true;
    }

    beginResize(event, copyIndex, cornerIndex, capture) {
        if (event.button !== 0 || event.isPrimary === false || this.dragging || !this.allowed()
            || !Number.isInteger(cornerIndex) || cornerIndex < 0 || cornerIndex > 3 || !Number.isInteger(copyIndex) || copyIndex < 0)
            return false;
        if (this.beginEdit() === false)
            return false;
        const state = this.getState();
        if (!this.allowed(state) || state.mode !== 'composition')
            return false;
        const shape = this.selection()[copyIndex];
        if (!shape)
            return false;
        const layer = state.tab === 'layers' ? state.s.layers?.find(item => item.id === state.activeLayerId) : null;
        if (state.tab === 'layers' && !layer)
            return false;
        const opposite = (cornerIndex + 2) % 4, anchor = { ...shape.corners[opposite], cornerIndex: opposite, copyIndex, shape };
        const diagonal = { x: shape.corners[cornerIndex].x - anchor.x, y: shape.corners[cornerIndex].y - anchor.y };
        if (!(diagonal.x ** 2 + diagonal.y ** 2 > 0))
            return false;
        return this.startGesture(event, state, layer, { kind: 'resize', anchor, diagonal, capture, time: this.getTime(), period: framePlan(state.s).duration });
    }

    startGesture(event, current, layer, details) {
        const box = this.canvas.getBoundingClientRect(), width = this.canvas.width, height = this.canvas.height;
        if (!(box.width > 0 && box.height > 0 && width > 0 && height > 0))
            return false;
        const transform = videoTransform(current.s, current.info.width, current.info.height, width, height);
        this.dragging = {
            pointerId: event.pointerId, tab: current.tab, file: current.file, sourceURL: current.sourceURL,
            sourceWidth: current.info.width, sourceHeight: current.info.height, duration: current.info.duration,
            width, height, box, clientX: event.clientX, clientY: event.clientY,
            framing: [current.s.width, current.s.height, current.s.fit, current.s.zoom, current.s.rotate, current.s.mirror],
            layerId: layer?.id, layer, settings: current.s,
            cropX: current.s.cropX, cropY: current.s.cropY,
            expectedCropX: current.s.cropX, expectedCropY: current.s.cropY, expectedLayer: layerValues(layer),
            availableX: width - transform.scaledWidth, availableY: height - transform.scaledHeight,
            transform, remembered: false, ...details,
        };
        event.preventDefault();
        if (details.capture !== false) {
            this.canvas.focus?.({ preventScroll: true });
            this.canvas.addEventListener('pointermove', this.pointerMove);
            for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.canvas.addEventListener(name, this.pointerEnd);
            try {
                this.canvas.setPointerCapture(event.pointerId);
            }
            catch {
                this.finish();
                return false;
            }
        }
        this.refresh();
        this.onChange();
        return true;
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
        const factor = drag.kind === 'resize' ? this.resizeFactor(drag, dx, dy) : 1;
        if (drag.kind === 'resize' && !drag.remembered && Math.abs(factor - 1) < 1e-12)
            return;
        const state = this.getState();
        let partial, previous;
        if (drag.layerId) {
            if (drag.kind === 'resize') {
                const key = drag.layer.type === 'text' ? 'fontSize' : 'width';
                partial = Math.abs(factor - 1) < 1e-12
                    ? { [key]: drag.layer[key], x: drag.layer.x, y: drag.layer.y }
                    : layerResize(drag.layer, drag.settings, drag.time, drag.period, factor, drag.anchor, { width: drag.width, height: drag.height });
            }
            else
                partial = layerDragPosition(drag.layer, drag.settings, drag.time, drag.period, dx, dy, { width: drag.width, height: drag.height });
            previous = state.s.layers.find(layer => layer.id === drag.layerId);
        }
        else if (drag.kind === 'resize') {
            const initialZoom = drag.settings.zoom ?? 100;
            const zoom = clamp(initialZoom * factor, 25, 400), scale = zoom / initialZoom;
            partial = { zoom };
            for (const [key, extent, size, offset, anchor] of [
                ['cropX', drag.width, drag.transform.scaledWidth, drag.transform.offsetX, drag.anchor.x],
                ['cropY', drag.height, drag.transform.scaledHeight, drag.transform.offsetY, drag.anchor.y],
            ]) {
                const left = (extent - size) / 2 + offset;
                const nextSize = size * scale, available = extent - nextSize;
                const nextLeft = anchor - (anchor - left) * scale;
                partial[key] = Math.abs(available) > 1e-8 ? clamp(nextLeft / available * 100, 0, 100) : drag.settings[key];
            }
            if (Math.abs(factor - 1) < 1e-12)
                partial = { zoom: initialZoom, cropX: drag.settings.cropX, cropY: drag.settings.cropY };
            previous = state.s;
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
        if (drag.layerId) {
            drag.expectedLayer = layerValues({ ...previous, ...partial });
            this.editLayer(drag.layerId, partial);
        }
        else {
            drag.expectedCropX = partial.cropX;
            drag.expectedCropY = partial.cropY;
            if ('zoom' in partial) drag.framing[3] = partial.zoom;
            this.editVideo(partial);
        }
        this.onChange();
    }

    resizeFactor(drag, dx, dy) {
        return 1 + (dx * drag.diagonal.x + dy * drag.diagonal.y) / (drag.diagonal.x ** 2 + drag.diagonal.y ** 2);
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
