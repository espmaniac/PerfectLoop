import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewViewport } from '../js/preview-viewport.js';

class FakeStyle {
  constructor() { this.values = new Map(); }
  getPropertyValue(property) { return this.values.get(property)?.value || ''; }
  getPropertyPriority(property) { return this.values.get(property)?.priority || ''; }
  setProperty(property, value, priority = '') { this.values.set(property, { value, priority }); }
  removeProperty(property) { this.values.delete(property); }
}

function fixture() {
  const canvas = { width: 400, height: 400, style: new FakeStyle() };
  const classes = new Set();
  const stage = {
    clientWidth: 800, clientHeight: 600,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
  };
  const viewport = new PreviewViewport(canvas, stage);
  const css = property => parseFloat(canvas.style.getPropertyValue(property));
  const position = point => ({
    x: css('left') + point.x / canvas.width * css('width'),
    y: css('top') + point.y / canvas.height * css('height'),
  });
  return { canvas, stage, classes, viewport, css, position };
}

const oversized = [{ corners: [
  { x: -300, y: -150 }, { x: 900, y: -150 }, { x: 900, y: 450 }, { x: -300, y: 450 },
] }];

test('Fitting exposes real off-canvas corners with room for transform controls', () => {
  const f = fixture();
  const view = f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: oversized });
  assert.equal(view.scale, 0.56);
  assert.equal(view.zoomPercent, 37);
  for (const corner of oversized[0].corners) {
    const point = f.position(corner);
    assert.ok(point.x >= 64 - 1e-9 && point.x <= f.stage.clientWidth - 64 + 1e-9);
    assert.ok(point.y >= 64 - 1e-9 && point.y <= f.stage.clientHeight - 64 + 1e-9);
  }
  assert.deepEqual([f.canvas.width, f.canvas.height], [400, 400], 'the exported frame dimensions stay unchanged');
  assert.equal(f.canvas.style.getPropertyValue('position'), 'absolute');
  assert.equal(f.canvas.style.getPropertyValue('max-width'), 'none');
  assert.ok(f.classes.has('preview-camera-active'));
});

test('Changing a selected object does not move the camera until Fit view is requested', () => {
  const f = fixture();
  f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: [] });
  const previous = [...f.canvas.style.values];
  f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: oversized });
  assert.deepEqual([...f.canvas.style.values], previous);
  f.viewport.fit();
  assert.equal(f.viewport.view().scale, 0.56);
  assert.notDeepEqual([...f.canvas.style.values], previous);
  f.viewport.refresh({ enabled: true, selectionKey: 'another-image', shapes: [] });
  assert.ok(f.viewport.view().scale > 0.56, 'selecting another object fits that object and the output frame');
});

test('Gesture and playback locks defer selection and stage-size refits', () => {
  const f = fixture();
  f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: [] });
  const previous = [...f.canvas.style.values];
  f.stage.clientWidth = 1000;
  f.viewport.refresh({ enabled: true, selectionKey: 'video', shapes: oversized, locked: true });
  f.viewport.fit();
  f.viewport.zoomBy(2);
  assert.deepEqual([...f.canvas.style.values], previous, 'pointer coordinates retain the same canvas CSS geometry');
  f.viewport.refresh({ enabled: true, selectionKey: 'video', shapes: oversized, locked: false });
  assert.notDeepEqual([...f.canvas.style.values], previous);
  assert.ok(Math.abs(f.viewport.view().scale - 872 / 1200) < 1e-12);
});

test('View zoom keeps the fitted world center stationary and ignores invalid factors', () => {
  const f = fixture();
  f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: oversized });
  const center = { x: 300, y: 150 };
  assert.deepEqual(f.position(center), { x: 400, y: 300 });
  f.viewport.zoomBy(2);
  assert.equal(f.viewport.view().scale, 1.12);
  assert.deepEqual(f.position(center), { x: 400, y: 300 });
  for (const factor of [0, -1, NaN, Infinity]) f.viewport.zoomBy(factor);
  assert.equal(f.viewport.view().scale, 1.12);
  f.viewport.zoomBy(0.5);
  assert.equal(f.viewport.view().scale, 0.56);
});

test('Source, Loop and device layouts restore their previous canvas styles', () => {
  const f = fixture();
  f.canvas.style.setProperty('--preview-aspect', '1');
  f.canvas.style.setProperty('width', '80%', 'important');
  const initial = [...f.canvas.style.values];
  f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: oversized });
  f.viewport.refresh({ enabled: false });
  assert.deepEqual([...f.canvas.style.values], initial);
  assert.equal(f.classes.has('preview-camera-active'), false);
  assert.equal(f.viewport.view().enabled, false);
  f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: oversized });
  f.viewport.destroy();
  assert.deepEqual([...f.canvas.style.values], initial);
});

test('A hidden stage waits for usable dimensions before fitting', () => {
  const f = fixture();
  f.stage.clientWidth = 0;
  f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: oversized });
  assert.equal(f.canvas.style.getPropertyValue('position'), '');
  f.stage.clientWidth = 800;
  f.viewport.refresh({ enabled: true, selectionKey: 'image', shapes: oversized });
  assert.equal(f.viewport.view().scale, 0.56);
});
