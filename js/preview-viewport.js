const CAMERA_PROPERTIES = ['position', 'width', 'height', 'left', 'top', 'max-width', 'max-height'];

/** Editor-only camera. Intrinsic canvas dimensions and exported pixels stay unchanged. */
export class PreviewViewport {
  constructor(canvas, stage, { padding = 64 } = {}) {
    this.canvas = canvas;
    this.stage = stage;
    this.padding = Number.isFinite(padding) ? Math.max(0, padding) : 64;
    this.enabled = false;
    this.locked = false;
    this.shapes = [];
    this.savedStyles = null;
    this.camera = null;
    this.appliedSelectionKey = null;
    this.appliedLayoutKey = null;
  }

  dimensions() {
    return {
      width: this.canvas.width,
      height: this.canvas.height,
      stageWidth: this.stage.clientWidth,
      stageHeight: this.stage.clientHeight,
    };
  }

  layoutKey() {
    const { width, height, stageWidth, stageHeight } = this.dimensions();
    return `${width}:${height}:${stageWidth}:${stageHeight}`;
  }

  outputScale() {
    const { width, height, stageWidth, stageHeight } = this.dimensions();
    if (!(width > 0 && height > 0 && stageWidth > 0 && stageHeight > 0)) return 0;
    return Math.min(stageWidth / width, stageHeight / height);
  }

  view() {
    const baseScale = this.outputScale(), scale = this.camera?.scale || baseScale;
    return {
      enabled: this.enabled,
      scale,
      zoomPercent: baseScale > 0 ? Math.round(scale / baseScale * 100) : 100,
    };
  }

  refresh({ enabled, selectionKey = '', shapes = [], locked = false }) {
    this.shapes = shapes;
    this.locked = Boolean(locked);
    this.selectionKey = selectionKey;
    if (!enabled) {
      this.reset();
      return this.view();
    }
    if (!this.enabled) {
      this.savedStyles = CAMERA_PROPERTIES.map(property => [property,
        this.canvas.style.getPropertyValue(property), this.canvas.style.getPropertyPriority(property)]);
      this.enabled = true;
      this.stage.classList.add('preview-camera-active');
    }
    // Fitting while a pointer is held would move its target and cancel the edit.
    // Playback also keeps its view stable when an animated selection changes.
    if (!this.locked && (this.appliedSelectionKey !== selectionKey || this.appliedLayoutKey !== this.layoutKey())) {
      this.fit(shapes);
    }
    return this.view();
  }

  fit(shapes = this.shapes) {
    if (!this.enabled || this.locked) return this.view();
    const { width, height, stageWidth, stageHeight } = this.dimensions();
    if (!(width > 0 && height > 0 && stageWidth > 0 && stageHeight > 0)) return this.view();
    let left = 0, top = 0, right = width, bottom = height;
    for (const shape of shapes) for (const point of shape.corners || []) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      left = Math.min(left, point.x); top = Math.min(top, point.y);
      right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
    }
    const padding = Math.min(this.padding, stageWidth / 3, stageHeight / 3);
    this.camera = {
      scale: Math.min((stageWidth - 2 * padding) / (right - left), (stageHeight - 2 * padding) / (bottom - top)),
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
    };
    this.shapes = shapes;
    this.appliedSelectionKey = this.selectionKey;
    this.appliedLayoutKey = this.layoutKey();
    this.apply();
    return this.view();
  }

  zoomBy(factor) {
    if (!this.enabled || this.locked || !this.camera || !Number.isFinite(factor) || factor <= 0) return this.view();
    const baseScale = this.outputScale();
    if (!baseScale) return this.view();
    this.camera.scale = Math.max(baseScale * 0.02, Math.min(baseScale * 8, this.camera.scale * factor));
    this.apply();
    return this.view();
  }

  apply() {
    const { width, height, stageWidth, stageHeight } = this.dimensions();
    const { scale, centerX, centerY } = this.camera;
    const properties = {
      position: 'absolute',
      width: `${width * scale}px`,
      height: `${height * scale}px`,
      left: `${stageWidth / 2 - centerX * scale}px`,
      top: `${stageHeight / 2 - centerY * scale}px`,
      'max-width': 'none',
      'max-height': 'none',
    };
    for (const [property, value] of Object.entries(properties)) this.canvas.style.setProperty(property, value);
  }

  reset() {
    for (const [property, value, priority] of this.savedStyles || []) {
      if (value) this.canvas.style.setProperty(property, value, priority);
      else this.canvas.style.removeProperty(property);
    }
    this.stage.classList.remove('preview-camera-active');
    this.enabled = false;
    this.savedStyles = null;
    this.camera = null;
    this.appliedSelectionKey = null;
    this.appliedLayoutKey = null;
  }

  destroy() { this.reset(); }
}
