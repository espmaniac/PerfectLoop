import { clamp, framePlan } from './logic.js';
import { videoTransform, videoSelectionGeometry, videoRotate } from './framing.js';
import { hitTestLayers, layerSelectionGeometry, layerDragPosition, layerResize, layerRotate } from './layers.js';

const layerValues = layer => ['x', 'y', 'width', 'fontSize', 'rotation', 'motion', 'spin', 'motionCycles', 'spinCycles', 'opacity',
    'text', 'fontFamily', 'align', 'assetId', 'visible'].map(key => layer?.[key]);
const degrees = radians => radians * 180 / Math.PI;
const normalizeAngle = angle => ((angle + 180) % 360 + 360) % 360 - 180;

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
        if (Math.abs(box.width - drag.box.width) > 0.5 || Math.abs(box.height - drag.box.height) > 0.5
            || Math.abs(box.left - drag.box.left) > 0.5 || Math.abs(box.top - drag.box.top) > 0.5)
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
            return [{ ...videoSelectionGeometry(state.s, state.info, { width: this.canvas.width, height: this.canvas.height }), type: 'video' }];
        }
        const layer = state.s.layers?.find(item => item.id === state.activeLayerId);
        return layerSelectionGeometry(layer, state.s, this.getTime(), framePlan(state.s).duration,
            { width: this.canvas.width, height: this.canvas.height }).map(shape => ({ ...shape, type: layer.type }));
    }

    pointerDown(event) {
        return this.beginMove(event, false);
    }

    // Selection polygons can receive events on the editor matte outside the
    // cropped output. These events use the same hit order and drag geometry.
    startMove(event) {
        return this.beginMove(event, true);
    }

    beginMove(event, allowOutside) {
        if (event.button !== 0 || event.isPrimary === false || this.dragging || !this.allowed())
            return false;
        // Switching from Source or Loop can resize the preview. Pause and enter
        // Composition before recording its dimensions or testing layer pixels.
        if (this.beginEdit() === false)
            return false;
        const state = this.getState();
        if (!this.allowed(state) || state.mode !== 'composition')
            return false;
        const box = this.canvas.getBoundingClientRect(), width = this.canvas.width, height = this.canvas.height;
        if (!(box.width > 0 && box.height > 0 && width > 0 && height > 0))
            return false;
        const x = (event.clientX - box.left) * width / box.width;
        const y = (event.clientY - box.top) * height / box.height;
        const time = this.getTime(), period = framePlan(state.s).duration;
        const hit = state.tab === 'layers'
            ? hitTestLayers(state.s.layers, state.s, time, period, x, y, { width, height }, allowOutside) : null;
        if (state.tab === 'layers' && !hit)
            return false;
        if (hit) this.selectLayer(hit.layer.id);
        const current = this.getState();
        if (!this.allowed(current) || current.mode !== 'composition' || current.tab !== state.tab || current.file !== state.file)
            return false;
        return this.startGesture(event, current, hit?.layer, { kind: 'move', time, period });
    }

    startResize(event, copyIndex, cornerIndex) {
        if (event.altKey) return this.startRotate(event, copyIndex, cornerIndex);
        return this.beginResize(event, copyIndex, cornerIndex, true);
    }

    startRotate(event, copyIndex, cornerIndex) {
        return this.beginRotate(event, copyIndex, cornerIndex, true);
    }

    rotateByKeyboard(copyIndex, cornerIndex, deltaDegrees) {
        if (!Number.isFinite(deltaDegrees) || deltaDegrees === 0)
            return false;
        const shape = this.selection()[copyIndex], corner = shape?.corners[cornerIndex];
        if (!corner)
            return false;
        const box = this.canvas.getBoundingClientRect();
        const event = { button: 0, isPrimary: true, pointerId: null,
            clientX: box.left + corner.x / this.canvas.width * box.width,
            clientY: box.top + corner.y / this.canvas.height * box.height, preventDefault() {} };
        if (!this.beginRotate(event, copyIndex, cornerIndex, false))
            return false;
        // Keyboard angles describe the stored rotation; mouse angles describe
        // the displayed rotation, whose direction reverses when mirrored.
        const drag = this.dragging;
        const radians = deltaDegrees * Math.PI / 180 * (!drag.layerId && drag.settings.mirror ? -1 : 1);
        const dx = corner.x - shape.centerX, dy = corner.y - shape.centerY;
        this.pointerMove({ ...event,
            clientX: box.left + (shape.centerX + dx * Math.cos(radians) - dy * Math.sin(radians)) / this.canvas.width * box.width,
            clientY: box.top + (shape.centerY + dx * Math.sin(radians) + dy * Math.cos(radians)) / this.canvas.height * box.height });
        this.finish();
        return true;
    }

    beginRotate(event, copyIndex, cornerIndex, capture) {
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
        const box = this.canvas.getBoundingClientRect();
        const x = (event.clientX - box.left) * this.canvas.width / box.width - shape.centerX;
        const y = (event.clientY - box.top) * this.canvas.height / box.height - shape.centerY;
        if (!(x ** 2 + y ** 2 > 1e-12))
            return false;
        return this.startGesture(event, state, layer, { kind: 'rotate', shape, lastPointerAngle: Math.atan2(y, x), angleDelta: 0,
            capture, time: this.getTime(), period: framePlan(state.s).duration });
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
        let angle;
        if (drag.kind === 'rotate') {
            const x = (event.clientX - drag.box.left) * drag.width / drag.box.width - drag.shape.centerX;
            const y = (event.clientY - drag.box.top) * drag.height / drag.box.height - drag.shape.centerY;
            if (x ** 2 + y ** 2 <= 1e-12)
                return;
            const nextPointerAngle = Math.atan2(y, x);
            drag.angleDelta += normalizeAngle(degrees(nextPointerAngle - drag.lastPointerAngle));
            drag.lastPointerAngle = nextPointerAngle;
            const initial = drag.layerId ? drag.layer.rotation : drag.settings.rotate;
            const direction = !drag.layerId && drag.settings.mirror ? -1 : 1;
            angle = initial + drag.angleDelta * direction;
            if (event.shiftKey) angle = Math.round(angle / 15) * 15;
            angle = normalizeAngle(angle);
            if (!drag.remembered && Math.abs(normalizeAngle(angle - initial)) < 1e-10)
                return;
        }
        const state = this.getState();
        let partial, previous;
        if (drag.layerId) {
            if (drag.kind === 'rotate') {
                partial = Math.abs(normalizeAngle(angle - drag.layer.rotation)) < 1e-10
                    ? { rotation: drag.layer.rotation, x: drag.layer.x, y: drag.layer.y }
                    : layerRotate(drag.layer, drag.settings, drag.time, drag.period, angle, drag.shape, { width: drag.width, height: drag.height });
            }
            else if (drag.kind === 'resize') {
                const key = drag.layer.type === 'text' ? 'fontSize' : 'width';
                partial = Math.abs(factor - 1) < 1e-12
                    ? { [key]: drag.layer[key], x: drag.layer.x, y: drag.layer.y }
                    : layerResize(drag.layer, drag.settings, drag.time, drag.period, factor, drag.anchor, { width: drag.width, height: drag.height });
            }
            else
                partial = layerDragPosition(drag.layer, drag.settings, drag.time, drag.period, dx, dy, { width: drag.width, height: drag.height });
            previous = state.s.layers.find(layer => layer.id === drag.layerId);
        }
        else if (drag.kind === 'rotate') {
            partial = Math.abs(normalizeAngle(angle - drag.settings.rotate)) < 1e-10
                ? { rotate: drag.settings.rotate, zoom: drag.settings.zoom ?? 100, cropX: drag.settings.cropX, cropY: drag.settings.cropY }
                : videoRotate(drag.settings, state.info, angle, { width: drag.width, height: drag.height });
            previous = state.s;
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
            if ('cropX' in partial) drag.expectedCropX = partial.cropX;
            if ('cropY' in partial) drag.expectedCropY = partial.cropY;
            if ('zoom' in partial) drag.framing[3] = partial.zoom;
            if ('rotate' in partial) drag.framing[4] = partial.rotate;
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
