import { clamp, timecode } from './logic.js';
import { $, $$, icon } from './ui.js';

export class Timeline {
  constructor(getState, update, seek, remember) {
    this.getState = getState; this.update = update; this.seek = seek; this.remember = remember;
    this.zoom = false; this.ruler = $('#filmstrip');
    this.ruler.addEventListener('pointerdown', e => {
      const edge = e.target.closest('[data-edge]');
      if (edge) { this.drag(e, edge); return; }
      const st = getState(); if (st.job || !st.info.duration) return;
      const { from, span } = this.window(), box = this.ruler.getBoundingClientRect();
      seek(from + clamp((e.clientX - box.left) / box.width, 0, 1) * span);
    });
    $$('[data-edge]').forEach(button => button.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); const st = getState(); if (st.job) return;
      const edge = button.dataset.edge, delta = (e.key === 'ArrowRight' ? 1 : -1) / (st.info.fps || 30);
      update(edge === 'start' ? { start: clamp(st.s.start + delta, 0, st.s.end - 0.1) } : { end: clamp(st.s.end + delta, st.s.start + 0.1, st.info.duration) });
    }));
  }
  window() {
    const { s, info } = this.getState(), duration = Math.max(0.001, info.duration);
    const span = this.zoom ? Math.min(duration, Math.max(0.01, s.end - s.start) * 1.8) : duration;
    const from = this.zoom ? clamp((s.end + s.start - span) / 2, 0, duration - span) : 0;
    return { from, span, percent: t => (t - from) / span * 100 };
  }
  render() {
    const st = this.getState(), { from, span, percent } = this.window();
    $('#range-duration').textContent = `${(st.s.end - st.s.start).toFixed(3)}s selected`;
    $('#ruler-labels').innerHTML = Array.from({ length: 5 }, (_, i) => `<span>${timecode(from + span * i / 4).split('.')[0]}</span>`).join('');
    const left = clamp(percent(st.s.start), 0, 100), right = clamp(percent(st.s.end), 0, 100);
    $('#shade-left').style.width = `${left}%`; $('#shade-right').style.width = `${100 - right}%`;
    $('#selection-outline').style.left = `${left}%`; $('#selection-outline').style.width = `${Math.max(0, right - left)}%`;
    $$('[data-edge]').forEach(button => { button.style.left = `clamp(8px, ${percent(st.s[button.dataset.edge])}%, calc(100% - 8px))`; });
    const strip = $('#filmstrip-images');
    if (strip.children.length !== 10 || this.frames !== st.filmstrip) {
      this.frames = st.filmstrip;
      strip.innerHTML = st.filmstrip.length ? '<img alt="" draggable="false">'.repeat(10) : '<span></span>'.repeat(10);
    }
    if (st.filmstrip.length) [...strip.children].forEach((img, i) => {
      const index = Math.round(clamp((from + span * i / 9) / st.info.duration, 0, 1) * (st.filmstrip.length - 1));
      const src = st.filmstrip[index]; if (img.getAttribute('src') !== src) img.src = src;
    });
    this.renderPlayhead(st.playhead);
  }
  renderPlayhead(time) {
    const percent = this.window().percent(time), el = $('#playhead');
    el.hidden = percent < 0 || percent > 100; el.style.left = `${percent}%`;
  }
  toggleZoom() {
    this.zoom = !this.zoom;
    const button = $('[data-action="zoom"]');
    button.setAttribute('aria-label', this.zoom ? 'Show full timeline' : 'Zoom to selection');
    button.innerHTML = icon(this.zoom ? 'ZoomOut' : 'ZoomIn', 17); this.render();
  }
  drag(event, button) {
    event.preventDefault(); event.stopPropagation(); const st = this.getState();
    if (st.job || !st.info.duration) return;
    const edge = button.dataset.edge;
    button.setPointerCapture(event.pointerId); this.remember();
    const move = e => {
      const current = this.getState(), { from, span } = this.window(), box = this.ruler.getBoundingClientRect();
      const rate = current.info.fps || 30;
      const time = Math.round((from + clamp((e.clientX - box.left) / box.width, 0, 1) * span) * rate) / rate;
      const minimum = 3 / current.s.fps * current.s.speed;
      this.update(edge === 'start' ? { start: clamp(time, 0, current.s.end - minimum) } : { end: clamp(time, current.s.start + minimum, current.info.duration) }, false);
    };
    const finish = () => { button.removeEventListener('pointermove', move); button.removeEventListener('pointerup', finish); button.removeEventListener('pointercancel', finish); };
    button.addEventListener('pointermove', move); button.addEventListener('pointerup', finish, { once: true }); button.addEventListener('pointercancel', finish, { once: true });
  }
}
