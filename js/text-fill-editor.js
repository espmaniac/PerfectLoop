import { effectiveFill, validateFill, textPaint } from './text-fill.js';
import { normalizeHex, hexToRgb, rgbToHex, rgbToHsv, hsvToHex, rgbaCss } from './color.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const copyFill = fill => ({ ...fill, ...(fill.stops ? { stops: fill.stops.map(stop => ({ ...stop })) } : {}) });
let nextEditorId = 0;

function geometryField(key, label, min, max, unit) {
  return `<label class="field" data-fill-geometry-field="${key}"><span>${label}</span><div class="input-unit"><input type="number" data-fill-geometry="${key}" aria-label="${label}" min="${min}" max="${max}" step="any"><span>${unit}</span></div></label>`;
}

function rangeField(id, key, label, max) {
  return `<div class="fill-range-row"><label for="${id}"><span>${label}</span><output for="${id}" data-fill-output="${key}"></output></label><input id="${id}" type="range" min="0" max="${max}" step="${key === 'opacity' ? '0.01' : '1'}" data-fill-picker="${key}"></div>`;
}

export class TextFillEditor {
  constructor(host, getState, updateLayer) {
    this.host = host;
    this.getState = getState;
    this.updateLayer = updateLayer;
    this.selectedStop = 0;
    this.savedGradients = new Map();
    this.previewCanvases = new Map();
    this.previewCache = new Map();
    this.hsv = { h: 0, s: 0, v: 100 };
    this.abort = new AbortController();
    const id = `text-fill-${++nextEditorId}`;
    this.host.innerHTML = `<div class="fill-toolbar"><label class="field"><span>Text fill</span><select data-fill-field="type" aria-label="Text fill"><option value="solid">Solid color</option><option value="linear">Linear gradient</option><option value="radial">Radial gradient</option><option value="conic">Conic gradient</option></select></label></div>
      <div class="fill-preview" role="img" aria-label="Text fill preview"></div>
      <div data-fill-gradient hidden>
        <div class="fill-stop-track" aria-label="Gradient color positions"></div>
        <div class="fill-stop-list" role="group" aria-label="Gradient colors"></div>
        <button type="button" class="btn secondary fill-stop-add" data-fill-action="add">Add color</button>
        <p class="micro">Drag a color marker or enter its position. Add as many colors as you need.</p>
        <div class="fields two fill-geometry">${geometryField('angle', 'Gradient angle', 0, 360, '°')}${geometryField('centerX', 'Center X', 0, 100, '%')}${geometryField('centerY', 'Center Y', 0, 100, '%')}${geometryField('radius', 'Gradient radius', 1, 200, '%')}</div>
      </div>
      <div class="fill-picker">
        <span class="fill-picker-label" data-fill-color-label>Solid color</span>
        <div class="fill-sv" role="slider" tabindex="0" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100" aria-describedby="${id}-help" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"><div class="fill-sv-white"></div><div class="fill-sv-black"></div><span class="fill-sv-handle" aria-hidden="true"></span></div>
        ${rangeField(`${id}-hue`, 'h', 'Hue', 360)}
        ${rangeField(`${id}-opacity`, 'opacity', 'Color opacity', 100)}
        <div class="fill-channel-grid"><label class="field fill-hex-field"><span>HEX</span><input type="text" data-fill-picker="hex" aria-label="HEX color" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="#ffffff"></label>${['r', 'g', 'b'].map(channel => `<label class="field"><span>${channel.toUpperCase()}</span><input type="number" data-fill-picker="${channel}" aria-label="${{ r: 'Red', g: 'Green', b: 'Blue' }[channel]} channel" min="0" max="255" step="1"></label>`).join('')}</div>
        <p class="micro" id="${id}-help">Use left/right for saturation and up/down for brightness. Hold Shift for larger steps.</p>
      </div>`;
    this.preview = host.querySelector('.fill-preview');
    this.track = host.querySelector('.fill-stop-track');
    this.stopList = host.querySelector('.fill-stop-list');
    this.sv = host.querySelector('.fill-sv');
    const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: this.abort.signal });
    listen(host, 'click', event => this.click(event));
    listen(host, 'input', event => this.input(event));
    listen(host, 'change', event => {
      if (event.target.matches('[data-fill-field="type"]')) this.changeType(event.target.value);
    });
    listen(host, 'pointerdown', event => this.pointerDown(event));
    listen(host, 'pointermove', event => this.pointerMove(event));
    listen(document, 'pointerup', event => this.endPointer(event));
    listen(document, 'pointercancel', event => this.endPointer(event));
    listen(host, 'lostpointercapture', event => this.endPointer(event));
    listen(host, 'keydown', event => this.keyDown(event));
    listen(host, 'focusout', () => {
      queueMicrotask(() => {
        if (!this.abort.signal.aborted && this.layer) this.refresh(this.currentLayer(), { disabled: this.disabled });
      });
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.abort.signal.aborted && this.fill) this.refreshPreviews();
      });
      this.resizeObserver.observe(this.preview);
      this.resizeObserver.observe(this.track);
    }
  }

  currentLayer() {
    const state = this.getState();
    return (state.s.layers || []).find(layer => layer.id === state.activeLayerId);
  }

  canEdit() {
    const state = this.getState();
    return !this.abort.signal.aborted && !this.disabled && !state.job && this.layer && state.activeLayerId === this.layer.id;
  }

  refresh(layer, { disabled = false } = {}) {
    if (!layer || this.abort.signal.aborted) return;
    const nextFill = effectiveFill(layer);
    const fill = validateFill(nextFill).length ? { type: 'solid', color: normalizeHex(layer.color) || '#ffffff', opacity: 100 } : copyFill(nextFill);
    const layerChanged = this.layer?.id !== layer.id;
    if (layerChanged) {
      this.gesture = null;
      this.selectedStop = 0;
    }
    this.layer = layer;
    this.fill = fill;
    this.disabled = disabled;
    if (fill.type !== 'solid') {
      this.selectedStop = clamp(this.selectedStop, 0, fill.stops.length - 1);
      this.rememberGradient(fill);
    }
    this.host.querySelector('[data-fill-field="type"]').value = fill.type;
    this.host.querySelector('[data-fill-gradient]').hidden = fill.type === 'solid';
    this.refreshStops();
    this.host.querySelectorAll('[data-fill-geometry-field]').forEach(field => {
      const key = field.dataset.fillGeometryField;
      const visible = key === 'angle' ? fill.type === 'linear' || fill.type === 'conic'
        : key === 'radius' ? fill.type === 'radial' : fill.type === 'radial' || fill.type === 'conic';
      field.hidden = !visible;
      if (visible) this.bindValue(field.querySelector('input'), fill[key]);
    });
    const selected = this.selectedColor();
    const pickerKey = `${layer.id}:${fill.type === 'solid' ? 'solid' : this.selectedStop}`;
    if (this.pickerKey !== pickerKey || this.pickerColor !== selected.color.toLowerCase()) {
      const hsv = rgbToHsv(hexToRgb(selected.color));
      if (!hsv.s || !hsv.v) hsv.h = this.hsv.h;
      this.hsv = hsv;
    }
    this.pickerKey = pickerKey;
    this.pickerColor = selected.color.toLowerCase();
    this.host.querySelector('[data-fill-color-label]').textContent = fill.type === 'solid' ? 'Solid color' : `Color ${this.selectedStop + 1}`;
    this.refreshPicker();
    this.refreshPreviews();
    this.host.querySelectorAll('input, select, button').forEach(control => {
      control.disabled = disabled || (control.matches('[data-fill-action="remove"]') && fill.type !== 'solid' && fill.stops.length <= 2);
    });
    this.sv.setAttribute('aria-disabled', String(disabled));
    this.sv.tabIndex = disabled ? -1 : 0;
  }

  bindValue(input, value) {
    if (input === document.activeElement && input.type !== 'range' && input.tagName !== 'SELECT') return;
    const text = String(value);
    if (input.value !== text) input.value = text;
  }

  selectedColor() {
    return this.fill.type === 'solid' ? this.fill : this.fill.stops[this.selectedStop];
  }

  rememberGradient(fill) {
    let saved = this.savedGradients.get(this.layer.id);
    if (!saved) this.savedGradients.set(this.layer.id, saved = new Map());
    saved.set(fill.type, copyFill(fill));
    saved.set('last', copyFill(fill));
  }

  refreshStops() {
    if (this.fill.type === 'solid') return;
    const { stops } = this.fill;
    while (this.track.children.length > stops.length) this.track.lastElementChild.remove();
    while (this.stopList.children.length > stops.length) this.stopList.lastElementChild.remove();
    while (this.track.children.length < stops.length) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'fill-stop-handle';
      handle.setAttribute('role', 'slider');
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', '100');
      this.track.append(handle);
      const row = document.createElement('div');
      row.className = 'fill-stop-row';
      row.innerHTML = '<button type="button" class="fill-stop-select" data-fill-action="select"><span class="fill-stop-swatch" aria-hidden="true"></span><span></span></button><label class="fill-stop-position"><input type="number" min="0" max="100" step="0.001" data-fill-position><span>%</span></label><button type="button" class="fill-stop-remove" data-fill-action="remove">×</button>';
      this.stopList.append(row);
    }
    stops.forEach((stop, index) => {
      const selected = index === this.selectedStop;
      const handle = this.track.children[index];
      const row = this.stopList.children[index];
      const color = rgbaCss(stop.color, stop.opacity);
      handle.dataset.fillStop = index;
      handle.style.left = `${stop.position}%`;
      handle.style.setProperty('--fill-stop-color', color);
      handle.style.setProperty('--fill-preview', `linear-gradient(${color}, ${color})`);
      handle.classList.toggle('selected', selected);
      handle.setAttribute('aria-label', `Color ${index + 1} position`);
      handle.setAttribute('aria-valuenow', String(stop.position));
      handle.setAttribute('aria-valuetext', `${stop.position}%, ${stop.color}, ${stop.opacity}% opacity`);
      row.classList.toggle('selected', selected);
      row.dataset.fillStopRow = index;
      const select = row.querySelector('[data-fill-action="select"]');
      select.dataset.fillIndex = index;
      select.setAttribute('aria-pressed', String(selected));
      select.lastElementChild.textContent = `Color ${index + 1}`;
      const swatch = row.querySelector('.fill-stop-swatch');
      swatch.style.setProperty('--fill-stop-color', color);
      swatch.style.setProperty('--fill-preview', `linear-gradient(${color}, ${color})`);
      const position = row.querySelector('[data-fill-position]');
      position.dataset.fillPosition = index;
      position.setAttribute('aria-label', `Color ${index + 1} position`);
      this.bindValue(position, stop.position);
      const remove = row.querySelector('[data-fill-action="remove"]');
      remove.dataset.fillIndex = index;
      remove.setAttribute('aria-label', `Remove color ${index + 1}`);
    });
  }

  refreshPicker() {
    const { h, s, v } = this.hsv;
    const selected = this.selectedColor();
    this.sv.style.backgroundColor = hsvToHex({ h, s: 100, v: 100 });
    const handle = this.sv.querySelector('.fill-sv-handle');
    handle.style.left = `${s}%`;
    handle.style.top = `${100 - v}%`;
    this.sv.setAttribute('aria-valuenow', String(Math.round(s)));
    this.sv.setAttribute('aria-valuetext', `${Math.round(s)}% saturation, ${Math.round(v)}% brightness`);
    const rgb = hexToRgb(selected.color);
    const values = { h: Math.round(h), opacity: selected.opacity, hex: selected.color.toLowerCase(), ...rgb };
    this.host.querySelectorAll('[data-fill-picker]').forEach(input => this.bindValue(input, values[input.dataset.fillPicker]));
    this.host.querySelector('[data-fill-output="h"]').textContent = `${Math.round(h)}°`;
    this.host.querySelector('[data-fill-output="opacity"]').textContent = `${selected.opacity}%`;
    this.host.querySelector('[data-fill-picker="h"]').style.setProperty('--fill-range-background', 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)');
    this.host.querySelector('[data-fill-picker="opacity"]').style.setProperty('--fill-range-background', `linear-gradient(to right, ${rgbaCss(selected.color, 0)}, ${rgbaCss(selected.color, 100)})`);
  }

  refreshPreviews() {
    const fill = this.fill;
    if (!fill) return;
    if (fill.type === 'solid') {
      const color = rgbaCss(fill.color, fill.opacity);
      this.preview.style.setProperty('--fill-preview', `linear-gradient(${color}, ${color})`);
      this.preview.setAttribute('aria-label', `Solid text fill, ${fill.color}, ${fill.opacity}% opacity`);
      return;
    }
    // Native CSS and Canvas interpolate transparent gradient stops differently.
    // Paint both ramps with the same text fill renderer used in preview/export.
    this.paintPreview(this.track, { type: 'linear', angle: 0, stops: fill.stops });
    this.paintPreview(this.preview, fill);
    this.preview.setAttribute('aria-label', `${fill.type[0].toUpperCase() + fill.type.slice(1)} text gradient, ${fill.stops.length} colors`);
  }

  paintPreview(element, fill) {
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    const key = JSON.stringify([fill, width, height, dpr]);
    if (this.previewCache.get(element) === key) return;
    let canvas = this.previewCanvases.get(element);
    if (!canvas) {
      canvas = document.createElement('canvas');
      this.previewCanvases.set(element, canvas);
    }
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, pixelWidth / 2, pixelHeight / 2);
    try {
      ctx.fillStyle = textPaint(ctx, fill, width, height);
      ctx.fillRect(-width / 2, -height / 2, width, height);
      element.style.setProperty('--fill-preview', `url("${canvas.toDataURL('image/png')}")`);
      element.style.backgroundSize = '100% 100%, 12px 12px';
      this.previewCache.set(element, key);
      element.removeAttribute('title');
    } catch (error) {
      element.title = error.message;
      const color = rgbaCss(fill.stops[0].color, fill.stops[0].opacity);
      element.style.setProperty('--fill-preview', `linear-gradient(${color}, ${color})`);
    }
  }

  commit(fill) {
    if (!this.canEdit() || JSON.stringify(fill) === JSON.stringify(this.fill)) return false;
    const saveHistory = !this.gesture?.saved;
    if (this.gesture) this.gesture.saved = true;
    // Updates use fresh nested arrays so history and duplicated layers stay independent.
    this.fill = copyFill(fill);
    this.updateLayer(this.layer.id, { fill: copyFill(fill) }, saveHistory);
    const current = this.currentLayer();
    if (current) this.refresh(current, { disabled: Boolean(this.getState().job) });
    return true;
  }

  setColor(color, opacity = this.selectedColor().opacity) {
    const fill = copyFill(this.fill);
    const selected = fill.type === 'solid' ? fill : fill.stops[this.selectedStop];
    selected.color = color;
    selected.opacity = opacity;
    this.pickerColor = color;
    return this.commit(fill);
  }

  selectStop(index) {
    if (this.fill.type === 'solid') return;
    this.selectedStop = clamp(index, 0, this.fill.stops.length - 1);
    this.refresh(this.currentLayer(), { disabled: this.disabled });
  }

  changeType(type) {
    if (!this.canEdit() || type === this.fill.type || !['solid', 'linear', 'radial', 'conic'].includes(type)) return;
    const current = this.selectedColor();
    if (this.fill.type !== 'solid') this.rememberGradient(this.fill);
    let next;
    if (type === 'solid') next = { type, color: current.color, opacity: current.opacity };
    else {
      const saved = this.savedGradients.get(this.layer.id);
      const geometry = saved?.get(type);
      const source = this.fill.type === 'solid' ? saved?.get('last') : this.fill;
      const stops = source ? source.stops.map(stop => ({ ...stop }))
        : [{ color: current.color, opacity: current.opacity, position: 0 }, { color: current.color.toLowerCase() === '#ffffff' ? '#000000' : '#ffffff', opacity: current.opacity, position: 100 }];
      next = { type, stops };
      if (type === 'linear' || type === 'conic') next.angle = source?.angle ?? geometry?.angle ?? 0;
      if (type === 'radial' || type === 'conic') {
        next.centerX = source?.centerX ?? geometry?.centerX ?? 50;
        next.centerY = source?.centerY ?? geometry?.centerY ?? 50;
      }
      if (type === 'radial') next.radius = geometry?.radius ?? 100;
    }
    this.pickerKey = null;
    this.commit(next);
  }

  click(event) {
    const button = event.target.closest('[data-fill-action], [data-fill-stop]');
    if (!button || button.disabled || !this.canEdit()) return;
    if (button.hasAttribute('data-fill-stop')) {
      this.selectStop(Number(button.dataset.fillStop));
      return;
    }
    const action = button.dataset.fillAction;
    if (action === 'select') this.selectStop(Number(button.dataset.fillIndex));
    else if (action === 'remove' && this.fill.type !== 'solid' && this.fill.stops.length > 2) {
      const index = Number(button.dataset.fillIndex);
      const next = copyFill(this.fill);
      next.stops.splice(index, 1);
      if (index < this.selectedStop || this.selectedStop === next.stops.length) this.selectedStop--;
      this.pickerKey = null;
      this.commit(next);
    } else if (action === 'add' && this.fill.type !== 'solid') this.addStop();
  }

  addStop() {
    const sorted = [...this.fill.stops].sort((a, b) => a.position - b.position);
    let left = sorted[0];
    let right = sorted[1];
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index].position - sorted[index - 1].position > right.position - left.position) {
        left = sorted[index - 1];
        right = sorted[index];
      }
    }
    const position = Number(((left.position + right.position) / 2).toFixed(3));
    const ratio = right.position === left.position ? 0 : (position - left.position) / (right.position - left.position);
    const a = hexToRgb(left.color);
    const b = hexToRgb(right.color);
    const color = rgbToHex({ r: a.r + (b.r - a.r) * ratio, g: a.g + (b.g - a.g) * ratio, b: a.b + (b.b - a.b) * ratio });
    const next = copyFill(this.fill);
    next.stops.push({ color, opacity: Number((left.opacity + (right.opacity - left.opacity) * ratio).toFixed(2)), position });
    this.selectedStop = next.stops.length - 1;
    this.pickerKey = null;
    this.commit(next);
  }

  input(event) {
    if (!this.canEdit()) return;
    const input = event.target;
    if (input.hasAttribute('data-fill-position')) {
      if (input.value === '' || !Number.isFinite(input.valueAsNumber)) return;
      this.setPosition(Number(input.dataset.fillPosition), clamp(input.valueAsNumber, 0, 100));
    } else if (input.hasAttribute('data-fill-geometry')) {
      if (input.value === '' || !Number.isFinite(input.valueAsNumber)) return;
      const fill = copyFill(this.fill);
      fill[input.dataset.fillGeometry] = clamp(input.valueAsNumber, Number(input.min), Number(input.max));
      this.commit(fill);
    } else if (input.hasAttribute('data-fill-picker')) this.pickerInput(input);
  }

  pickerInput(input) {
    const key = input.dataset.fillPicker;
    if (key === 'hex') {
      const hex = normalizeHex(input.value);
      if (!hex) return;
      this.setRgbColor(hex);
    } else {
      if (input.value === '' || !Number.isFinite(input.valueAsNumber)) return;
      const value = clamp(input.valueAsNumber, Number(input.min), Number(input.max));
      if (key === 'h') {
        this.hsv.h = value;
        this.setColor(hsvToHex(this.hsv));
        this.refreshPicker();
      } else if (key === 'opacity') this.setColor(this.selectedColor().color, value);
      else {
        const rgb = hexToRgb(this.selectedColor().color);
        rgb[key] = value;
        this.setRgbColor(rgbToHex(rgb));
      }
    }
  }

  setRgbColor(color) {
    const hsv = rgbToHsv(hexToRgb(color));
    if (!hsv.s || !hsv.v) hsv.h = this.hsv.h;
    this.hsv = hsv;
    this.setColor(color);
    this.refreshPicker();
  }

  setPosition(index, position) {
    if (this.fill.type === 'solid' || !this.fill.stops[index]) return;
    const next = copyFill(this.fill);
    next.stops[index].position = Number(position.toFixed(3));
    this.commit(next);
  }

  pointerDown(event) {
    if (event.button !== 0 || !this.canEdit()) return;
    const stop = event.target.closest('[data-fill-stop]');
    const sv = event.target.closest('.fill-sv');
    const range = event.target.matches('[data-fill-picker][type="range"]') ? event.target : null;
    if (!stop && !sv && !range) return;
    if (stop) this.selectStop(Number(stop.dataset.fillStop));
    const target = stop || sv || range;
    this.gesture = { pointerId: event.pointerId, target, kind: stop ? 'stop' : sv ? 'sv' : 'range', index: stop ? Number(stop.dataset.fillStop) : null, saved: false };
    if (!range) {
      event.preventDefault();
      target.focus({ preventScroll: true });
      target.setPointerCapture(event.pointerId);
      this.pointerMove(event);
    }
  }

  pointerMove(event) {
    if (!this.canEdit() || !this.gesture || event.pointerId !== this.gesture.pointerId) return;
    if (this.gesture.kind === 'stop') {
      const rect = this.track.getBoundingClientRect();
      if (rect.width) this.setPosition(this.gesture.index, clamp((event.clientX - rect.left) / rect.width * 100, 0, 100));
    } else if (this.gesture.kind === 'sv') {
      const rect = this.sv.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.hsv.s = clamp((event.clientX - rect.left) / rect.width * 100, 0, 100);
      this.hsv.v = clamp(100 - (event.clientY - rect.top) / rect.height * 100, 0, 100);
      this.setColor(hsvToHex(this.hsv));
      this.refreshPicker();
    }
  }

  endPointer(event) {
    if (this.gesture?.pointerId === event.pointerId) this.gesture = null;
  }

  keyDown(event) {
    if (!this.canEdit()) return;
    const stop = event.target.closest('[data-fill-stop]');
    const sv = event.target.closest('.fill-sv');
    if ((!stop && !sv) || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    if (stop) {
      const index = Number(stop.dataset.fillStop);
      this.selectStop(index);
      let position = this.fill.stops[index].position;
      if (event.key === 'Home') position = 0;
      else if (event.key === 'End') position = 100;
      else position += ['ArrowRight', 'ArrowUp', 'PageUp'].includes(event.key) ? step : -step;
      this.setPosition(index, clamp(position, 0, 100));
    } else {
      if (event.key === 'Home') this.hsv.s = 0;
      else if (event.key === 'End') this.hsv.s = 100;
      else if (event.key === 'ArrowLeft') this.hsv.s = clamp(this.hsv.s - step, 0, 100);
      else if (event.key === 'ArrowRight') this.hsv.s = clamp(this.hsv.s + step, 0, 100);
      else this.hsv.v = clamp(this.hsv.v + (['ArrowUp', 'PageUp'].includes(event.key) ? step : -step), 0, 100);
      this.setColor(hsvToHex(this.hsv));
      this.refreshPicker();
    }
  }

  destroy() {
    this.gesture = null;
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.savedGradients.clear();
    this.previewCanvases.clear();
    this.previewCache.clear();
  }
}
