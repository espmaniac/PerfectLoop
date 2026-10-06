import { clamp, download, timecode, framePlan } from './logic.js';
import { drawLayers } from './layers.js';
import { $, icon } from './ui.js';
import { alternateFormat } from './aspect.js';

function drawFrame(canvas, video, settings, rendered) {
  // Keep the last frame while the decoder seeks across the loop boundary.
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2 || video.seeking) return false;
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.fillStyle = settings.background; ctx.fillRect(0, 0, w, h);
  if (rendered) { ctx.drawImage(video, 0, 0, w, h); return true; }
  const sw = video.videoWidth, sh = video.videoHeight;
  const quarter = settings.rotate % 180 !== 0, rw = quarter ? sh : sw, rh = quarter ? sw : sh;
  let sx, sy;
  if (settings.fit === 'stretch') { sx = w / rw; sy = h / rh; }
  else sx = sy = settings.fit === 'cover' ? Math.max(w / rw, h / rh) : Math.min(w / rw, h / rh);
  const ox = settings.fit === 'cover' ? (rw * sx - w) * (0.5 - settings.cropX / 100) : 0;
  const oy = settings.fit === 'cover' ? (rh * sy - h) * (0.5 - settings.cropY / 100) : 0;
  ctx.save(); ctx.translate(w / 2 + ox, h / 2 + oy); ctx.scale(settings.mirror ? -sx : sx, sy);
  ctx.rotate(settings.rotate * Math.PI / 180); ctx.drawImage(video, -sw / 2, -sh / 2); ctx.restore();
  return true;
}

