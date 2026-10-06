import { clamp, timecode } from './logic.js';
import { $, $$, icon } from './ui.js';

export class Timeline {
  constructor(getState, update, seek, remember) {
    this.getState = getState; this.update = update; this.seek = seek; this.remember = remember;
    this.zoom = false; this.emptyFrames = []; this.ruler = $('#filmstrip');
    this.ruler.addEventListener('pointerdown', e => {
      const edge = e.target.closest('[data-edge]');
      if (edge) { this.drag(e, edge); return; }
      const st = getState(); if (st.job || !(this.isRendered() ? st.render.duration : st.info.duration)) return;
      const { from, span } = this.window(), box = this.ruler.getBoundingClientRect();
      this.seek(from + clamp((e.clientX - box.left) / box.width, 0, 1) * span);
    });
    $$('[data-edge]').forEach(button => button.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); const st = getState(); if (st.job || this.isRendered() || !st.info.duration) return;
      const edge = button.dataset.edge, delta = (e.key === 'ArrowRight' ? 1 : -1) / (st.info.fps || 30);
      const range = this.selection(), minimum = this.isSearch() ? 1 / (st.info.fps || 30) : 0.1;
      update(edge === 'start' ? { start: clamp(range.start + delta, 0, Math.max(0, range.end - minimum)) } : { end: clamp(range.end + delta, Math.min(st.info.duration, range.start + minimum), st.info.duration) });
    }));
  }
  isRendered() {
    const st = this.getState();
    return st.mode === 'loop' && Boolean(st.render && st.renderURL);
  }
  isSearch() { return this.getState().tab === 'find' && !this.isRendered(); }
  selection() {
    const st = this.getState(), duration = Math.max(0, st.info.duration || 0);
    const start = this.isSearch() ? st.opts?.from : st.s.start;
    const end = this.isSearch() ? st.opts?.to : st.s.end;
    const safeStart = clamp(Number.isFinite(start) ? start : 0, 0, duration);
    return { start: safeStart, end: clamp(Number.isFinite(end) ? end : duration, safeStart, duration) };
  }
  dragValid() {
    const st = this.getState(), drag = this.dragging;
    return drag && !st.job && !this.isRendered() && st.mode === drag.mode && st.tab === drag.tab && st.file === drag.file && st.info.duration === drag.duration;
  }
  window() {
    const { info, render } = this.getState();
    if (this.isRendered()) {
      const span = Math.max(0.001, render.duration);
      return { from: 0, span, percent: t => t / span * 100 };
    }
    if (this.dragValid()) return this.dragging.window;
    const range = this.selection();
    const duration = Math.max(0.001, info.duration);
    const span = this.zoom ? Math.min(duration, Math.max(0.01, range.end - range.start) * 1.8) : duration;
    const from = this.zoom ? clamp((range.end + range.start - span) / 2, 0, duration - span) : 0;
    return { from, span, percent: t => (t - from) / span * 100 };
  }
  render() {
    if (this.dragging && !this.dragValid()) this.finishDrag(false);
    const st = this.getState(), rendered = this.isRendered(), { from, span, percent } = this.window();
    const range = this.selection(), search = this.isSearch();
    $('#range-duration').textContent = rendered ? `0.000–${st.render.duration.toFixed(3)}s rendered` : `${(range.end - range.start).toFixed(3)}s ${search ? 'search range' : 'selected'}`;
    $('#ruler-labels').innerHTML = Array.from({ length: 5 }, (_, i) => {
      const label = timecode(from + span * i / 4);
      return `<span>${rendered ? label : label.split('.')[0]}</span>`;
    }).join('');
    if (rendered) {
      $('#timeline-preview-end').textContent = st.render.duration.toFixed(3);
      $('#timeline-preview-duration').textContent = st.render.duration.toFixed(3);
    }
    const left = rendered ? 0 : clamp(percent(range.start), 0, 100), right = rendered ? 100 : clamp(percent(range.end), 0, 100);
    $('#shade-left').hidden = rendered; $('#shade-right').hidden = rendered;
    $('#shade-left').style.width = `${left}%`; $('#shade-right').style.width = `${100 - right}%`;
    $('#selection-outline').style.left = `${left}%`; $('#selection-outline').style.width = `${Math.max(0, right - left)}%`;
    $$('[data-edge]').forEach(button => {
      button.hidden = rendered;
      button.style.left = `clamp(8px, ${percent(range[button.dataset.edge])}%, calc(100% - 8px))`;
      button.setAttribute('aria-label', `Drag ${search ? 'search' : 'trim'} ${button.dataset.edge} handle`);
    });
    const strip = $('#filmstrip-images'), frames = (rendered ? st.renderFilmstrip : st.filmstrip) || this.emptyFrames;
    if (strip.children.length !== 10 || this.frames !== frames) {
      this.frames = frames;
      strip.innerHTML = frames.length ? '<img alt="" draggable="false">'.repeat(10) : '<span></span>'.repeat(10);
    }
    if (frames.length) [...strip.children].forEach((img, i) => {
      const duration = rendered ? st.render.duration : st.info.duration;
      const index = Math.round(clamp((from + span * i / 9) / duration, 0, 1) * (frames.length - 1));
      const src = frames[index]; if (img.getAttribute('src') !== src) img.src = src;
    });
    this.renderPlayhead(rendered ? st.renderPlayhead : st.playhead);
  }
  renderPlayhead(time) {
    const percent = this.window().percent(time), el = $('#playhead');
    el.hidden = percent < 0 || percent > 100; el.style.left = `${percent}%`;
  }
  toggleZoom() {
    if (this.isRendered()) return;
    if (this.dragging) this.finishDrag(false);
    this.zoom = !this.zoom;
    const button = $('[data-action="zoom"]');
    button.setAttribute('aria-label', this.zoom ? 'Show full timeline' : 'Zoom to selection');
    button.innerHTML = icon(this.zoom ? 'ZoomOut' : 'ZoomIn', 17); this.render();
  }
  drag(event, button) {
    event.preventDefault(); event.stopPropagation(); const st = this.getState();
    if (st.job || this.isRendered() || !st.info.duration) return;
    const edge = button.dataset.edge;
    if (this.dragging) this.finishDrag(false);
    const window = this.window();
    this.dragging = { window, mode: st.mode, tab: st.tab, file: st.file, duration: st.info.duration };
    button.setPointerCapture(event.pointerId); this.remember();
    const move = e => {
      if (!this.dragValid()) { finish(); return; }
      const current = this.getState(), { from, span } = window, box = this.ruler.getBoundingClientRect();
      const rate = current.info.fps || 30;
      const time = Math.round((from + clamp((e.clientX - box.left) / box.width, 0, 1) * span) * rate) / rate;
      const range = this.selection(), minimum = this.isSearch() ? 1 / rate : 3 / current.s.fps * current.s.speed;
      this.update(edge === 'start' ? { start: clamp(time, 0, Math.max(0, range.end - minimum)) } : { end: clamp(time, Math.min(current.info.duration, range.start + minimum), current.info.duration) }, false);
    };
    const finish = (refresh = true) => {
      button.removeEventListener('pointermove', move); button.removeEventListener('pointerup', finish); button.removeEventListener('pointercancel', finish); button.removeEventListener('lostpointercapture', finish);
      this.dragging = null; this.finishDrag = null;
      if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      if (refresh) this.render();
    };
    this.finishDrag = finish;
    button.addEventListener('pointermove', move); button.addEventListener('pointerup', finish, { once: true }); button.addEventListener('pointercancel', finish, { once: true });
    button.addEventListener('lostpointercapture', finish, { once: true });
  }
}
