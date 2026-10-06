import { zipSync } from '../vendor/fflate.js';
import { DEFAULTS, METHODS } from './constants.js';
import { alternateFormat, dimensionsForAspect, selectedAspect } from './aspect.js';
import { clamp, download, framePlan, humanSize, timecode, validate } from './logic.js';
import { VideoEngine } from './engine.js';
import { capture, inspectSeam, openVideo, releaseVideo, searchVideo, seekVideo, thumbnails } from './media.js';
import { Preview } from './preview.js';
import { Timeline } from './timeline.js';
import { WallpaperPreview } from './wallpaper-preview.js';
import { keyPhotoTime, phoneProfile, wallpaperPreset, wallpaperRange } from './wallpaper.js';
import { wallpaperDownload } from './wallpaper-export.js';
import { createTextLayer, importImageLayer, duplicateLayer, validateLayers, clearLayerAssets, discardImportedImageLayer, animationCycles, MAX_LAYERS } from './layers.js';
import { LayerPanel } from './layer-panel.js';
import { loadFont, importFontFile, discoverDeviceFonts, clearFonts } from './fonts.js';
import { $, $$, decorateIcons, escapeHTML, icon, initializeFields } from './ui.js';

// All application state is local to this page. No file is uploaded or persisted.
const emptyInfo = { name: '', duration: 0, width: 0, height: 0, fps: 0, hasAudio: false, size: 0 };
const state = {
  s: { ...DEFAULTS }, info: { ...emptyInfo }, file: null,
  sourceURL: '', renderURL: '', render: null, renderSignature: '', lastExport: null,
  mode: 'source', tab: 'edit', playhead: 0, filmstrip: [], activeLayerId: '',
  renderSettings: null, renderPlayhead: 0, renderFilmstrip: [],
  wallpaperScreen: 'editor', wallpaperDownload: 'kit', wallpaperPosterURL: '', wallpaperPosterSignature: '',
  opts: { from: 0, to: 18, min: 3, max: 8, precision: 'balanced', preferMotion: true, avoidCuts: true },
  candidates: [], selected: new Set(), seam: null,
  job: null, error: '', nativeError: '', notice: '', controller: null, fileController: null,
};
const history = { past: [], future: [] }, engine = new VideoEngine();
let preview, timeline, layerPanel, wallpaperPreview, sampleController, renderFilmstripController, wallpaperPosterController, wallpaperPosterPending = '', wallpaperDraftFrame = '';
const videoSignature = settings => JSON.stringify({ ...settings, wallpaperPoster: undefined, wallpaperDevice: undefined });
const dirty = () => videoSignature(state.s) !== state.renderSignature;
const busy = () => Boolean(state.job);
const staticHome = () => state.s.preset === 'iphone' && state.wallpaperScreen === 'home';

function clearWallpaperPoster() {
  wallpaperPosterController?.abort(); wallpaperPosterPending = '';
  if (state.wallpaperPosterURL) URL.revokeObjectURL(state.wallpaperPosterURL);
  state.wallpaperPosterURL = ''; state.wallpaperPosterSignature = '';
}
function posterSignature() { return `${state.renderURL}:${state.s.wallpaperPoster}`; }
async function prepareWallpaperPoster() {
  if (state.s.preset !== 'iphone' || !state.renderURL || dirty()) return;
  const signature = posterSignature();
  if (state.wallpaperPosterSignature === signature || wallpaperPosterPending === signature) return;
  wallpaperPosterController?.abort();
  const controller = new AbortController(), url = state.renderURL, result = state.render;
  wallpaperPosterController = controller; wallpaperPosterPending = signature;
  let video;
  try {
    video = await openVideo(url, controller.signal);
    const time = keyPhotoTime(result.duration, result.fps, state.s.wallpaperPoster, result.frames);
    await seekVideo(video, time + 0.5 / result.fps, controller.signal);
    const blob = await new Promise(resolve => capture(video, result.width, result.height).toBlob(resolve, 'image/jpeg', 0.95));
    if (!blob || controller.signal.aborted || state.renderURL !== url || posterSignature() !== signature) return;
    if (state.wallpaperPosterURL) URL.revokeObjectURL(state.wallpaperPosterURL);
    state.wallpaperPosterURL = URL.createObjectURL(blob); state.wallpaperPosterSignature = signature; refresh();
  } catch { /* The phone preview can retain a draft still if decoding is unavailable. */ }
  finally {
    if (video) releaseVideo(video);
    if (wallpaperPosterController === controller) wallpaperPosterPending = '';
  }
}
function setWallpaperScreen(screen) {
  if (busy() || state.s.preset !== 'iphone' || !['editor', 'lock', 'home'].includes(screen)) return;
  state.wallpaperScreen = screen;
  if (screen === 'home') preview.pause();
  if (screen !== 'editor' && state.mode !== 'loop' && state.mode !== 'composition') preview.setMode('composition');
  else refresh();
  wallpaperPreview?.captureStill();
}

function snapshot() { return { s: { ...state.s }, opts: { ...state.opts } }; }
function remember() {
  history.past.push(snapshot()); if (history.past.length > 60) history.past.shift(); history.future = [];
}
function update(partial, saveHistory = true) {
  if ('width' in partial || 'height' in partial) partial = { aspect: 'custom', ...partial };
  if ('rotate' in partial && state.s.aspect === 'original') partial = { ...partial, ...dimensionsForAspect('original', state.info, partial.rotate), aspect: 'original' };
  if (busy() || Object.entries(partial).every(([key, value]) => state.s[key] === value)) return;
  if (saveHistory) remember();
  const leavingWallpaper = state.s.preset === 'iphone' && partial.preset && partial.preset !== 'iphone';
  state.s = { ...state.s, ...partial }; state.seam = null; $('#seam-result').replaceChildren();
  if (leavingWallpaper) {
    state.wallpaperScreen = 'editor';
    if (state.mode === 'composition' && state.tab !== 'layers') { preview.setMode('source'); return; }
  }
  refresh();
}
function restore(value) {
  const searchChanged = JSON.stringify(state.opts) !== JSON.stringify(value.opts);
  state.s = value.s; state.opts = value.opts;
  if (searchChanged) clearCandidates();
  clearSeam();
  if (state.s.preset !== 'iphone') state.wallpaperScreen = 'editor';
  if ((searchChanged && state.tab === 'find') || (state.s.preset !== 'iphone' && state.mode === 'composition' && state.tab !== 'layers')) preview.setMode('source');
  else refresh();
}
function undo() { if (busy() || !history.past.length) return; history.future.push(snapshot()); restore(history.past.pop()); }
function redo() { if (busy() || !history.future.length) return; history.past.push(snapshot()); restore(history.future.pop()); }
function activeRange() {
  return state.tab === 'find' ? { start: state.opts.from, end: state.opts.to } : state.s;
}
function clearCandidates() {
  state.candidates = []; state.selected = new Set(); state.notice = ''; renderCandidates();
}
function updateSearch(partial, saveHistory = true) {
  if (busy()) return;
  const gap = Math.min(state.info.duration, 1 / (state.info.fps || 30));
  if ('from' in partial) partial = { ...partial, from: clamp(partial.from, 0, Math.max(0, state.opts.to - gap)) };
  if ('to' in partial) partial = { ...partial, to: clamp(partial.to, state.opts.from + gap, state.info.duration) };
  if (Object.entries(partial).every(([key, value]) => state.opts[key] === value)) return;
  if (saveHistory) remember();
  state.opts = { ...state.opts, ...partial }; clearCandidates();
  if ('from' in partial || 'to' in partial) preview.setMode('source');
  else refresh();
}
function updateActiveRange(partial, saveHistory = true) {
  if (state.tab !== 'find') { update(partial, saveHistory); return; }
  const search = {};
  if ('start' in partial) search.from = partial.start;
  if ('end' in partial) search.to = partial.end;
  updateSearch(search, saveHistory);
}
function clearSeam() { state.seam = null; $('#seam-result').replaceChildren(); }
function notice(message) { state.notice = message; refreshStatus(); }
function report(error) {
  if (error?.name === 'AbortError') { notice('Operation cancelled.'); return; }
  state.error = error instanceof Error ? error.message : String(error); refreshStatus();
}
function startJob(kind, message) {
  if (busy()) return false;
  state.error = ''; state.notice = ''; state.controller = new AbortController();
  state.job = { kind, progress: 0, message }; refreshStatus(); syncDisabled(); return true;
}
function finishJob() { state.job = null; refresh(); }
function progress(kind) {
  return (fraction, message) => { state.job = { kind, progress: clamp(fraction, 0, 1), message }; refreshStatus(); };
}
function cancel() { state.controller?.abort(); engine.cancel(); }

