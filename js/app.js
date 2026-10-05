import { zipSync } from '../vendor/fflate.js';
import { DEFAULTS, METHODS } from './constants.js';
import { alternateFormat, dimensionsForAspect, selectedAspect } from './aspect.js';
import { clamp, download, framePlan, humanSize, timecode, validate } from './logic.js';
import { VideoEngine } from './engine.js';
import { inspectSeam, openVideo, releaseVideo, searchVideo, thumbnails } from './media.js';
import { Preview } from './preview.js';
import { Timeline } from './timeline.js';
import { $, $$, decorateIcons, escapeHTML, icon, initializeFields } from './ui.js';

// All application state is local to this page. No file is uploaded or persisted.
const emptyInfo = { name: '', duration: 0, width: 0, height: 0, fps: 0, hasAudio: false, size: 0 };
const state = {
  s: { ...DEFAULTS }, info: { ...emptyInfo }, file: null,
  sourceURL: '', renderURL: '', render: null, renderSignature: '', lastExport: null,
  mode: 'source', tab: 'edit', playhead: 0, filmstrip: [],
  renderSettings: null, renderPlayhead: 0, renderFilmstrip: [],
  opts: { from: 0, to: 18, min: 3, max: 8, precision: 'balanced', preferMotion: true, avoidCuts: true },
  candidates: [], selected: new Set(), seam: null,
  job: null, error: '', nativeError: '', notice: '', controller: null, fileController: null,
};
const history = { past: [], future: [] }, engine = new VideoEngine();
let preview, timeline, sampleController, renderFilmstripController;
const dirty = () => JSON.stringify(state.s) !== state.renderSignature;
const busy = () => Boolean(state.job);

