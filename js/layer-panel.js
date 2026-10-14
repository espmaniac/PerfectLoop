import { ALIGNMENTS } from './alignment.js';
import { $, escapeHTML, icon } from './ui.js';
import { MAX_LAYERS, MAX_ANIMATION_CYCLES, animationCycles } from './layers.js';
import { patchInterval } from './video-patch.js';
import { framePlan } from './logic.js';
import { fontOptions, deviceFontsSupported } from './fonts.js';
import { TextFillEditor } from './text-fill-editor.js';

const ALIGNMENT_ICONS = { left: 'AlignLeft', 'center-x': 'AlignCenterHorizontal', right: 'AlignRight', top: 'AlignTop', 'center-y': 'AlignCenterVertical', bottom: 'AlignBottom' };

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
  constructor(getState, updateLayer, action, updateVideo) {
    this.getState = getState;
    this.updateLayer = updateLayer;
    this.action = action;
    this.updateVideo = updateVideo;
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
      this.action(button.dataset.layerAction, button.dataset.layerId || this.getState().activeLayerId);
    });
    const change = event => {
      const input = event.target;
      const key = input.dataset.layerSetting;
      const state = this.getState();
      if (input.hasAttribute('data-layer-until-end') && !state.job && state.activeLayerId) {
        const layer = state.s.layers.find(l => l.id === state.activeLayerId);
        this.updateLayer(state.activeLayerId, { endTime: input.checked ? null : Math.max(framePlan(state.s).duration, (layer.startTime ?? 0) + 1 / state.s.fps) }); return;
      }
      const videoKey = input.dataset.videoSetting;
      if (videoKey && state.activeLayerId === 'video' && state.info.duration && !state.job) {
        if (input.value === '' && input.type === 'number') return;
        const value = input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' || input.type === 'color' ? input.value : Number(input.value);
        if (typeof value !== 'number' || Number.isFinite(value)) this.updateVideo({ [videoKey]: value });
        return;
      }
      if (!key || state.job || !state.activeLayerId || state.activeLayerId === 'video') return;
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
      if (event.target.dataset.layerSetting || event.target.dataset.videoSetting) this.refreshBindings();
    });
  }

  render() {
    const state = this.getState();
    const layers = state.s.layers || [];
    this.panel.querySelectorAll('[data-action="layer-add-text"], [data-action="layer-add-image"], [data-action="layer-add-patch"], [data-action="layer-add-video-patch"]').forEach(button => {
      button.disabled = Boolean(state.job) || layers.length >= MAX_LAYERS;
    });
    const selectedVideo = state.activeLayerId === 'video';
    const selected = layers.find(layer => layer.id === state.activeLayerId);
    const listKey = JSON.stringify(layers.map(layer => [layer.id, layer.type, layerLabel(layer), layer.visible, layer.placement]).concat([[state.activeLayerId, state.info.duration]]));
    if (this.listKey !== listKey) {
      this.listKey = listKey;
      this.list.innerHTML = [...layers].sort((a,b)=>Number(b.placement==='below')-Number(a.placement==='below')).reverse().map(layer => {
        const id = escapeHTML(layer.id);
        const label = escapeHTML(layerLabel(layer));
        const visible = layer.visible !== false;
        const active = layer.id === state.activeLayerId;
        const firstBelow=layer.placement==='below' && layers.filter(l=>l.placement==='below').at(-1)?.id===layer.id;
        return `${firstBelow ? this.videoRow(state) : ''}<div class="layer-item${active ? ' selected' : ''}${visible ? '' : ' muted'}" role="listitem">
          <div class="layer-item-head">
            <button class="layer-select" data-layer-action="select" data-layer-id="${id}" aria-pressed="${active}" title="${label}"><span class="layer-type">${layer.type === 'text' ? 'T' : icon('Layers', 17)}</span><span><b>${label}</b><small>${layer.placement === 'below' ? 'Below video · ' : 'Above video · '}${layer.videoPatch ? 'Video patch' : layer.patch ? 'Patch' : layer.type === 'text' ? 'Text' : 'Image'}</small></span></button>
            <button class="text-btn layer-visibility" data-layer-action="toggle" data-layer-id="${id}" aria-label="${visible ? 'Hide' : 'Show'} ${label}" aria-pressed="${visible}">${icon(visible ? 'EyeOff' : 'Eye', 14)}<span>${visible ? 'Hide' : 'Show'}</span></button>
          </div>
          <div class="layer-item-actions">
            <button class="icon-btn" data-layer-action="up" data-layer-id="${id}" aria-label="Move ${label} up" ${layers.filter(l=>(l.placement||'above')===(layer.placement||'above')).at(-1)?.id===layer.id ? 'data-order-disabled' : ''}>↑</button>
            <button class="icon-btn" data-layer-action="down" data-layer-id="${id}" aria-label="Move ${label} down" ${layers.find(l=>(l.placement||'above')===(layer.placement||'above'))?.id===layer.id ? 'data-order-disabled' : ''}>↓</button>
            <button class="text-btn" data-layer-action="duplicate" data-layer-id="${id}">${icon('Copy', 14)}<span>Duplicate</span></button>
            <button class="text-btn" data-layer-action="delete" data-layer-id="${id}" aria-label="Delete ${label}">${icon('Trash2', 14)}<span>Delete</span></button>
          </div>
        </div>`;
      }).join('') + (layers.some(l=>l.placement==='below') ? '' : this.videoRow(state));
    }
    $('#layer-empty').hidden = layers.length > 0 || selectedVideo && Boolean(state.info.duration);
    this.controls.hidden = !selected && !selectedVideo;
    const controlsKey = selectedVideo ? 'video' : selected ? `${selected.id}:${selected.type}:${Boolean(selected.patch)}:${Boolean(selected.videoPatch)}` : '';
    if (this.controlsKey !== controlsKey) {
      this.fillEditor?.destroy();
      this.fillEditor = null;
      this.controlsKey = controlsKey;
      this.controls.innerHTML = selectedVideo ? this.videoFields() : selected ? this.fields(selected.type, selected.patch, selected.videoPatch) : '';
      const fillHost = this.controls.querySelector('[data-text-fill-editor]');
      if (fillHost) this.fillEditor = new TextFillEditor(fillHost, this.getState, this.updateLayer);
    }
    this.panel.querySelectorAll('[data-layer-action]').forEach(button => {
      button.disabled = Boolean(state.job) || button.hasAttribute('data-order-disabled') || button.dataset.layerAction === 'select-video' && !state.info.duration;
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

  videoRow(state) {
    return `<div class="layer-video-marker${state.activeLayerId === 'video' ? ' selected' : ''}" role="listitem"><button class="layer-select" data-layer-action="select-video" aria-pressed="${state.activeLayerId === 'video'}" aria-label="Select video settings"><span class="layer-type">${icon('Layers', 17)}</span><span><b>Video</b><small>Video framing · select to edit</small></span></button></div>`;
  }

  videoFields() {
    return `<p class="micro">Set the video's position and scale here. Dragging the video stays locked in Layers.</p>
      ${selectField('fit', 'Fit video', [['contain','Fit'],['cover','Fill & crop'],['stretch','Stretch']]).replace('data-layer-setting','data-video-setting')}
      <div class="fields two">
        ${numberField('zoom','Video scale',25,400,'%',0.1).replace('data-layer-setting','data-video-setting')}
        ${numberField('rotate','Video rotation',-360,360,'°',0.1).replace('data-layer-setting','data-video-setting')}
      </div>
      <div class="fields two">
        ${numberField('cropX','Horizontal position',0,100,'%',0.1).replace('data-layer-setting','data-video-setting')}
        ${numberField('cropY','Vertical position',0,100,'%',0.1).replace('data-layer-setting','data-video-setting')}
      </div>
      <div class="fields two"><label class="field"><span>Border color</span><input type="color" data-video-setting="background" aria-label="Border color"></label><label class="toggle-row"><span>Mirror horizontally</span><input type="checkbox" data-video-setting="mirror"><span class="switch" aria-hidden="true"></span></label></div>
      <div class="field"><span>Align video to frame</span><div class="alignment-controls" role="group" aria-label="Align video to frame">${ALIGNMENTS.map(([key,label])=>`<button class="text-btn" data-video-align="${key}" title="${label}">${icon(ALIGNMENT_ICONS[key], 15)}<span>${label}</span></button>`).join('')}</div></div>
      <button class="btn secondary" type="button" data-action="reset-framing" aria-label="Reset video scale, position, and rotation">${icon('RotateCcw', 16)}<span>Reset video framing</span></button>`;
  }

  fields(type, patch = false, videoPatch = false) {
    const content = type === 'text'
      ? `<label class="field layer-text-field"><span>Text</span><textarea data-layer-setting="text" aria-label="Text" maxlength="500" rows="3" spellcheck="false"></textarea></label>`
        + `<label class="field"><span>Font</span><select aria-label="Font" aria-describedby="layer-font-help" data-layer-setting="fontFamily"></select></label>`
        + `<div class="layer-font-actions"><button class="btn secondary" type="button" data-action="layer-device-fonts" aria-describedby="layer-font-help">${icon('Monitor', 16)}<span>Use device fonts</span></button><button class="btn secondary" type="button" data-action="layer-upload-fonts">${icon('Upload', 16)}<span>Upload fonts</span></button></div>`
        + `<p class="micro" id="layer-font-help">${deviceFontsSupported()
          ? 'Device fonts require browser permission. Upload TTF, OTF, WOFF, or WOFF2 files to add other fonts.'
          : 'This browser cannot list installed fonts. Upload TTF, OTF, WOFF, or WOFF2 files instead.'}</p>`
        + numberField('fontSize', 'Font size', 8, 256, 'px')
        + `<div class="text-fill-editor" data-text-fill-editor></div>`
        + selectField('align', 'Text alignment', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])
      : numberField('width', patch ? 'Patch width' : 'Image width', 1, 400, '%');
    return (videoPatch ? '<p class="micro">Video patch · one forward cycle fits the active interval. Adjust seam blending to soften the repeat. Recreate it to change the donor fragment or video framing. No motion tracking or audio.</p>' : patch ? '<p class="micro">Patch layer · fixed frame fragment. Recreate it after changing video framing. There is no motion tracking.</p>' : '') + content
      + `<details class="disclosure" ${patch ? 'open' : ''}><summary>Active time</summary><div class="disclosure-content"><p class="micro">Seconds in each finished loop, not source timestamps. The interval repeats with the loop.</p>
      ${numberField('startTime', 'Show from', 0, 86400, 's', 0.001)}
      <label class="toggle-row"><span>Until end of loop</span><input type="checkbox" data-layer-until-end><span class="switch" aria-hidden="true"></span></label>
      ${numberField('endTime', 'Show until', 0, 86400, 's', 0.001)}<p class="micro" data-layer-time-note></p></div></details>`
      + (videoPatch ? '<p class="micro" data-video-patch-summary></p>' + numberField('seamBlend', 'Seam blend', 0, 40, '%')
        + `<div class="fields two">${numberField('fadeIn', 'Fade in', 0, 60, 's', 0.05)}${numberField('fadeOut', 'Fade out', 0, 60, 's', 0.05)}</div><p class="micro">Fades are limited to half the active interval. Leave both at zero for a continuous patch across the loop boundary.</p>` : '')
      + selectField('placement', 'Stack position', [['above','Above video'],['below','Below video']])
      + '<p class="micro">Below-video layers appear where the video leaves space. Use Fit or reduce the video scale to reveal them.</p>'
      + `<div class="field"><span>Align to frame · starting position</span><div class="alignment-controls" role="group" aria-label="Align layer to frame">${ALIGNMENTS.map(([key,label])=>`<button class="text-btn" data-layer-action="align-${key}" title="${label}">${icon(ALIGNMENT_ICONS[key], 15)}<span>${label}</span></button>`).join('')}</div></div>`
      + `<div class="fields two">${numberField('x', 'Horizontal', 0, 100, '%', 0.1)}${numberField('y', 'Vertical', 0, 100, '%', 0.1)}</div>`
      + `<div class="fields two">${numberField('rotation', 'Rotation', -360, 360, '°')}${numberField('opacity', 'Opacity', 0, 100, '%')}</div>`
      + (patch ? '<details class="disclosure"><summary>Optional animation</summary><div class="disclosure-content">' : '')
      + selectField('spin', 'Rotation animation', SPINS)
      + `<p class="micro">Rotation sets the starting angle. Rotation speed controls how many full turns fit into each finished loop.</p>`
      + animationSpeedField('spin', 'Rotation speed')
      + selectField('motion', 'Movement', MOTIONS)
      + animationSpeedField('motion', 'Movement speed')
      + (patch ? '</div></details>' : '');
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
    if (state.activeLayerId === 'video') {
      this.controls.querySelectorAll('[data-video-setting]').forEach(input => {
        if (input === document.activeElement && input.type === 'number') return;
        const raw = state.s[input.dataset.videoSetting];
        if (input.type === 'checkbox') input.checked = Boolean(raw);
        else input.value = String(raw);
        input.disabled = Boolean(state.job) || !state.info.duration;
      });
      return;
    }
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
        : layer[key] ?? (key === 'placement' ? 'above' : key === 'spin' ? 'none' : key === 'startTime' ? 0 : key === 'endTime' ? framePlan(state.s).duration : '');
      const value = String(typeof raw === 'number' ? Math.round(raw * 1000) / 1000 : raw);
      if (input.value !== value) input.value = value;
    });
    const duration = framePlan(state.s).duration;
    const donorSummary = this.controls.querySelector('[data-video-patch-summary]');
    if (donorSummary) {
      const active = patchInterval(layer, duration).duration;
      const donor = layer.sourceEnd - layer.sourceStart;
      const speed = active > 0 ? donor * (1 - layer.seamBlend / 100) / active : 0;
      donorSummary.textContent = `Source: ${layer.sourceStart.toFixed(3)}–${layer.sourceEnd.toFixed(3)}s · one cycle in ${active.toFixed(3)}s · ${speed.toFixed(2)}× donor speed. Seam blending may show double edges; use a clean fragment with similar motion.`;
    }
    this.controls.querySelector('[data-layer-until-end]').checked = layer.endTime == null;
    this.controls.querySelector('[data-layer-setting="endTime"]').disabled = layer.endTime == null || Boolean(state.job);
    this.controls.querySelector('[data-layer-time-note]').textContent = `Loop length: ${duration.toFixed(3)}s. ${(layer.startTime ?? 0) >= duration ? 'This layer starts outside the current loop.' : 'Intervals extending beyond the loop are clipped at its end.'}`;
    this.controls.querySelectorAll('[data-layer-speed]').forEach(field => {
      const kind = field.dataset.layerSpeed;
      field.hidden = !layer[kind] || layer[kind] === 'none';
      const output = field.querySelector('output');
      const summary = animationSpeedSummary(kind, animationCycles(layer, kind), duration);
      if (output.textContent !== summary) output.textContent = summary;
    });
  }
}