function clearFrame(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

export class Preview {
  constructor(getState, onMode, onTime) {
    this.getState = getState; this.onMode = onMode; this.onTime = onTime;
    this.source = $('#source-video'); this.output = $('#loop-video'); this.canvas = $('#preview-canvas');
    this.alternate = $('#alternate-canvas');
    this.muted = true; this.guides = false; this.dirtyFrame = true; this.lastFrame = ''; this.lastTick = 0; this.playing = null;
    this.compositionTime = 0; this.compositionTick = null;
    this.source.addEventListener('pause', () => this.syncPlayButton());
    this.output.addEventListener('pause', () => this.syncPlayButton());
    this.source.addEventListener('ended', () => {
      const st = this.getState(), range = this.sourceRange();
      if (st.mode !== 'loop' && !st.job && range.end > range.start) {
        this.source.currentTime = range.start;
        this.source.play().catch(() => {});
      }
    });
    this.source.addEventListener('loadeddata', () => { this.dirtyFrame = true; });
    this.output.addEventListener('loadeddata', () => { this.dirtyFrame = true; });
    this.source.addEventListener('seeked', () => { this.dirtyFrame = true; });
    this.output.addEventListener('seeked', () => { this.dirtyFrame = true; });
    this.frame = this.frame.bind(this); this.raf = requestAnimationFrame(this.frame);
  }
  active() { const st = this.getState(); return st.mode === 'loop' && st.renderURL ? this.output : this.source; }
  sourceRange() {
    const st = this.getState(), search = st.mode === 'source' && st.tab === 'find';
    const duration = Number.isFinite(st.info.duration) ? Math.max(0, st.info.duration) : 0;
    const start = search ? st.opts?.from : st.s.start, end = search ? st.opts?.to : st.s.end;
    return {
      start: clamp(Number.isFinite(start) ? start : 0, 0, duration),
      end: clamp(Number.isFinite(end) ? end : 0, 0, duration),
    };
  }
  pause() { this.source.pause(); this.output.pause(); this.syncPlayButton(); }
  setSource(url) {
    if (this.active() === this.source) clearFrame(this.canvas);
    clearFrame(this.alternate);
    this.pause(); this.source.removeAttribute('src');
    if (url) this.source.src = url;
    this.source.muted = this.muted; this.source.load(); this.dirtyFrame = true;
  }
  setOutput(url) {
    if (this.active() === this.output) clearFrame(this.canvas);
    this.pause(); this.output.removeAttribute('src');
    if (url) this.output.src = url;
    this.output.muted = this.muted; this.output.load(); this.dirtyFrame = true;
  }
  setMode(mode) {
    if (mode === 'loop' && !this.getState().renderURL) return;
    const st = this.getState();
    if (mode === 'composition' && st.mode !== mode) {
      if (this.source.currentTime < st.s.start || this.source.currentTime >= st.s.end) this.source.currentTime = st.s.start;
      this.compositionTime = Math.max(0, (this.source.currentTime - st.s.start) / st.s.speed);
      this.compositionTick = null;
    }
    this.pause(); this.onMode(mode); this.dirtyFrame = true;
  }
  refresh() {
    const st = this.getState();
    const dims = st.mode === 'loop' && st.render ? st.render : st.mode === 'composition' ? st.s : st.info.width ? st.info : st.s;
    const ratio = dims.width / dims.height;
    const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 9 / 16;
    const w = Math.max(1, Math.round(Math.min(960, 960 * aspect))), h = Math.max(1, Math.round(w / aspect));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvas.style.setProperty('--preview-aspect', String(aspect));
    const alternate = alternateFormat(st.s), alternateRatio = alternate.width / alternate.height;
    const alternateWidth = Math.round(Math.min(128, 128 * alternateRatio)), alternateHeight = Math.round(alternateWidth / alternateRatio);
    if (this.alternate.width !== alternateWidth) this.alternate.width = alternateWidth;
    if (this.alternate.height !== alternateHeight) this.alternate.height = alternateHeight;
    this.source.playbackRate = clamp(st.s.speed || 1, 0.25, 4);
    this.dirtyFrame = true;
    this.syncPlayButton();
  }
  syncPlayButton() {
    const playing = !this.active().paused;
    if (this.playing !== playing) {
      this.playing = playing;
      const button = $('[data-action="play"]');
      button.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
      button.innerHTML = icon(playing ? 'Pause' : 'Play', 18);
    }
  }
  async play() {
    const st = this.getState(), video = this.active();
    if (st.job || !st.info.duration) return;
    if (!video.paused) video.pause();
    else {
      if (st.mode !== 'loop') {
        const range = this.sourceRange();
        if (range.end <= range.start) return;
        if (video.currentTime < range.start || video.currentTime >= range.end) video.currentTime = range.start;
      }
      await video.play().catch(() => {});
    }
    this.syncPlayButton();
  }
  step(direction) {
    const st = this.getState(), video = this.active();
    if (st.job || !st.info.duration) return;
    video.pause();
    const rate = st.mode === 'loop' ? st.render?.fps || st.s.fps : st.mode === 'composition' ? st.s.fps : st.info.fps || 30;
    const delta = st.mode === 'composition' ? st.s.speed / rate : 1 / rate;
    const range = st.mode === 'loop' ? { start: 0, end: video.duration } : this.sourceRange();
    if (range.end <= range.start) return;
    video.currentTime = clamp(video.currentTime + direction * delta, range.start, Math.max(range.start, range.end - delta));
    if (st.mode === 'composition') this.compositionTime = Math.max(0, this.compositionTime + direction / st.s.fps);
    this.syncPlayButton(); this.dirtyFrame = true;
  }
  seek(time, mode = 'source') {
    this.setMode(mode);
    const st = this.getState(), video = this.active();
    const duration = mode === 'loop' ? st.render?.duration || video.duration : st.info.duration;
    video.currentTime = clamp(time, 0, Math.max(0, duration - 0.001));
    if (mode === 'composition') this.compositionTime = Math.max(0, (video.currentTime - st.s.start) / st.s.speed);
    this.dirtyFrame = true; this.onTime(video.currentTime, mode);
  }
  toggleMute() {
    this.muted = !this.muted; this.source.muted = this.output.muted = this.muted;
    const button = $('[data-action="mute"]');
    button.setAttribute('aria-label', this.muted ? 'Unmute preview' : 'Mute preview');
    button.innerHTML = icon(this.muted ? 'VolumeX' : 'Volume2', 17);
  }
  toggleGuides() {
    this.guides = !this.guides; $('#safe-guides').hidden = !this.guides;
    $('[data-action="guides"]').setAttribute('aria-pressed', String(this.guides));
  }
  fullscreen() { return $('#preview-stage').requestFullscreen?.().catch(() => {}); }
  saveFrame() { this.canvas.toBlob(blob => { if (blob) download(blob, 'loop-preview-frame.png'); }, 'image/png'); }
  frame(now) {
    const st = this.getState(), video = this.active();
    if (st.mode === 'composition') {
      const period = framePlan(st.s).duration;
      if (!video.paused && this.compositionTick !== null)
        this.compositionTime = (this.compositionTime + Math.max(0, now - this.compositionTick) / 1000) % period;
      this.compositionTick = now;
    } else this.compositionTick = null;
    if (st.mode !== 'loop' && !video.paused) {
      const range = this.sourceRange();
      if (range.end > range.start && (video.currentTime >= range.end - 0.005 || video.currentTime < range.start - 0.05)) video.currentTime = range.start;
    }
    const key = `${st.mode}-${video.currentTime}-${video.readyState}-${st.mode === 'composition' ? this.compositionTime : ''}`;
    if (this.dirtyFrame || key !== this.lastFrame) {
      // Composition uses live framing; encoded output already includes its layers.
      if (drawFrame(this.canvas, video, st.s, st.mode !== 'composition')) {
        if (st.mode === 'composition') drawLayers(this.canvas.getContext('2d'), st.s.layers || [], st.s,
          this.compositionTime, framePlan(st.s).duration);
        this.lastFrame = key; this.dirtyFrame = false;
      }
    }
    if (now - this.lastTick > 100) {
      const duration = st.mode === 'loop' ? st.render?.duration || video.duration || 0 : st.mode === 'composition' ? framePlan(st.s).duration : st.info.duration;
      $('#transport-time').textContent = `${timecode(st.mode === 'composition' ? this.compositionTime % duration : video.currentTime)} / ${timecode(duration)}`;
      drawFrame(this.alternate, this.source, { ...st.s, ...alternateFormat(st.s) }, false);
      this.lastTick = now; this.syncPlayButton();
    }
    this.onTime(video.currentTime, st.mode);
    this.raf = requestAnimationFrame(this.frame);
  }
  destroy() { cancelAnimationFrame(this.raf); this.pause(); }
}