function refreshStatus() {
  $('#proxy-alert').hidden = !state.nativeError; $('#proxy-message').textContent = state.nativeError;
  $('#error-alert').hidden = !state.error; $('#error-message').textContent = state.error;
  $('#notice').hidden = !state.notice; $('#notice-message').textContent = state.notice;
  $('#job-panel').hidden = !state.job;
  const rendering = state.job?.kind === 'preview';
  $('.render-btn').setAttribute('aria-busy', String(rendering));
  $('#render-label').textContent = rendering ? `Rendering… ${Math.round(state.job.progress * 100)}%`
    : state.render ? dirty() ? 'Update preview' : 'Render again' : 'Render preview';
  if (state.job) {
    $('#job-message').textContent = state.job.message; $('#job-percent').textContent = `${Math.round(state.job.progress * 100)}%`;
    $('#job-progress').value = state.job.progress;
  }
}
function syncDisabled() {
  const disabled = busy() || !state.info.duration;
  const rendered = state.mode === 'loop' && Boolean(state.render);
  $$('[data-disable]').forEach(el => { el.disabled = disabled; });
  $('#timeline-fieldset').disabled = disabled;
  $$('[data-action="open"], [data-action="reset"], [data-action="proxy"]').forEach(el => { el.disabled = busy(); });
  $('[data-action="undo"]').disabled = busy() || !history.past.length;
  $('[data-action="redo"]').disabled = busy() || !history.future.length;
  $$('[data-action="play"], [data-action="previous-frame"], [data-action="next-frame"]').forEach(el => { el.disabled = disabled || staticHome(); });
  $('[data-action="alternate"]').disabled = disabled;
  $$('[data-action="mark-in"], [data-action="mark-out"], [data-action="zoom"]').forEach(button => {
    button.hidden = rendered; button.disabled = disabled || rendered;
  });
  const invalid = !state.info.duration || validate(state.s, state.info).length > 0 || validateLayers(state.s.layers, state.s).length > 0;
  $('.render-btn').disabled = $('.export-btn').disabled = busy() || invalid;
  $('[data-mode="loop"]').disabled = !state.renderURL;
  $('[data-audio="strip"]').disabled = state.s.format === 'gif';
  $('[data-action="open-photo"]').disabled = busy();
  $('[data-setting="preset"]').disabled = busy();
  $$('[data-wallpaper-screen]').forEach(button => { button.disabled = busy(); });
}
function refreshBindings() {
  $$('[data-setting], [data-search]').forEach(input => {
    const setting = input.dataset.setting;
    const value = setting ? ['start', 'end'].includes(setting) ? activeRange()[setting] : state.s[setting] : state.opts[input.dataset.search];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (document.activeElement !== input) input.value = typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : value;
  });
  $$('[data-value]').forEach(el => { el.textContent = `${state.s[el.dataset.value]}%`; });
  const rate = state.info.fps || 30;
  const range = activeRange(), searching = state.tab === 'find', gap = Math.min(state.info.duration, 1 / rate);
  $('[data-setting="start"]').max = Math.max(0, range.end - (searching ? gap : 0)); $('[data-setting="start"]').step = 1 / rate;
  $('[data-setting="end"]').max = state.info.duration; $('[data-setting="end"]').min = range.start + (searching ? gap : 0); $('[data-setting="end"]').step = 1 / rate;
  $('#field-setting-start > span').textContent = searching ? 'Search from' : 'In';
  $('#field-setting-end > span').textContent = searching ? 'Search to' : 'Out';
  $('[data-setting="start"]').setAttribute('aria-label', searching ? 'Timeline search from' : 'In point');
  $('[data-setting="end"]').setAttribute('aria-label', searching ? 'Timeline search to' : 'Out point (exclusive)');
  $$('[data-setting="transition"]').forEach(input => { input.step = 1 / state.s.fps; });
  $('[data-setting="transition"][type="range"]').max = Math.max(state.s.transition, Math.min(30, (state.s.end - state.s.start) / state.s.speed / 2));
  $('[data-search="from"]').max = Math.max(0, state.opts.to - gap); $('[data-search="to"]').max = state.info.duration;
  $('[data-search="from"]').step = $('[data-search="to"]').step = 1 / rate;
  $('[data-search="to"]').min = state.opts.from + gap; $('[data-search="max"]').min = state.opts.min;
  $('[data-wallpaper="kind"]').value = state.wallpaperDownload;
}
function refreshHeaderHint(issues, plan) {
  const { s, info } = state, issue = info.duration ? issues[0] : '';
  let message;
  if (!info.duration) {
    message = 'Open a video to choose a range and build a loop.';
  } else if (issue) {
    if (issue.includes('Spotify Canvas must be 3–8')) {
      const timing = s.method.includes('pingpong') ? ' after the forward and backward passes' : s.repeats > 1 ? ' including repeats' : '';
      message = `Spotify Canvas only accepts 3–8 seconds. Your finished video is ${plan.totalDuration.toFixed(2)}s${timing}; adjust the range or choose Custom.`;
    } else if (issue.includes('Spotify Canvas needs exact 9:16')) {
      message = 'Spotify Canvas needs portrait 9:16 video, 720–1080 pixels tall. Adjust Video settings or choose Custom.';
    } else if (issue === 'Use MP4 for Spotify Canvas.') {
      message = 'Spotify Canvas accepts MP4 video. Select MP4 or choose Custom for WebM and GIF.';
    } else if (issue.includes('Ping-pong would use too much memory')) {
      message = 'Ping-pong keeps frames in memory to play them backward. Shorten the range or lower the resolution or frame rate.';
    } else {
      message = issue;
    }
  } else if (state.tab === 'layers') {
    const layer = s.layers.find(item => item.id === state.activeLayerId) || s.layers.at(-1);
    const spinning = layer?.spin === 'clockwise' || layer?.spin === 'counterclockwise';
    const turns = animationCycles(layer, 'spin'), passes = animationCycles(layer, 'motion');
    const turnText = `${turns} ${turns === 1 ? 'turn' : 'turns'}`, passText = `${passes} ${passes === 1 ? 'pass' : 'passes'}`;
    message = !layer ? 'Add text or an image, then choose its position, angle, and movement direction.'
      : spinning && layer.motion !== 'none' ? `This element completes ${turnText} and ${passText} per loop.${layer.motion === 'along-angle' || layer.motion === 'against-angle' ? ` Its path runs ${layer.motion === 'along-angle' ? 'along' : 'opposite'} the starting angle.` : ' Movement and rotation speeds are independent.'}`
      : spinning ? `${layer.spin === 'clockwise' ? 'Clockwise' : 'Counterclockwise'} completes ${turnText} per finished loop. Rotation sets the starting angle.`
      : layer.motion === 'along-angle' ? `Along rotation completes ${passText} per loop in the direction of this element’s angle.`
      : layer.motion === 'against-angle' ? `Against rotation completes ${passText} per loop opposite this element’s angle.`
      : layer.motion !== 'none' ? `Movement completes ${passText} per loop. Whole passes and turns keep the start and end aligned.`
      : layer.rotation % 360 ? 'Along rotation and Against rotation follow the element’s angle; screen directions follow the frame.'
      : 'Use Rotation animation to spin clockwise or counterclockwise. Movement controls the element’s path.';
  } else if (state.tab === 'find') {
    message = 'Auto find searches for loopable clips anywhere inside the highlighted range. Set the range here or drag its timeline handles.';
  } else if (s.preset === 'iphone') {
    message = staticHome() ? 'Home Screen wallpaper is still. The selected key photo is used; phone icons are preview overlays.'
      : 'iPhone Lock Screen motion uses Live Photos. Export a wallpaper kit or an MP4 for conversion; iOS decides whether motion is available.';
  } else if (state.tab === 'inspect') {
    message = 'Compare the last and first frames, then watch a few repeats to check the join in motion.';
  } else if (state.render && dirty()) {
    message = 'Settings changed. Update preview to check the finished loop before exporting.';
  } else if (s.format === 'gif') {
    message = s.gifLoop
      ? s.method.includes('pingpong')
        ? 'A Ping-pong GIF stores both directions. Loop forever repeats the complete forward-and-backward cycle.'
        : 'GIF stores one complete cycle. Loop forever repeats it; GIF exports have no audio.'
      : 'Loop forever is off: the GIF plays one complete cycle and then stops.';
  } else if (s.preset === 'spotify') {
    message = 'Spotify Canvas accepts 3–8 seconds in portrait 9:16. The duration limit includes the loop method and all repeats.';
  } else if (s.method.includes('pingpong')) {
    message = 'Ping-pong plays forward, then backward, making each cycle nearly twice as long as the selected range.';
  } else if (s.method === 'crossfade' || s.method === 'offset') {
    message = 'A dissolve overlaps the end with the start, so the finished cycle is shorter than the selected range.';
  } else {
    message = 'Choose a range and loop method, then render preview to check how the end joins the start.';
  }
  const hint = $('#header-hint');
  if (hint.textContent !== message) hint.textContent = message;
  hint.parentElement.dataset.tone = issue ? 'warning' : 'tip';
}
function refresh() {
  const { s, info } = state, plan = framePlan(s), issues = info.duration ? [...validate(s, info), ...validateLayers(s.layers, s)] : ['Open a playable video to begin.'];
  const isGif = s.format === 'gif', wallpaper = s.preset === 'iphone';
  const rendered = state.mode === 'loop' && state.render;
  const timelineInfo = rendered || info;
  refreshStatus(); refreshBindings(); syncDisabled(); refreshHeaderHint(issues, plan);
  $('#source-meta').innerHTML = `<span class="file-name" title="${escapeHTML(info.name)}">${rendered ? 'Loop preview' : escapeHTML(info.name || 'Open a video to begin')}</span>`
    + (timelineInfo.duration ? `<span>${timecode(timelineInfo.duration)}</span><span>${timelineInfo.width} × ${timelineInfo.height}</span><span>${humanSize(rendered ? rendered.blob.size : info.size)}</span>` : '');
  $('#timeline-panel').setAttribute('aria-label', rendered ? 'Rendered loop timeline' : state.tab === 'find' ? 'Loop search timeline' : 'Source video timeline');
  $('#timeline-caption').hidden = !rendered;
  if (rendered) {
    const settings = state.renderSettings;
    $('#timeline-caption').textContent = `Source: ${info.name} · ${timecode(settings.start)}–${timecode(settings.end)}${dirty() ? ' · Settings changed. Render again to update this preview.' : ''}`;
  }
  $('#trim-fields').hidden = Boolean(rendered);
  $('#rendered-timeline-summary').hidden = !rendered;
  $$('[data-tab]').forEach(button => { const active = button.dataset.tab === state.tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  ['edit', 'find', 'inspect', 'layers'].forEach(tab => { $(`#panel-${tab}`).hidden = tab !== state.tab; });
  $('#tool-title').textContent = state.tab === 'layers' ? 'Layers' : state.tab === 'find' ? 'Find loops' : state.tab === 'inspect' ? 'Inspect seam' : 'Loop method';
  $('[data-mode="composition"]').hidden = state.tab !== 'layers' && !wallpaper;
  if (!s.layers.some(layer => layer.id === state.activeLayerId)) state.activeLayerId = s.layers.at(-1)?.id || '';
  layerPanel?.render();
  $$('[data-method]').forEach(button => { const active = button.dataset.method === s.method; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
  $('#method-detail').textContent = METHODS.find(method => method.id === s.method).detail;
  const blending = ['crossfade', 'offset'].includes(s.method);
  const pingpong = s.method.includes('pingpong');
  $('#method-summary').hidden = !pingpong;
  $('#method-summary').textContent = `${s.method === 'smooth-pingpong' ? 'Forward, then backward with eased turns' : 'Forward, then backward'}: ${(plan.frames / s.fps).toFixed(3)}s one way → ${plan.duration.toFixed(3)}s per cycle.`;
  $('#field-setting-transition').hidden = !(blending || s.method === 'fade');
  const transitionLabel = s.method === 'fade' ? 'Fade length' : 'Overlap';
  $('#field-setting-transition > span').textContent = transitionLabel;
  $('[data-setting="transition"]').setAttribute('aria-label', transitionLabel);
  $('[data-setting="transition"][type="range"]').setAttribute('aria-label', `${transitionLabel} slider`);
  $('#field-setting-curve').hidden = !blending;
  $('#overlap-note').hidden = !blending;
  $('#overlap-note').textContent = `Actual overlap: ${(plan.overlap / s.fps).toFixed(3)}s (${plan.overlap} frames). Overlap is limited to less than half the selected clip.`;
  $('#field-setting-cropX').hidden = $('#field-setting-cropY').hidden = s.fit !== 'cover';
  $('#field-audio-strip').hidden = isGif;
  $('#gif-playback-settings').hidden = !isGif;
  $('#gif-pingpong-note').hidden = !pingpong;
  $('#quality-field').hidden = $('#video-export-options').hidden = isGif;
  $('#video-export-options').hidden = isGif || wallpaper;
  $('#audio-fields').hidden = wallpaper;
  $('#wallpaper-settings').hidden = !wallpaper;
  $('#output-settings').dataset.format = s.format;
  $('[data-audio="strip"]').checked = s.audio === 'strip' || s.format === 'gif';
  $('[data-audio="smooth"]').checked = s.audio === 'smooth';
  $('#field-audio-smooth').hidden = s.audio === 'strip' || s.format === 'gif';
  $('#pingpong-audio-note').hidden = !pingpong || s.audio === 'strip' || s.format === 'gif';
  $('#preset-hint').textContent = s.preset === 'spotify' ? '3–8s · 9:16 · 720–1080px tall' : s.preset === 'vertical' ? '9:16 · short loops up to 15s suggested' : wallpaper ? 'Portrait · one silent cycle · 3 seconds recommended for conversion' : 'Set your own dimensions and duration';
  $('#format-badge').textContent = wallpaper ? 'IPHONE' : s.format.toUpperCase();
  const aspect = selectedAspect(s);
  $('#dimension-fields').hidden = $('#dimension-note').hidden = aspect !== 'custom';
  $$('[data-aspect]').forEach(button => { const active = button.dataset.aspect === aspect; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $$('[data-fit]').forEach(button => { const active = button.dataset.fit === s.fit; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('#dimension-caption').textContent = `${s.width} × ${s.height}`;
  $('#destination-label').textContent = s.preset === 'spotify' ? 'Spotify Canvas' : s.preset === 'vertical' ? 'Music visual' : wallpaper ? 'iPhone wallpaper' : 'Custom';
  $('.alternate-format').hidden = wallpaper;
  const alternate = alternateFormat(s);
  $('#alternate-label').textContent = alternate.aspect;
  $('#alternate-dimensions').textContent = `${alternate.width} × ${alternate.height}`;
  $('[data-action="alternate"]').setAttribute('aria-label', `Use ${alternate.aspect} alternate output format`);
  document.documentElement.style.setProperty('--source-aspect', String(state.mode === 'loop' && state.render ? state.render.width / state.render.height : state.mode === 'composition' ? s.width / s.height : info.width / info.height || 9 / 16));
  $('#finished-duration').textContent = plan.totalDuration.toFixed(3);
  $('#output-meta').textContent = `${plan.totalFrames} frames · ${s.width} × ${s.height}`;
  const range = activeRange();
  $('#timeline-source-duration').textContent = (range.end - range.start).toFixed(3);
  $('#timeline-range-label').textContent = state.tab === 'find' ? 'Search range' : 'Duration (source)';
  $('#timeline-finished-summary').hidden = state.tab === 'find';
  $('#timeline-output-duration').textContent = plan.totalDuration.toFixed(3);
  $('#validation').hidden = !info.duration || !issues.length;
  $('#validation').innerHTML = issues.map(issue => `<p>${escapeHTML(issue)}</p>`).join('')
    + (issues.some(issue => issue.includes('3–8')) ? `<button class="text-btn" data-action="fit-duration" ${busy() ? 'disabled' : ''}>Fit range to 6-second output</button>` : '');
  $('#export-valid').hidden = !info.duration || Boolean(issues.length);
  $('#export-valid').innerHTML = icon('Check', 14) + (s.preset === 'spotify' ? 'Canvas format checks passed' : 'Ready to export')
    + (isGif ? s.gifLoop ? ' · loops forever · silent' : ' · plays once · silent' : s.audio === 'strip' ? ' · silent' : '');
  $('#long-loop-warning').hidden = plan.totalDuration <= 30;
  $('#export-label').textContent = wallpaper ? state.wallpaperDownload === 'kit' ? 'Download wallpaper kit' : state.wallpaperDownload === 'image' ? 'Download wallpaper JPG' : 'Download wallpaper MP4' : `Export ${s.format.toUpperCase()}`;
  $('#download-result').hidden = !state.lastExport;
  if (state.lastExport) $('#download-meta').textContent = `${humanSize(state.lastExport.blob.size)} · ${state.lastExport.hasAudio ? 'With audio' : 'No audio track'}`;
  $$('[data-mode]').forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('#preview-tag').textContent = state.mode === 'composition' ? 'COMPOSITION DRAFT' : state.mode === 'source' ? state.tab === 'find' ? 'SEARCH RANGE' : 'SOURCE RANGE' : dirty() ? 'LAST RENDER' : 'ENCODED LOOP';
  $('#preview-foot-message').textContent = state.mode === 'composition' ? 'Live layer draft. Render preview to check the finished loop.' : state.mode === 'source' ? state.tab === 'find' ? 'Find loopable clips inside the highlighted range' : 'Render to check the finished seam' : dirty() ? 'Settings changed. Render again.' : 'Playing the actual encoded loop';
  $('#inspection-mode').textContent = state.mode === 'loop' ? 'Rendered preview' : 'Selected source range';
  $('#timeline-fieldset').hidden = !info.duration;
  const profile = phoneProfile(s);
  const posterReady = state.wallpaperPosterSignature === posterSignature() && !dirty();
  wallpaperPreview?.refresh({ enabled: wallpaper, screen: state.wallpaperScreen, width: profile.width, height: profile.height,
    device: profile.chrome, posterURL: posterReady ? state.wallpaperPosterURL : '', disabled: busy(), draft: state.mode !== 'loop' || dirty() });
  $('#wallpaper-key-time').textContent = `${keyPhotoTime(plan.duration, s.fps, s.wallpaperPoster).toFixed(3)}s`;
  $('#wallpaper-range-note').textContent = `Finished cycle: ${plan.duration.toFixed(3)}s. A short 3-second cycle is recommended; this is preparation guidance, not a universal iOS limit.`;
  $('#wallpaper-download-note').textContent = state.wallpaperDownload === 'kit' ? 'Includes MP4, a still JPG, an experimental Live Photo pair, and installation instructions.'
    : state.wallpaperDownload === 'image' ? 'A static wallpaper from the chosen frame. Render preview to inspect the key photo.' : 'Transfer this MP4 to your iPhone and convert it using a compatible Live Photo wallpaper app.';
  if (staticHome()) $('#preview-foot-message').textContent = posterReady ? 'Selected key photo. Home Screen wallpaper stays still.' : 'Draft still. Render preview to see the selected key photo.';
  $('[data-action="frame-png"]').hidden = staticHome();
  void prepareWallpaperPoster();
  timeline?.render(); preview?.refresh();
}

async function loadFile(file, sample = false) {
  if (busy()) return;
  // A delayed demo fetch must not replace a video the user has already chosen.
  if (!sample) { sampleController?.abort(); sampleController = undefined; }
  state.fileController?.abort(); state.controller?.abort(); preview.pause();
  renderFilmstripController?.abort();
  clearWallpaperPoster(); state.wallpaperScreen = 'editor';
  const controller = new AbortController(); state.fileController = controller;
  if (state.sourceURL) URL.revokeObjectURL(state.sourceURL);
  if (state.renderURL) URL.revokeObjectURL(state.renderURL);
  Object.assign(state, { file, info: { ...emptyInfo, name: file.name, size: file.size }, sourceURL: URL.createObjectURL(file), renderURL: '',
    render: null, renderSettings: null, renderPlayhead: 0, renderFilmstrip: [], playhead: 0,
    lastExport: null, filmstrip: [], candidates: [], selected: new Set(), error: '', nativeError: '', mode: 'source',
    notice: '' });
  clearSeam(); renderCandidates(); preview.setSource(state.sourceURL); preview.setOutput(''); refresh();
  try {
    const video = await openVideo(state.sourceURL, controller.signal);
    const info = { name: file.name, size: file.size, width: video.videoWidth, height: video.videoHeight, duration: video.duration, fps: sample ? 24 : 0, hasAudio: true };
    releaseVideo(video); if (controller.signal.aborted || state.file !== file) return;
    state.info = info; state.s = { ...state.s, start: 0, end: Math.min(info.duration, 6), repeats: 1 };
    if (state.s.preset === 'iphone') state.s = { ...state.s, ...wallpaperRange(state.s, info) };
    if (state.s.aspect === 'original') state.s = { ...state.s, ...dimensionsForAspect('original', info, state.s.rotate) };
    state.opts = { ...state.opts, from: 0, to: info.duration, max: Math.min(state.opts.max, info.duration) };
    history.past = []; history.future = []; refresh();
    if (state.s.preset === 'iphone') setWallpaperScreen('lock');
    thumbnails(state.sourceURL, 10, controller.signal).then(frames => { if (!controller.signal.aborted) { state.filmstrip = frames; timeline.render(); } }).catch(() => {});
  } catch (error) { if (!controller.signal.aborted) { state.nativeError = error.message || String(error); refresh(); } }
}
async function loadInitialSample() {
  if (busy()) return;
  sampleController?.abort();
  const controller = new AbortController(); sampleController = controller;
  try {
    const response = await fetch(new URL('../sample.mp4', import.meta.url), { signal: controller.signal });
    if (!response.ok) throw new Error('The sample could not be loaded. Open your own video.');
    const blob = await response.blob();
    if (controller.signal.aborted || sampleController !== controller) return;
    await loadFile(new File([blob], 'prism-motion-sample.mp4', { type: 'video/mp4' }), true);
  } catch (error) { if (!controller.signal.aborted) report(error); }
  finally { if (sampleController === controller) sampleController = undefined; }
}
async function openPhoto(file) {
  if (!file || !startJob('photo', 'Reading your photo…')) return;
  const controller = state.controller;
  let bitmap, result;
  try {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name) && !/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
    bitmap = await createImageBitmap(file);
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const scale = Math.min(1, 1920 / bitmap.width, 1920 / bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(16, Math.round(bitmap.width * scale / 2) * 2);
    canvas.height = Math.max(16, Math.round(bitmap.height * scale / 2) * 2);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!blob) throw new Error('The photo could not be decoded.');
    const png = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.png`, { type: 'image/png' });
    result = await engine.makePhotoVideo(png, progress('photo'));
  } catch (error) { report(error); }
  finally { bitmap?.close(); finishJob(); }
  if (!result || controller.signal.aborted) return;
  const converted = new File([result.blob], result.name, { type: 'video/mp4' });
  await loadFile(converted);
  if (state.file !== converted || !state.info.duration) return;
  state.info.fps = result.fps; state.info.hasAudio = false;
  state.s = wallpaperPreset({ ...state.s, start: 0, method: 'natural', speed: 1 }, state.info);
  history.past = []; history.future = [];
  setWallpaperScreen('lock');
  notice('Photo motion ready: a gentle 3-second zoom cycle. Add text or images in Layers, then render the finished wallpaper.');
}
async function makeProxy() {
  if (!state.file || !startJob('proxy', 'Preparing a compatible proxy…')) return;
  let proxyURL;
  try {
    const result = await engine.makeProxy(state.file, progress('proxy'));
    proxyURL = URL.createObjectURL(result.blob);
    const video = await openVideo(proxyURL, state.controller.signal), stream = result.probe.streams.find(item => item.codec_type === 'video');
    const rate = stream?.avg_frame_rate?.split('/') || ['30', '1'];
    state.info = { ...state.info, width: stream?.width || video.videoWidth, height: stream?.height || video.videoHeight, duration: video.duration,
      fps: Number(rate[0]) / Number(rate[1]) || 30, hasAudio: result.probe.streams.some(item => item.codec_type === 'audio') };
    releaseVideo(video); URL.revokeObjectURL(state.sourceURL); state.sourceURL = proxyURL; proxyURL = null;
    state.nativeError = ''; state.s = { ...state.s, start: 0, end: Math.min(state.info.duration, 6) };
    if (state.s.aspect === 'original') state.s = { ...state.s, ...dimensionsForAspect('original', state.info, state.s.rotate) };
    state.opts = { ...state.opts, from: 0, to: state.info.duration };
    clearCandidates(); history.past = []; history.future = [];
    preview.setSource(state.sourceURL);
    state.fileController?.abort(); const controller = new AbortController(); state.fileController = controller;
    thumbnails(state.sourceURL, 10, controller.signal).then(frames => { if (!controller.signal.aborted) { state.filmstrip = frames; timeline.render(); } }).catch(() => {});
    notice('Compatible proxy ready. Preview is silent; exports use your original video and audio settings.');
  } catch (error) { if (proxyURL) URL.revokeObjectURL(proxyURL); report(error); }
  finally { finishJob(); }
}
async function runSearch() {
  if (!state.file || !state.sourceURL || !startJob('search', 'Preparing search…')) return;
  preview.setMode('source');
  try {
    let rate = state.info.fps;
    if (!rate) { const metadata = await engine.inspect(state.file, progress('search')); Object.assign(state.info, metadata); rate = metadata.fps; }
    if (state.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const result = await searchVideo(state.sourceURL, { ...state.opts }, rate, state.controller.signal, progress('search'));
    state.candidates = result.candidates; state.selected = new Set(); renderCandidates();
    notice(result.candidates.length ? `${result.candidates.length} candidate loops found. Visual scores are estimates; inspect motion before exporting. Sampling spacing: ${result.step.toFixed(2)}s.` : 'No close natural loop found. Widen the search range, allow scene cuts, or use Crossfade / Ping-pong.');
  } catch (error) { report(error); }
  finally { finishJob(); }
}
function renderCandidates() {
  $('#candidate-section').hidden = !state.candidates.length;
  $('#candidate-count').textContent = `${state.candidates.length} matches`;
  $('#select-top').textContent = state.selected.size ? 'Clear selection' : 'Select top 5';
  $('#candidates').innerHTML = state.candidates.map((candidate, index) => `<div class="candidate">
    <label class="candidate-check"><input type="checkbox" data-candidate-check="${candidate.id}" aria-label="Select candidate ${index + 1} for batch export" ${state.selected.has(candidate.id) ? 'checked' : ''}></label>
    <img src="${candidate.thumbnail}" alt="Start frame of candidate ${index + 1}">
    <button class="candidate-main" data-candidate="${candidate.id}"><b>${timecode(candidate.start)} <span>→</span> ${timecode(candidate.end)}</b><small>${(candidate.end - candidate.start).toFixed(3)}s · ${candidate.refined ? 'Frame refined' : 'Coarse match'}${candidate.cuts ? ` · ${candidate.cuts} cuts` : ''}</small></button>
    <span class="score ${candidate.score >= 90 ? 'strong' : ''}" title="Image ${candidate.visual.toFixed(0)} / Motion ${candidate.motion.toFixed(0)}">${candidate.score.toFixed(0)}<small>fit</small></span></div>`).join('');
  $('#batch-button').hidden = !state.selected.size;
  $('#batch-button').innerHTML = icon('Download', 15) + `Export ${state.selected.size} natural loops as ZIP`;
}
function chooseCandidate(id) {
  const candidate = state.candidates.find(item => item.id === id); if (!candidate || busy()) return;
  update({ start: candidate.start, end: candidate.end, method: 'natural', shift: 0, repeats: 1 });
  state.tab = 'edit'; preview.seek(candidate.start);
  notice(`Candidate selected: ${timecode(candidate.start)}–${timecode(candidate.end)}. Render to check the seam.`); refresh();
  if (matchMedia('(max-width: 739px)').matches) $('.preview-panel').scrollIntoView({ block: 'start' });
}
async function runRender(isPreview) {
  if (!state.file || validate(state.s, state.info).length || validateLayers(state.s.layers, state.s).length || !startJob(isPreview ? 'preview' : 'export', 'Preparing render…')) return;
  preview.pause(); const settings = { ...state.s }, wallpaper = settings.preset === 'iphone';
  const kind = state.wallpaperDownload, controller = state.controller;
  try {
    const result = await engine.render(state.file, settings, state.info, progress(isPreview ? 'preview' : 'export'), isPreview,
      wallpaper && !isPreview && kind !== 'video' ? { posterPercent: settings.wallpaperPoster } : null);
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (result.sourceFps) state.info.fps = result.sourceFps;
    if (isPreview) {
      renderFilmstripController?.abort();
      clearWallpaperPoster();
      if (state.renderURL) URL.revokeObjectURL(state.renderURL);
      state.renderURL = URL.createObjectURL(result.blob); state.render = result; state.renderSignature = videoSignature(settings);
      state.renderSettings = settings; state.renderPlayhead = 0; state.renderFilmstrip = [];
      clearSeam(); preview.setOutput(state.renderURL); preview.setMode('loop');
      const controller = new AbortController(), url = state.renderURL;
      renderFilmstripController = controller;
      thumbnails(url, 10, controller.signal).then(frames => {
        if (!controller.signal.aborted && state.renderURL === url) { state.renderFilmstrip = frames; timeline.render(); }
      }).catch(() => {});
      notice('Loop preview ready. Watch several repeats and inspect the seam.');
      if (matchMedia('(max-width: 739px)').matches) $('.preview-panel').scrollIntoView({ block: 'start' });
    } else {
      const exported = wallpaper ? await wallpaperDownload(result, kind, controller.signal) : result;
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      state.lastExport = exported; download(exported.blob, exported.name);
      if (wallpaper) { notice(kind === 'kit' ? 'Wallpaper kit downloaded. Unzip and read README.txt for Live Photo import or MP4 conversion. iOS wallpaper motion still needs verification on your iPhone.'
        : kind === 'image' ? 'Still wallpaper downloaded. Save the JPG to Photos to use it as a static wallpaper.' : 'Wallpaper video downloaded. Convert the MP4 to a Live Photo with a compatible iOS wallpaper app.'); return; }
      notice(`Exported ${result.duration.toFixed(3)}s · ${result.width} × ${result.height} · ${result.hasAudio ? 'Audio included' : 'No audio track'}.${settings.format === 'gif' ? settings.gifLoop ? ' GIF loops forever.' : ' GIF plays once.' : settings.targetMB && result.blob.size > settings.targetMB * 1024 ** 2 ? ' The result exceeds the approximate size target; lower the resolution or increase compression.' : ''}`);
    }
  } catch (error) { report(error); }
  finally { finishJob(); }
}
async function batchExport() {
  if (!state.file || !state.selected.size || !startJob('batch', 'Preparing selected loops…')) return;
  try {
    const files = {}, chosen = state.candidates.filter(candidate => state.selected.has(candidate.id));
    for (let i = 0; i < chosen.length; i++) {
      if (state.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const candidate = chosen[i], settings = { ...state.s, start: candidate.start, end: candidate.end, method: 'natural', shift: 0, repeats: 1 };
      const result = await engine.render(state.file, settings, state.info, (fraction, text) => progress('batch')((i + fraction) / chosen.length, `Loop ${i + 1}/${chosen.length}: ${text}`));
      files[`${String(i + 1).padStart(2, '0')}-${result.name}`] = new Uint8Array(await result.blob.arrayBuffer());
      files[`${String(i + 1).padStart(2, '0')}-settings.json`] = new TextEncoder().encode(JSON.stringify({ source: state.file.name, settings, visualScore: candidate.score }, null, 2));
    }
    if (state.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const zipped = zipSync(files, { level: 0 }); download(new Blob([zipped], { type: 'application/zip' }), 'perfect-loop-candidates.zip');
    notice(`${chosen.length} natural loops exported in one ZIP.`);
  } catch (error) { report(error); }
  finally { finishJob(); }
}
async function inspect() {
  if (!state.sourceURL || !startJob('inspect', 'Reading the boundary frames…')) return;
  try {
    const rendered = state.mode === 'loop' && state.renderURL;
    const result = await inspectSeam(rendered ? state.renderURL : state.sourceURL, rendered ? state.render.fps : state.info.fps || 30,
      state.controller.signal, rendered ? 0 : state.s.start, rendered ? undefined : state.s.end);
    state.seam = result;
    $('#seam-result').innerHTML = `<div class="seam-images"><figure><img src="${result.last}" alt="Last video frame"><figcaption>Last frame</figcaption></figure><figure><img src="${result.first}" alt="First video frame"><figcaption>First frame</figcaption></figure><figure><img src="${result.diff}" alt="Absolute pixel differences amplified three times"><figcaption>Difference ×3</figcaption></figure></div><div class="seam-stats"><div><span>Image match</span><b>${result.visual.toFixed(1)}<small> /100</small></b></div><div><span>Motion match</span><b>${result.motion.toFixed(1)}<small> /100</small></b></div></div>`;
  } catch (error) { report(error); }
  finally { finishJob(); }
}
function setPreset(preset) {
  update(preset === 'iphone' ? wallpaperPreset(state.s, state.info) : preset === 'spotify' ? { preset, aspect: '9:16', width: 576, height: 1024, fps: 30, format: 'mp4', audio: 'strip', repeats: 1 } : preset === 'vertical' ? { preset, aspect: '9:16', width: 720, height: 1280, fps: 30 } : { preset, aspect: 'custom' });
  updateSearch({ min: 3, max: preset === 'spotify' ? 8 : 15 }, false);
  if (preset === 'iphone') setWallpaperScreen('lock');
  else { state.wallpaperScreen = 'editor'; if (state.mode === 'composition' && state.tab !== 'layers') preview.setMode('source'); else refresh(); }
}
function setAspect(aspect, dimensions) {
  if (!state.info.duration || busy()) return;
  if (aspect === 'custom') {
    update({ aspect: 'custom', preset: 'custom' });
    $('[data-setting="width"]').focus();
    return;
  }
  const keepVerticalPreset = aspect === '9:16' && ['spotify', 'vertical'].includes(state.s.preset) && !dimensions;
  const verticalDimensions = selectedAspect({ ...state.s, aspect: undefined }) === '9:16' ? { width: state.s.width, height: state.s.height } : state.s.preset === 'spotify' ? { width: 576, height: 1024 } : { width: 720, height: 1280 };
  update({ ...(dimensions || (keepVerticalPreset ? verticalDimensions : dimensionsForAspect(aspect, state.info, state.s.rotate))), aspect, preset: keepVerticalPreset ? state.s.preset : 'custom' });
}
function fitDuration() {
  const s = state.s;
  if (s.preset === 'iphone') { update({ ...wallpaperRange(s, state.info), repeats: 1 }); return; }
  const seconds = s.preset === 'spotify' ? 6 : 10;
  const duration = (s.method.includes('pingpong') ? (seconds + 2 / s.fps) / 2 : ['crossfade', 'offset'].includes(s.method) ? seconds + s.transition : seconds) * s.speed;
  const start = Math.max(0, Math.min(s.start, state.info.duration - duration)); update({ start, end: Math.min(state.info.duration, start + duration), repeats: 1 });
}
function mark(edge) {
  if (busy() || state.mode === 'loop') return;
  const time = preview.source.currentTime, range = activeRange();
  const gap = state.tab === 'find' ? 1 / (state.info.fps || 30) : 0.1;
  updateActiveRange(edge === 'start' ? { start: Math.min(time, range.end - gap) } : { end: Math.max(time, range.start + gap) });
}

function editLayer(id, partial, saveHistory = true) {
  const layer = state.s.layers.find(item => item.id === id);
  if (layer && 'rotation' in partial && Number.isFinite(partial.rotation) && partial.rotation % 360 === 0) {
    const motion = partial.motion ?? layer.motion;
    if (motion === 'along-angle' || motion === 'against-angle')
      partial = { ...partial, motion: motion === 'along-angle' ? 'right' : 'left' };
  }
  if (!layer || busy() || Object.entries(partial).every(([key, value]) => layer[key] === value)) return;
  update({ layers: state.s.layers.map(item => item.id === id ? { ...item, ...partial } : item) }, saveHistory);
  if (state.mode !== 'composition') preview.setMode('composition');
}
function addLayer(layer) {
  if (busy()) return false;
  const layers = [...state.s.layers, layer], issues = validateLayers(layers, state.s);
  if (issues.length) { report(new Error(issues[0])); return false; }
  state.activeLayerId = layer.id;
  update({ layers });
  preview.setMode('composition');
  return true;
}
function layerAction(action, id, value) {
  if (busy()) return;
  if (action === 'font') { void selectLayerFont(id, value); return; }
  const layers = state.s.layers, index = layers.findIndex(layer => layer.id === id), layer = layers[index];
  if (!layer) return;
  if (action === 'select') { state.activeLayerId = id; preview.setMode('composition'); return; }
  if (action === 'toggle') { editLayer(id, { visible: !layer.visible }); return; }
  if (action === 'duplicate') { addLayer(duplicateLayer(layer)); return; }
  const next = [...layers];
  if (action === 'delete') next.splice(index, 1);
  else {
    const target = index + (action === 'up' ? 1 : action === 'down' ? -1 : 0);
    if (target === index || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
  }
  update({ layers: next });
  preview.setMode('composition');
}
async function addImage(file) {
  if (state.s.layers.length >= MAX_LAYERS) { report(new Error(`Use no more than ${MAX_LAYERS} layers.`)); return; }
  if (!file || !startJob('image', 'Opening image…')) return;
  const controller = state.controller;
  let layer, added = false;
  try {
    layer = await importImageLayer(file, state.s);
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    finishJob(); added = addLayer(layer);
  } catch (error) { report(error); }
  finally {
    if (layer && !added) discardImportedImageLayer(layer);
    if (state.job?.kind === 'image') finishJob();
  }
}

async function waitForFont(promise, signal) {
  let abort;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      abort = () => reject(new DOMException('Cancelled', 'AbortError'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}

async function selectLayerFont(id, fontFamily) {
  const layer = state.s.layers.find(item => item.id === id);
  if (layer?.type !== 'text' || layer.fontFamily === fontFamily || !startJob('font', 'Loading font…')) return;
  const controller = state.controller;
  let loaded = false;
  try {
    await waitForFont(loadFont(fontFamily), controller.signal);
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    loaded = true;
  } catch (error) { report(error); }
  finally { finishJob(); }
  if (loaded) editLayer(id, { fontFamily });
}

async function useDeviceFonts() {
  if (busy()) return;
  // Invoke the browser permission request directly from the button's gesture.
  const discovery = discoverDeviceFonts();
  if (!startJob('fonts', 'Reading device fonts…')) return;
  const controller = state.controller;
  try {
    const fonts = await waitForFont(discovery, controller.signal);
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    notice(fonts.length
      ? `${fonts.length} device fonts are available in the Font menu.`
      : 'No device fonts were provided. You can upload font files instead.');
  } catch (error) { report(error); }
  finally { finishJob(); }
}

async function addFonts(files) {
  if (!files.length || !startJob('fonts', 'Opening font files…')) return;
  const controller = state.controller;
  const selected = state.s.layers.find(layer => layer.id === state.activeLayerId && layer.type === 'text');
  const imported = [], errors = [];
  try {
    for (const file of files) {
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        const font = await waitForFont(importFontFile(file), controller.signal);
        if (!imported.some(item => item.id === font.id)) imported.push(font);
      }
      catch (error) { errors.push(`${file.name}: ${error.message || String(error)}`); }
    }
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  } catch (error) { report(error); }
  finally { finishJob(); }
  if (controller.signal.aborted) return;
  if (imported.length) {
    if (selected) editLayer(selected.id, { fontFamily: imported[0].id });
    else addLayer({ ...createTextLayer(state.s), fontFamily: imported[0].id });
    notice(`${imported.length} ${imported.length === 1 ? 'font is' : 'fonts are'} ready in the Font menu. Uploaded fonts stay available until this page is closed.`);
  }
  if (errors.length) report(new Error(errors.join('\n')));
}

initializeFields();
$('#methods').innerHTML = METHODS.map((method, index) => `<button class="method-card" data-method="${method.id}" aria-pressed="false" title="${escapeHTML(method.short)}"><span class="method-icon">${icon(['Scissors', 'Blend', 'Layers', 'Play', 'SmoothWave', 'FadeCircle'][index], 25)}</span><span><b>${method.name}</b><small>${method.short}</small></span></button>`).join('');
preview = new Preview(() => state, mode => { state.mode = mode; if (mode === 'source') state.wallpaperScreen = 'editor'; clearSeam(); refresh(); }, (time, mode) => {
  if (mode === 'loop') state.renderPlayhead = time;
  else state.playhead = time;
  timeline?.renderPlayhead(time);
  if (staticHome() && (!state.wallpaperPosterURL || state.wallpaperPosterSignature !== posterSignature() || dirty())) {
    const key = `${videoSignature(state.s)}:${preview?.lastFrame}`;
    if (key !== wallpaperDraftFrame) { wallpaperDraftFrame = key; wallpaperPreview?.captureStill(); }
  }
});
timeline = new Timeline(() => state, updateActiveRange, time => { preview.seek(time, state.mode); }, remember);
layerPanel = new LayerPanel(() => state, editLayer, layerAction);
wallpaperPreview = new WallpaperPreview($('#wallpaper-screen-controls'), $('#preview-stage'), setWallpaperScreen);
$('#wallpaper-photo-input').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = ''; void openPhoto(file);
});
$('#layer-image-input').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = ''; void addImage(file);
});
$('#layer-font-input').addEventListener('change', event => {
  const files = Array.from(event.target.files); event.target.value = ''; void addFonts(files);
});

// Event delegation keeps native inputs and pointer-captured trim handles stable.
function changeField(event) {
  const input = event.target;
  if (busy()) return;
  if (input.dataset.candidateCheck) { input.checked ? state.selected.add(input.dataset.candidateCheck) : state.selected.delete(input.dataset.candidateCheck); renderCandidates(); return; }
  if (input.dataset.audio) { update({ audio: input.dataset.audio === 'strip' ? input.checked ? 'strip' : 'keep' : input.checked ? 'smooth' : 'keep' }); return; }
  if (input.dataset.wallpaper === 'kind') { state.wallpaperDownload = input.value; refresh(); return; }
  if (!input.dataset.setting && !input.dataset.search) return;
  if (input.type === 'number' && input.value === '') return;
  const value = input.type === 'checkbox' ? input.checked : input.hasAttribute('data-number') ? Number(input.value) : input.value;
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  if (input.dataset.search) updateSearch({ [input.dataset.search]: value });
  else if (['start', 'end'].includes(input.dataset.setting)) updateActiveRange({ [input.dataset.setting]: value });
  else if (input.dataset.setting === 'preset') setPreset(value);
  else if (input.dataset.setting === 'wallpaperDevice') {
    const profile = phoneProfile({ ...state.s, wallpaperDevice: value });
    update({ wallpaperDevice: value, aspect: 'custom', width: profile.width, height: profile.height });
  }
  else if (input.dataset.setting === 'format' && value !== 'mp4' && ['spotify', 'iphone'].includes(state.s.preset)) {
    const destination = state.s.preset;
    update({ format: value, preset: 'custom' });
    state.wallpaperScreen = 'editor'; refresh();
    notice(`Switched to Custom because ${destination === 'iphone' ? 'iPhone wallpaper preparation uses' : 'Spotify Canvas requires'} MP4.`);
  }
  else if (['width', 'height'].includes(input.dataset.setting)) update({ [input.dataset.setting]: value, aspect: 'custom',
    preset: state.s.preset === 'iphone' ? 'iphone' : 'custom', ...(state.s.preset === 'iphone' ? { wallpaperDevice: 'custom' } : {}) });
  else update({ [input.dataset.setting]: value });
}
document.addEventListener('input', changeField);
document.addEventListener('change', event => { if (event.target.tagName === 'SELECT' || event.target.type === 'checkbox') changeField(event); });
document.addEventListener('focusout', event => { if (event.target.matches('[data-setting], [data-search]')) refreshBindings(); });
$('#file-input').addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) /^image\/(png|jpeg|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name) ? void openPhoto(file) : void loadFile(file);
  event.target.value = '';
});

const actions = {
  'layer-add-text': () => addLayer(createTextLayer(state.s)),
  'layer-add-image': () => $('#layer-image-input').click(),
  'layer-upload-fonts': () => $('#layer-font-input').click(),
  'layer-device-fonts': useDeviceFonts,
  open: () => $('#file-input').click(), 'open-photo': () => $('#wallpaper-photo-input').click(), help: () => $('#help-dialog').showModal(), 'close-help': () => $('#help-dialog').close(),
  undo, redo, reset: () => update({ ...DEFAULTS, end: Math.min(state.info.duration || 6, 6) }),
  proxy: makeProxy, search: runSearch, render: () => runRender(true), export: () => runRender(false), inspect, batch: batchExport, cancel,
  'dismiss-error': () => { state.error = ''; refreshStatus(); }, 'dismiss-notice': () => notice(''),
  play: () => staticHome() ? undefined : preview.play(), 'previous-frame': () => { if (!staticHome()) preview.step(-1); }, 'next-frame': () => { if (!staticHome()) preview.step(1); },
  mute: () => preview.toggleMute(), guides: () => preview.toggleGuides(), fullscreen: () => preview.fullscreen(), 'frame-png': () => preview.saveFrame(),
  zoom: () => timeline.toggleZoom(), 'mark-in': () => mark('start'), 'mark-out': () => mark('end'), 'fit-duration': fitDuration,
  alternate: () => { const { aspect, width, height } = alternateFormat(state.s); setAspect(aspect, { width, height }); },
  'download-again': () => { if (state.lastExport) download(state.lastExport.blob, state.lastExport.name); },
  'select-top': () => { state.selected = state.selected.size ? new Set() : new Set(state.candidates.slice(0, 5).map(candidate => candidate.id)); renderCandidates(); },
};
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.matches(':disabled')) return;
  if (button.dataset.method) update({ method: button.dataset.method, shift: button.dataset.method === 'offset' ? 50 : 0 });
  else if (button.dataset.aspect) setAspect(button.dataset.aspect);
  else if (button.dataset.fit) update({ fit: button.dataset.fit });
  else if (button.dataset.tab) {
    state.tab = button.dataset.tab;
    if (state.tab === 'layers') preview.setMode('composition');
    else if (state.tab === 'find' || state.mode === 'composition') preview.setMode('source');
    else refresh();
    if (matchMedia('(max-width: 739px)').matches) $('.controls-panel').scrollIntoView({ block: 'start' });
  }
  else if (button.dataset.mode) preview.setMode(button.dataset.mode);
  else if (button.dataset.candidate) chooseCandidate(button.dataset.candidate);
  else if (actions[button.dataset.action]) Promise.resolve(actions[button.dataset.action]()).catch(report);
});
document.addEventListener('keydown', event => {
  const tab = event.target.closest('[role="tab"]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); const tabs = $$('[role="tab"]'), index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click(); return;
  }
  if (busy() || $('#help-dialog').open || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(event.target.tagName)) return;
  if (staticHome() && [' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); return; }
  if (event.key === ' ') { event.preventDefault(); void preview.play(); }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); preview.step(event.key === 'ArrowRight' ? 1 : -1); }
  if (event.key.toLowerCase() === 'i') mark('start'); if (event.key.toLowerCase() === 'o') mark('end');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
});
const app = $('#app');
app.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files') && !busy()) $('#drop-overlay').hidden = false; });
app.addEventListener('dragleave', event => { if (!app.contains(event.relatedTarget)) $('#drop-overlay').hidden = true; });
app.addEventListener('drop', event => {
  event.preventDefault(); $('#drop-overlay').hidden = true;
  const file = event.dataTransfer.files[0];
  if (busy() || !file) return;
  if (/^image\//i.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
    state.tab = 'layers'; refresh(); void addImage(file);
  } else if (/\.(ttf|otf|woff2?)$/i.test(file.name)) {
    state.tab = 'layers'; refresh(); void addFonts(Array.from(event.dataTransfer.files));
  } else void loadFile(file);
});
window.addEventListener('beforeunload', () => {
  clearWallpaperPoster(); wallpaperPreview?.destroy();
  sampleController?.abort();
  renderFilmstripController?.abort();
  clearLayerAssets();
  clearFonts();
  state.fileController?.abort(); state.controller?.abort(); engine.cancel(); preview.destroy();
  if (state.sourceURL) URL.revokeObjectURL(state.sourceURL); if (state.renderURL) URL.revokeObjectURL(state.renderURL);
});
decorateIcons(); renderCandidates(); refresh(); void loadInitialSample();
