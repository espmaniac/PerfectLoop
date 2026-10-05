import { icons } from './icons.js';

export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];
export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function icon(name, size = 16) {
  const children = (icons[name] || []).map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== 'key').map(([key, value]) => `${key}="${escapeHTML(value)}"`).join(' ')}></${tag}>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}
export function decorateIcons() {
  $$('[data-icon]').forEach(el => {
    const key = `${el.dataset.icon}-${el.dataset.size || 16}`;
    if (el.dataset.rendered !== key) { el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16); el.dataset.rendered = key; }
  });
}
function binding(key, scope = 'setting') { return `data-${scope}="${key}"`; }
export function numberField(key, label, { min = 0, max, step = 0.1, suffix = '', scope = 'setting' } = {}) {
  return `<label class="field" id="field-${scope}-${key}"><span>${label}</span><div class="input-unit"><input type="number" aria-label="${label}" ${binding(key, scope)} data-number min="${min}" ${max === undefined ? '' : `max="${max}"`} step="${step}">${suffix ? `<span>${suffix}</span>` : ''}</div></label>`;
}
export function selectField(key, label, options, { numeric = false, scope = 'setting' } = {}) {
  return `<label class="field" id="field-${scope}-${key}"><span>${label}</span><select aria-label="${label}" ${binding(key, scope)} ${numeric ? 'data-number' : ''}>${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;
}
export function toggleField(key, label, { detail = '', scope = 'setting' } = {}) {
  return `<label class="toggle-row" id="field-${scope}-${key}"><span>${label}${detail ? `<small>${detail}</small>` : ''}</span><input type="checkbox" aria-label="${label}" ${binding(key, scope)}><span class="switch" aria-hidden="true"></span></label>`;
}
function rangeField(key, label) {
  return `<label class="range-field" id="field-setting-${key}"><span>${label}<b data-value="${key}">50%</b></span><input aria-label="${label}" type="range" min="0" max="100" step="1" data-setting="${key}" data-number></label>`;
}
function rangeNumberField(key, label, options) {
  const html = numberField(key, label, options);
  return html.replace('class="field"', 'class="field range-number-field"').replace('</label>', `<input type="range" aria-label="${label} slider" data-setting="${key}" data-number min="${options.min}" max="${options.max}" step="${options.step}"></label>`);
}
export function initializeFields() {
  $('#method-fields').innerHTML = rangeNumberField('speed', 'Playback speed', { min: 0.25, max: 4, step: 0.05, suffix: '×' })
    + rangeNumberField('transition', 'Overlap', { min: 0.01, max: 30, step: 0.033333, suffix: 's' })
    + selectField('curve', 'Blend curve', [['linear', 'Linear'], ['smooth', 'Smoothstep'], ['cosine', 'Cosine']])
    + numberField('shift', 'Seam position', { min: 0, max: 99, step: 1, suffix: '%' });
  $('#loop-settings').prepend($('#field-setting-shift'));
  $('#framing-fields').innerHTML = selectField('fit', 'Fit mode', [['cover', 'Fill & crop'], ['contain', 'Fit with borders'], ['stretch', 'Stretch']])
    + rangeField('cropX', 'Horizontal crop') + rangeField('cropY', 'Vertical crop')
    + `<div class="fields two">${selectField('rotate', 'Rotation', [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']], { numeric: true })}<label class="field"><span>Border color</span><input type="color" data-setting="background" aria-label="Border color"></label></div>`
    + toggleField('mirror', 'Mirror horizontally')
    + toggleField('interpolate', 'Motion interpolation', { detail: 'Smoother speed changes; significantly slower to render.' });
  $('#search-range-fields').innerHTML = numberField('from', 'Search from', { suffix: 's', scope: 'search' })
    + numberField('to', 'Search to', { suffix: 's', scope: 'search' })
    + numberField('min', 'Min loop length', { min: 0.1, suffix: 's', scope: 'search' })
    + numberField('max', 'Max loop length', { min: 0.1, suffix: 's', scope: 'search' });
  $('#search-options').innerHTML = selectField('precision', 'Search precision', [['fast', 'Quick · 0.5s samples'], ['balanced', 'Balanced · 0.25s samples'], ['detailed', 'Detailed · 0.1s samples']], { scope: 'search' })
    + toggleField('preferMotion', 'Prefer visible motion', { scope: 'search' })
    + toggleField('avoidCuts', 'Avoid scene cuts', { scope: 'search' });
  $('#preset-field').innerHTML = selectField('preset', 'Destination preset', [['spotify', 'Spotify Canvas'], ['vertical', 'Vertical music visual'], ['custom', 'Custom']]);
  $('#dimension-fields').innerHTML = numberField('width', 'Width', { min: 16, max: 3840, step: 2, suffix: 'px' }) + numberField('height', 'Height', { min: 16, max: 3840, step: 2, suffix: 'px' });
  $('#format-fields').innerHTML = selectField('fps', 'Frame rate', [12, 15, 24, 25, 30, 48, 50, 60].map(n => [n, `${n} fps`]), { numeric: true })
    + selectField('format', 'Format', [['mp4', 'MP4 · H.264'], ['webm', 'WebM · VP8'], ['gif', 'Animated GIF']]);
  $('#quality-field').innerHTML = selectField('quality', 'Quality', [['high', 'High quality'], ['balanced', 'Balanced'], ['small', 'Smaller file']]);
  $('#audio-fields').innerHTML = toggleField('strip', 'Remove audio track', { scope: 'audio', detail: 'The exported video contains no audio stream.' })
    + toggleField('smooth', 'Smooth audio boundary', { scope: 'audio', detail: 'Fade the audio at natural cuts. Dissolves blend it automatically.' })
    + '<p class="micro" id="rebound-audio-note">Rebound also reverses audio. Eased video uses a linear audio timeline. Silent output is recommended for Canvas.</p>'
    + '<div id="gif-playback-settings" hidden>'
    + toggleField('gifLoop', 'Loop forever', { detail: 'The exported GIF repeats continuously when on; plays once when off.' })
    + '<p class="micro">GIFs have no audio. File size depends on dimensions, frame rate, and cycle duration.</p></div>';
  $('#extra-export-fields').innerHTML = numberField('repeats', 'Cycles in video', { min: 1, max: 50, step: 1 })
    + '<p class="micro">Adds full loop cycles to the exported video. Automatic playback looping depends on the player.</p>'
    + numberField('targetMB', 'Approx. target size', { min: 0, max: 2000, step: 0.5, suffix: 'MB' })
    + '<p class="micro">0 MB uses the quality setting. The exported file may be larger or smaller than the target.</p>';
  $('#trim-fields').innerHTML = numberField('start', 'In point', { min: 0, step: 1 / 30, suffix: 's' })
    + numberField('end', 'Out point (exclusive)', { min: 0, step: 1 / 30, suffix: 's' })
    + '<div class="range-summary"><span>Duration (source)</span><b><span id="timeline-source-duration"></span><small> s</small></b></div>'
    + '<div class="range-summary"><span>Finished loop</span><b><span id="timeline-output-duration"></span><small> s</small></b></div>';
  $('#field-setting-start > span').textContent = 'In';
  $('#field-setting-end > span').textContent = 'Out';
  decorateIcons();
}