function remember() {
  history.past.push({ ...state.s }); if (history.past.length > 60) history.past.shift(); history.future = [];
}
function update(partial, saveHistory = true) {
  if ('width' in partial || 'height' in partial) partial = { aspect: 'custom', ...partial };
  if ('rotate' in partial && state.s.aspect === 'original') partial = { ...partial, ...dimensionsForAspect('original', state.info, partial.rotate), aspect: 'original' };
  if (busy() || Object.entries(partial).every(([key, value]) => state.s[key] === value)) return;
  if (saveHistory) remember();
  state.s = { ...state.s, ...partial }; state.seam = null; $('#seam-result').replaceChildren(); refresh();
}
function undo() { if (busy() || !history.past.length) return; history.future.push(state.s); state.s = history.past.pop(); clearSeam(); refresh(); }
function redo() { if (busy() || !history.future.length) return; history.past.push(state.s); state.s = history.future.pop(); clearSeam(); refresh(); }
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
  $$('[data-action="play"], [data-action="previous-frame"], [data-action="next-frame"]').forEach(el => { el.disabled = disabled; });
  $('[data-action="alternate"]').disabled = disabled;
  $$('[data-action="mark-in"], [data-action="mark-out"], [data-action="zoom"]').forEach(button => {
    button.hidden = rendered; button.disabled = disabled || rendered;
  });
  const invalid = !state.info.duration || validate(state.s, state.info).length > 0;
  $('.render-btn').disabled = $('.export-btn').disabled = busy() || invalid;
  $('[data-mode="loop"]').disabled = !state.renderURL;
  $('[data-audio="strip"]').disabled = state.s.format === 'gif';
}
function refreshBindings() {
  $$('[data-setting], [data-search]').forEach(input => {
    const setting = input.dataset.setting, value = setting ? state.s[setting] : state.opts[input.dataset.search];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (document.activeElement !== input) input.value = typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : value;
  });
  $$('[data-value]').forEach(el => { el.textContent = `${state.s[el.dataset.value]}%`; });
  const rate = state.info.fps || 30;
  $('[data-setting="start"]').max = state.s.end; $('[data-setting="start"]').step = 1 / rate;
  $('[data-setting="end"]').max = state.info.duration; $('[data-setting="end"]').min = state.s.start; $('[data-setting="end"]').step = 1 / rate;
  $$('[data-setting="transition"]').forEach(input => { input.step = 1 / state.s.fps; });
  $('[data-setting="transition"][type="range"]').max = Math.max(state.s.transition, Math.min(30, (state.s.end - state.s.start) / state.s.speed / 2));
  $('[data-search="from"]').max = $('[data-search="to"]').max = state.info.duration;
  $('[data-search="to"]').min = state.opts.from; $('[data-search="max"]').min = state.opts.min;
}
function refresh() {
  const { s, info } = state, plan = framePlan(s), issues = info.duration ? validate(s, info) : ['Open a playable video to begin.'];
  const isGif = s.format === 'gif';
  const rendered = state.mode === 'loop' && state.render;
  const timelineInfo = rendered || info;
  refreshStatus(); refreshBindings(); syncDisabled();
  $('#source-meta').innerHTML = `<span class="file-name" title="${escapeHTML(info.name)}">${rendered ? 'Loop preview' : escapeHTML(info.name || 'Open a video to begin')}</span>`
    + (timelineInfo.duration ? `<span>${timecode(timelineInfo.duration)}</span><span>${timelineInfo.width} × ${timelineInfo.height}</span><span>${humanSize(rendered ? rendered.blob.size : info.size)}</span>` : '');
  $('#timeline-panel').setAttribute('aria-label', rendered ? 'Rendered loop timeline' : 'Source video timeline');
  $('#timeline-caption').hidden = !rendered;
  if (rendered) {
    const settings = state.renderSettings;
    $('#timeline-caption').textContent = `Source: ${info.name} · ${timecode(settings.start)}–${timecode(settings.end)}${dirty() ? ' · Settings changed. Render again to update this preview.' : ''}`;
  }
  $('#trim-fields').hidden = Boolean(rendered);
  $('#rendered-timeline-summary').hidden = !rendered;
  $$('[data-tab]').forEach(button => { const active = button.dataset.tab === state.tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  ['edit', 'find', 'inspect'].forEach(tab => { $(`#panel-${tab}`).hidden = tab !== state.tab; });
  $('#tool-title').textContent = state.tab === 'find' ? 'Find loops' : state.tab === 'inspect' ? 'Inspect seam' : 'Loop method';
  $$('[data-method]').forEach(button => { const active = button.dataset.method === s.method; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
  $('#method-detail').textContent = METHODS.find(method => method.id === s.method).detail;
  const blending = ['crossfade', 'offset'].includes(s.method);
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
  $('#quality-field').hidden = $('#video-export-options').hidden = isGif;
  $('#output-settings').dataset.format = s.format;
  $('[data-audio="strip"]').checked = s.audio === 'strip' || s.format === 'gif';
  $('[data-audio="smooth"]').checked = s.audio === 'smooth';
  $('#field-audio-smooth').hidden = s.audio === 'strip' || s.format === 'gif';
  $('#rebound-audio-note').hidden = !s.method.includes('pingpong') || s.audio === 'strip' || s.format === 'gif';
  $('#preset-hint').textContent = s.preset === 'spotify' ? '3–8s · 9:16 · 720–1080px tall' : s.preset === 'vertical' ? '9:16 · short loops up to 15s suggested' : 'Set your own dimensions and duration';
  $('#format-badge').textContent = s.format.toUpperCase();
  const aspect = selectedAspect(s);
  $('#dimension-fields').hidden = $('#dimension-note').hidden = aspect !== 'custom';
  $$('[data-aspect]').forEach(button => { const active = button.dataset.aspect === aspect; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $$('[data-fit]').forEach(button => { const active = button.dataset.fit === s.fit; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('#dimension-caption').textContent = `${s.width} × ${s.height}`;
  $('#destination-label').textContent = s.preset === 'spotify' ? 'Spotify Canvas' : s.preset === 'vertical' ? 'Music visual' : 'Custom';
  const alternate = alternateFormat(s);
  $('#alternate-label').textContent = alternate.aspect;
  $('#alternate-dimensions').textContent = `${alternate.width} × ${alternate.height}`;
  $('[data-action="alternate"]').setAttribute('aria-label', `Use ${alternate.aspect} alternate output format`);
  document.documentElement.style.setProperty('--source-aspect', String(state.mode === 'loop' && state.render ? state.render.width / state.render.height : info.width / info.height || 9 / 16));
  $('#finished-duration').textContent = plan.totalDuration.toFixed(3);
  $('#output-meta').textContent = `${plan.totalFrames} frames · ${s.width} × ${s.height}`;
  $('#timeline-source-duration').textContent = (s.end - s.start).toFixed(3);
  $('#timeline-output-duration').textContent = plan.totalDuration.toFixed(3);
  $('#validation').hidden = !info.duration || !issues.length;
  $('#validation').innerHTML = issues.map(issue => `<p>${escapeHTML(issue)}</p>`).join('')
    + (issues.some(issue => issue.includes('3–8')) ? `<button class="text-btn" data-action="fit-duration" ${busy() ? 'disabled' : ''}>Fit range to 6-second output</button>` : '');
  $('#export-valid').hidden = !info.duration || Boolean(issues.length);
  $('#export-valid').innerHTML = icon('Check', 14) + (s.preset === 'spotify' ? 'Canvas format checks passed' : 'Ready to export')
    + (isGif ? s.gifLoop ? ' · loops forever · silent' : ' · plays once · silent' : s.audio === 'strip' ? ' · silent' : '');
  $('#long-loop-warning').hidden = plan.totalDuration <= 30;
  $('#export-label').textContent = `Export ${s.format.toUpperCase()}`;
  $('#download-result').hidden = !state.lastExport;
  if (state.lastExport) $('#download-meta').textContent = `${humanSize(state.lastExport.blob.size)} · ${state.lastExport.hasAudio ? 'With audio' : 'No audio track'}`;
  $$('[data-mode]').forEach(button => { const active = button.dataset.mode === state.mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('#preview-tag').textContent = state.mode === 'source' ? 'SOURCE RANGE' : dirty() ? 'LAST RENDER' : 'ENCODED LOOP';
  $('#preview-foot-message').textContent = state.mode === 'source' ? 'Render to check the finished seam' : dirty() ? 'Settings changed. Render again.' : 'Playing the actual encoded loop';
  $('#inspection-mode').textContent = state.mode === 'loop' ? 'Rendered preview' : 'Selected source range';
  $('#timeline-fieldset').hidden = !info.duration;
  timeline?.render(); preview?.refresh();
}

async function loadFile(file, sample = false) {
  if (busy()) return;
  // A delayed demo fetch must not replace a video the user has already chosen.
  if (!sample) { sampleController?.abort(); sampleController = undefined; }
  state.fileController?.abort(); state.controller?.abort(); preview.pause();
  renderFilmstripController?.abort();
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
    if (state.s.aspect === 'original') state.s = { ...state.s, ...dimensionsForAspect('original', info, state.s.rotate) };
    state.opts = { ...state.opts, from: 0, to: info.duration, max: Math.min(state.opts.max, info.duration) };
    history.past = []; history.future = []; refresh();
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
    preview.setSource(state.sourceURL);
    state.fileController?.abort(); const controller = new AbortController(); state.fileController = controller;
    thumbnails(state.sourceURL, 10, controller.signal).then(frames => { if (!controller.signal.aborted) { state.filmstrip = frames; timeline.render(); } }).catch(() => {});
    notice('Compatible proxy ready. Preview is silent; exports use your original video and audio settings.');
  } catch (error) { if (proxyURL) URL.revokeObjectURL(proxyURL); report(error); }
  finally { finishJob(); }
}
async function runSearch() {
  if (!state.file || !state.sourceURL || !startJob('search', 'Preparing search…')) return;
  try {
    let rate = state.info.fps;
    if (!rate) { const metadata = await engine.inspect(state.file, progress('search')); Object.assign(state.info, metadata); rate = metadata.fps; }
    if (state.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const result = await searchVideo(state.sourceURL, { ...state.opts }, rate, state.controller.signal, progress('search'));
    state.candidates = result.candidates; state.selected = new Set(); renderCandidates();
    notice(result.candidates.length ? `${result.candidates.length} candidate loops found. Visual scores are estimates; inspect motion before exporting. Sampling spacing: ${result.step.toFixed(2)}s.` : 'No close natural loop found. Widen the search range, allow scene cuts, or use Crossfade / Rebound.');
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
  if (!state.file || validate(state.s, state.info).length || !startJob(isPreview ? 'preview' : 'export', 'Preparing render…')) return;
  preview.pause(); const settings = { ...state.s };
  try {
    const result = await engine.render(state.file, settings, state.info, progress(isPreview ? 'preview' : 'export'), isPreview);
    if (result.sourceFps) state.info.fps = result.sourceFps;
    if (isPreview) {
      renderFilmstripController?.abort();
      if (state.renderURL) URL.revokeObjectURL(state.renderURL);
      state.renderURL = URL.createObjectURL(result.blob); state.render = result; state.renderSignature = JSON.stringify(settings);
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
      state.lastExport = result; download(result.blob, result.name);
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
  update(preset === 'spotify' ? { preset, aspect: '9:16', width: 576, height: 1024, fps: 30, format: 'mp4', audio: 'strip', repeats: 1 } : preset === 'vertical' ? { preset, aspect: '9:16', width: 720, height: 1280, fps: 30 } : { preset, aspect: 'custom' });
  state.opts = { ...state.opts, min: 3, max: preset === 'spotify' ? 8 : 15 }; refresh();
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
  const s = state.s, seconds = s.preset === 'spotify' ? 6 : 10;
  const duration = (s.method.includes('pingpong') ? (seconds + 2 / s.fps) / 2 : ['crossfade', 'offset'].includes(s.method) ? seconds + s.transition : seconds) * s.speed;
  const start = Math.max(0, Math.min(s.start, state.info.duration - duration)); update({ start, end: Math.min(state.info.duration, start + duration), repeats: 1 });
}
function mark(edge) {
  if (busy() || state.mode !== 'source') return;
  const time = preview.source.currentTime;
  update(edge === 'start' ? { start: Math.min(time, state.s.end - 0.1) } : { end: Math.max(time, state.s.start + 0.1) });
}

initializeFields();
$('#methods').innerHTML = METHODS.map((method, index) => `<button class="method-card" data-method="${method.id}" aria-pressed="false" title="${escapeHTML(method.short)}"><span class="method-icon">${icon(['Scissors', 'Blend', 'Layers', 'Play', 'SmoothWave', 'FadeCircle'][index], 25)}</span><span><b>${method.name}</b><small>${method.short}</small></span></button>`).join('');
preview = new Preview(() => state, mode => { state.mode = mode; clearSeam(); refresh(); }, (time, mode) => {
  if (mode === 'loop') state.renderPlayhead = time;
  else state.playhead = time;
  timeline?.renderPlayhead(time);
});
timeline = new Timeline(() => state, update, time => { preview.seek(time, state.mode); }, remember);

// Event delegation keeps native inputs and pointer-captured trim handles stable.
function changeField(event) {
  const input = event.target;
  if (busy()) return;
  if (input.dataset.candidateCheck) { input.checked ? state.selected.add(input.dataset.candidateCheck) : state.selected.delete(input.dataset.candidateCheck); renderCandidates(); return; }
  if (input.dataset.audio) { update({ audio: input.dataset.audio === 'strip' ? input.checked ? 'strip' : 'keep' : input.checked ? 'smooth' : 'keep' }); return; }
  if (!input.dataset.setting && !input.dataset.search) return;
  if (input.type === 'number' && input.value === '') return;
  const value = input.type === 'checkbox' ? input.checked : input.hasAttribute('data-number') ? Number(input.value) : input.value;
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  if (input.dataset.search) { state.opts[input.dataset.search] = value; refresh(); }
  else if (input.dataset.setting === 'preset') setPreset(value);
  else if (input.dataset.setting === 'format' && value !== 'mp4' && state.s.preset === 'spotify') {
    update({ format: value, preset: 'custom' });
    notice('Switched to Custom because Spotify Canvas requires MP4.');
  }
  else if (['width', 'height'].includes(input.dataset.setting)) update({ [input.dataset.setting]: value, aspect: 'custom', preset: 'custom' });
  else update({ [input.dataset.setting]: value });
}
document.addEventListener('input', changeField);
document.addEventListener('change', event => { if (event.target.tagName === 'SELECT' || event.target.type === 'checkbox') changeField(event); });
document.addEventListener('focusout', event => { if (event.target.matches('[data-setting], [data-search]')) refreshBindings(); });
$('#file-input').addEventListener('change', event => { const file = event.target.files[0]; if (file) void loadFile(file); event.target.value = ''; });

const actions = {
  open: () => $('#file-input').click(), help: () => $('#help-dialog').showModal(), 'close-help': () => $('#help-dialog').close(),
  undo, redo, reset: () => update({ ...DEFAULTS, end: Math.min(state.info.duration || 6, 6) }),
  proxy: makeProxy, search: runSearch, render: () => runRender(true), export: () => runRender(false), inspect, batch: batchExport, cancel,
  'dismiss-error': () => { state.error = ''; refreshStatus(); }, 'dismiss-notice': () => notice(''),
  play: () => preview.play(), 'previous-frame': () => preview.step(-1), 'next-frame': () => preview.step(1),
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
    state.tab = button.dataset.tab; refresh();
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
  if (event.key === ' ') { event.preventDefault(); void preview.play(); }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); preview.step(event.key === 'ArrowRight' ? 1 : -1); }
  if (event.key.toLowerCase() === 'i') mark('start'); if (event.key.toLowerCase() === 'o') mark('end');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
});
const app = $('#app');
app.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files') && !busy()) $('#drop-overlay').hidden = false; });
app.addEventListener('dragleave', event => { if (!app.contains(event.relatedTarget)) $('#drop-overlay').hidden = true; });
app.addEventListener('drop', event => { event.preventDefault(); $('#drop-overlay').hidden = true; if (!busy() && event.dataTransfer.files[0]) void loadFile(event.dataTransfer.files[0]); });
window.addEventListener('beforeunload', () => {
  sampleController?.abort();
  renderFilmstripController?.abort();
  state.fileController?.abort(); state.controller?.abort(); engine.cancel(); preview.destroy();
  if (state.sourceURL) URL.revokeObjectURL(state.sourceURL); if (state.renderURL) URL.revokeObjectURL(state.renderURL);
});
decorateIcons(); renderCandidates(); refresh(); void loadInitialSample();
