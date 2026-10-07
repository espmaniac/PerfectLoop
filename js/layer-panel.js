import { $, escapeHTML, icon } from './ui.js';
import { MAX_LAYERS, MAX_ANIMATION_CYCLES, animationCycles } from './layers.js';
import { framePlan } from './logic.js';
import { fontOptions, deviceFontsSupported } from './fonts.js';
import { TextFillEditor } from './text-fill-editor.js';

const MOTIONS = [
  ['none', 'Static'],
  ['right', 'Left to right'],
  ['left', 'Right to left'],
  ['down', 'Top to bottom'],
  ['up', 'Bottom to top'],
];
const ROTATED_MOTIONS = [
  ['along-angle', 'Along rotation'],
  ['against-angle', 'Against rotation'],
];
const SPINS = [
  ['none', 'Static'],
  ['clockwise', 'Clockwise'],
  ['counterclockwise', 'Counterclockwise'],
];

function numberField(key, label, min, max, suffix, step = 1) {
  return `<label class="field"><span>${label}</span><div class="input-unit"><input type="number" aria-label="${label}" data-layer-setting="${key}" min="${min}" max="${max}" step="${step}"><span>${suffix}</span></div></label>`;
}

function selectField(key, label, options) {
  return `<label class="field"><span>${label}</span><select aria-label="${label}" data-layer-setting="${key}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
}

function animationSpeedField(kind, label) {
  const key = `${kind}Cycles`;
  const id = `layer-${key}`;
  const note = kind === 'spin'
    ? 'Whole turns return to the starting angle at the loop boundary.'
    : 'Whole passes return to the starting position at the loop boundary.';
  return `<div class="layer-animation-speed" data-layer-speed="${kind}" hidden>
    <label class="range-field" for="${id}"><span>${label}</span><input id="${id}" type="range" min="1" max="${MAX_ANIMATION_CYCLES}" step="1" data-layer-setting="${key}" aria-describedby="${id}-summary ${id}-note"></label>
    <output class="layer-speed-summary" id="${id}-summary" for="${id}"></output>
    <p class="micro" id="${id}-note">${note}</p>
  </div>`;
}

function animationSpeedSummary(kind, cycles, duration) {
  const unit = kind === 'spin' ? 'turn' : 'pass';
  const count = `${cycles} ${unit}${cycles === 1 ? '' : kind === 'spin' ? 's' : 'es'}/loop`;
  if (!Number.isFinite(duration) || duration <= 0) return `${count} · choose a valid loop range to see speed`;
  const speed = (kind === 'spin' ? 360 : 1) * cycles / duration;
  const rate = Number(speed >= 0.001 ? speed.toFixed(3) : speed.toPrecision(3));
  return `${count} · ${rate}${kind === 'spin' ? '°/s' : ` ${rate === 1 ? 'pass' : 'passes'}/s`}`;
}

function layerLabel(layer) {
  return layer.type === 'text' ? layer.text.trim() || 'Empty text' : layer.name || 'Image';
}

export class LayerPanel {
  constructor(getState, updateLayer, action) {
    this.getState = getState;
    this.updateLayer = updateLayer;
    this.action = action;
    this.panel = $('#panel-layers');
    this.list = $('#layer-list');
    this.controls = $('#layer-controls');
    this.listKey = '';
    this.controlsKey = '';
    this.fontOptionsKey = '';
    this.fontSelect = null;
    this.fillEditor = null;
    this.panel.addEventListener('click', event => {
      const button = event.target.closest('[data-layer-action]');
      if (!button || button.disabled || this.getState().job) return;
      this.action(button.dataset.layerAction, button.dataset.layerId);
    });
    const change = event => {
      const input = event.target;
      const key = input.dataset.layerSetting;
      const state = this.getState();
      if (!key || state.job || !state.activeLayerId) return;
      const numeric = input.type === 'number' || input.type === 'range';
      if (numeric && input.value === '') return;
      const value = numeric ? Number(input.value) : input.value;
      if (typeof value === 'number' && !Number.isFinite(value)) return;
      if (key === 'fontFamily') {
        this.action('font', state.activeLayerId, value);
        this.refreshBindings();
        return;
      }
      this.updateLayer(state.activeLayerId, { [key]: value });
    };
    this.panel.addEventListener('input', event => {
      if (event.target.tagName !== 'SELECT') change(event);
    });
    this.panel.addEventListener('change', event => {
      if (event.target.tagName === 'SELECT') change(event);
    });
    this.panel.addEventListener('focusout', event => {
      if (event.target.dataset.layerSetting) this.refreshBindings();
    });
  }

  render() {
    const state = this.getState();
    const layers = state.s.layers || [];
    this.panel.querySelectorAll('[data-action="layer-add-text"], [data-action="layer-add-image"]').forEach(button => {
      button.disabled = Boolean(state.job) || layers.length >= MAX_LAYERS;
    });
    const selected = layers.find(layer => layer.id === state.activeLayerId);
    const listKey = JSON.stringify(layers.map(layer => [layer.id, layer.type, layerLabel(layer), layer.visible]).concat([[state.activeLayerId]]));
    if (this.listKey !== listKey) {
      this.listKey = listKey;
      this.list.innerHTML = [...layers].reverse().map((layer, index) => {
        const id = escapeHTML(layer.id);
        const label = escapeHTML(layerLabel(layer));
        const visible = layer.visible !== false;
        const active = layer.id === state.activeLayerId;
        return `<div class="layer-item${active ? ' selected' : ''}${visible ? '' : ' muted'}" role="listitem">
          <div class="layer-item-head">
            <button class="layer-select" data-layer-action="select" data-layer-id="${id}" aria-pressed="${active}" title="${label}"><span class="layer-type">${layer.type === 'text' ? 'T' : icon('Layers', 17)}</span><span><b>${label}</b><small>${layer.type === 'text' ? 'Text' : 'Image'}</small></span></button>
            <button class="text-btn layer-visibility" data-layer-action="toggle" data-layer-id="${id}" aria-label="${visible ? 'Hide' : 'Show'} ${label}" aria-pressed="${visible}">${visible ? 'Hide' : 'Show'}</button>
          </div>
          <div class="layer-item-actions">
            <button class="icon-btn" data-layer-action="up" data-layer-id="${id}" aria-label="Move ${label} up" ${index === 0 ? 'data-order-disabled' : ''}>↑</button>
            <button class="icon-btn" data-layer-action="down" data-layer-id="${id}" aria-label="Move ${label} down" ${index === layers.length - 1 ? 'data-order-disabled' : ''}>↓</button>
            <button class="text-btn" data-layer-action="duplicate" data-layer-id="${id}">Duplicate</button>
            <button class="text-btn" data-layer-action="delete" data-layer-id="${id}" aria-label="Delete ${label}">Delete</button>
          </div>
        </div>`;
      }).join('');
    }
    $('#layer-empty').hidden = layers.length > 0;
    this.controls.hidden = !selected;
    const controlsKey = selected ? `${selected.id}:${selected.type}` : '';
    if (this.controlsKey !== controlsKey) {
      this.fillEditor?.destroy();
      this.fillEditor = null;
      this.controlsKey = controlsKey;
      this.controls.innerHTML = selected ? this.fields(selected.type) : '';
      const fillHost = this.controls.querySelector('[data-text-fill-editor]');
      if (fillHost) this.fillEditor = new TextFillEditor(fillHost, this.getState, this.updateLayer);
    }
    this.panel.querySelectorAll('[data-layer-action]').forEach(button => {
      button.disabled = Boolean(state.job) || button.hasAttribute('data-order-disabled');
    });
    const deviceFonts = this.controls.querySelector('[data-action="layer-device-fonts"]');
    if (deviceFonts) {
      deviceFonts.disabled = Boolean(state.job) || !deviceFontsSupported();
      deviceFonts.title = deviceFontsSupported()
        ? 'Allow this browser to list installed fonts.'
        : 'This browser cannot list installed fonts. Upload font files instead.';
    }
    const uploadFonts = this.controls.querySelector('[data-action="layer-upload-fonts"]');
    if (uploadFonts) uploadFonts.disabled = Boolean(state.job);
    this.refreshBindings();
  }

  fields(type) {
    const content = type === 'text'
      ? `<label class="field layer-text-field"><span>Text</span><textarea data-layer-setting="text" aria-label="Text" maxlength="500" rows="3" spellcheck="false"></textarea></label>`
        + `<label class="field"><span>Font</span><select aria-label="Font" aria-describedby="layer-font-help" data-layer-setting="fontFamily"></select></label>`
        + `<div class="layer-font-actions"><button class="btn secondary" type="button" data-action="layer-device-fonts" aria-describedby="layer-font-help">Use device fonts</button><button class="btn secondary" type="button" data-action="layer-upload-fonts">Upload fonts</button></div>`
        + `<p class="micro" id="layer-font-help">${deviceFontsSupported()
          ? 'Device fonts require browser permission. Upload TTF, OTF, WOFF, or WOFF2 files to add other fonts.'
          : 'This browser cannot list installed fonts. Upload TTF, OTF, WOFF, or WOFF2 files instead.'}</p>`
        + numberField('fontSize', 'Font size', 8, 256, 'px')
        + `<div class="text-fill-editor" data-text-fill-editor></div>`
        + selectField('align', 'Alignment', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])
      : numberField('width', 'Image width', 1, 400, '%');
    return content
      + `<div class="fields two">${numberField('x', 'Horizontal', 0, 100, '%', 0.1)}${numberField('y', 'Vertical', 0, 100, '%', 0.1)}</div>`
      + `<div class="fields two">${numberField('rotation', 'Rotation', -360, 360, '°')}${numberField('opacity', 'Opacity', 0, 100, '%')}</div>`
      + selectField('spin', 'Rotation animation', SPINS)
      + `<p class="micro">Rotation sets the starting angle. Rotation speed controls how many full turns fit into each finished loop.</p>`
      + animationSpeedField('spin', 'Rotation speed')
      + selectField('motion', 'Movement', MOTIONS)
      + animationSpeedField('motion', 'Movement speed');
  }

  refreshFontOptions() {
    const select = this.controls.querySelector('[data-layer-setting="fontFamily"]');
    if (!select) return;
    const options = fontOptions();
    const key = JSON.stringify(options.map(({ id, label, source }) => [id, label, source]));
    if (this.fontOptionsKey === key && this.fontSelect === select) return;
    const previous = select.value;
    const groups = [
      ['Built-in', ['generic', 'bundled']],
      ['Device', ['device']],
      ['Uploaded', ['uploaded']],
    ].map(([label, sources]) => {
      const entries = options.filter(option => sources.includes(option.source));
      if (!entries.length) return null;
      const group = document.createElement('optgroup');
      group.label = label;
      entries.forEach(({ id, label }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        group.append(option);
      });
      return group;
    }).filter(Boolean);
    select.replaceChildren(...groups);
    if (previous) select.value = previous;
    this.fontOptionsKey = key;
    this.fontSelect = select;
  }

  refreshBindings() {
    const state = this.getState();
    const layer = (state.s.layers || []).find(item => item.id === state.activeLayerId);
    if (!layer) return;
    this.refreshFontOptions();
    this.fillEditor?.refresh(layer, { disabled: Boolean(state.job) });
    const font = this.controls.querySelector('[data-layer-setting="fontFamily"]');
    const movement = this.controls.querySelector('[data-layer-setting="motion"]');
    const spin = this.controls.querySelector('[data-layer-setting="spin"]');
    const rotated = Number.isFinite(layer.rotation) && layer.rotation % 360 !== 0
      || ROTATED_MOTIONS.some(([value]) => layer.motion === value);
    ROTATED_MOTIONS.forEach(([value, label]) => {
      const existing = movement.querySelector(`option[value="${value}"]`);
      if (rotated && !existing) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        movement.append(option);
      } else if (!rotated && existing) existing.remove();
    });
    this.controls.querySelectorAll('[data-layer-setting]').forEach(input => {
      if (input === document.activeElement && input !== movement && input !== spin && input !== font && input.type !== 'range') return;
      const key = input.dataset.layerSetting;
      const raw = key === 'motionCycles' || key === 'spinCycles'
        ? animationCycles(layer, key === 'motionCycles' ? 'motion' : 'spin')
        : layer[key] ?? (key === 'spin' ? 'none' : '');
      const value = String(typeof raw === 'number' ? Math.round(raw * 1000) / 1000 : raw);
      if (input.value !== value) input.value = value;
    });
    const duration = framePlan(state.s).duration;
    this.controls.querySelectorAll('[data-layer-speed]').forEach(field => {
      const kind = field.dataset.layerSpeed;
      field.hidden = !layer[kind] || layer[kind] === 'none';
      const output = field.querySelector('output');
      const summary = animationSpeedSummary(kind, animationCycles(layer, kind), duration);
      if (output.textContent !== summary) output.textContent = summary;
    });
  }
}
