import { $, escapeHTML, icon } from './ui.js';
import { MAX_LAYERS } from './layers.js';

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

function numberField(key, label, min, max, suffix, step = 1) {
  return `<label class="field"><span>${label}</span><div class="input-unit"><input type="number" aria-label="${label}" data-layer-setting="${key}" min="${min}" max="${max}" step="${step}"><span>${suffix}</span></div></label>`;
}

function selectField(key, label, options) {
  return `<label class="field"><span>${label}</span><select aria-label="${label}" data-layer-setting="${key}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
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
      if (input.type === 'number' && input.value === '') return;
      const value = input.type === 'number' ? Number(input.value) : input.value;
      if (typeof value === 'number' && !Number.isFinite(value)) return;
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
      this.controlsKey = controlsKey;
      this.controls.innerHTML = selected ? this.fields(selected.type) : '';
    }
    this.panel.querySelectorAll('[data-layer-action]').forEach(button => {
      button.disabled = Boolean(state.job) || button.hasAttribute('data-order-disabled');
    });
    this.refreshBindings();
  }

  fields(type) {
    const content = type === 'text'
      ? `<label class="field layer-text-field"><span>Text</span><textarea data-layer-setting="text" aria-label="Text" maxlength="500" rows="3" spellcheck="false"></textarea></label>`
        + selectField('fontFamily', 'Font', [['sans-serif', 'Sans serif'], ['serif', 'Serif'], ['monospace', 'Monospace']])
        + `<div class="fields two">${numberField('fontSize', 'Font size', 8, 256, 'px')}<label class="field"><span>Text color</span><input type="color" data-layer-setting="color" aria-label="Text color"></label></div>`
        + selectField('align', 'Alignment', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])
      : numberField('width', 'Image width', 1, 100, '%');
    return content
      + `<div class="fields two">${numberField('x', 'Horizontal', 0, 100, '%', 0.1)}${numberField('y', 'Vertical', 0, 100, '%', 0.1)}</div>`
      + `<div class="fields two">${numberField('rotation', 'Rotation', -360, 360, '°')}${numberField('opacity', 'Opacity', 0, 100, '%')}</div>`
      + selectField('motion', 'Movement', MOTIONS);
  }

  refreshBindings() {
    const state = this.getState();
    const layer = (state.s.layers || []).find(item => item.id === state.activeLayerId);
    if (!layer) return;
    const movement = this.controls.querySelector('[data-layer-setting="motion"]');
    const rotated = Number.isFinite(layer.rotation) && layer.rotation % 360 !== 0;
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
      if (input === document.activeElement && input !== movement) return;
      const value = String(layer[input.dataset.layerSetting] ?? '');
      if (input.value !== value) input.value = value;
    });
  }
}
