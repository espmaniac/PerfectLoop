const APP_ICONS = {
  Photos: '<path d="m12 3 2.7 5.5L21 9l-4.5 4.4 1 6.3-5.5-2.9-5.5 2.9 1-6.3L3 9l6.3-.5Z"/>',
  Camera: '<path d="M4 7h4l2-3h4l2 3h4v13H4Z"/><circle cx="12" cy="13" r="4"/>',
  Notes: '<path d="M6 3h12v18H6Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  Maps: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/>',
  Music: '<path d="M10 18V5l10-2v13M10 9l10-2"/><ellipse cx="6.5" cy="18" rx="3.5" ry="3"/><ellipse cx="16.5" cy="16" rx="3.5" ry="3"/>',
  Clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  Mail: '<path d="M3 5h18v14H3Z"/><path d="m3 5 9 7 9-7"/>',
  Calendar: '<path d="M4 5h16v16H4ZM4 10h16M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 17h2M14 17h2"/>',
  Phone: '<path d="M7 3 3 7c0 7 7 14 14 14l4-4-5-4-3 3c-3-1-4-3-5-5l3-3Z"/>',
  Messages: '<path d="M21 11c0 5-4 8-9 8H7l-4 2 1-5c-1-1-1-3-1-5 0-5 4-8 9-8s9 3 9 8Z"/>',
  Browser: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>',
  Flashlight: '<path d="M6 3h12v5l-3 4v9H9v-9L6 8ZM6 7h12M10 15h4"/>',
};

function screenIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${APP_ICONS[name] || APP_ICONS.Photos}</svg>`;
}

function appTile(name, index, dock = false) {
  return `<div class="wallpaper-app${dock ? ' wallpaper-dock-app' : ''}" style="--wallpaper-app-color:${['#376bae', '#6f5b85', '#9b8049', '#4d877d', '#a44e6c', '#546176', '#47859a', '#8e6861'][index % 8]}"><span>${screenIcon(name)}</span>${dock ? '' : `<small>${name}</small>`}</div>`;
}

/** Device chrome is DOM-only: it is never painted into the exported canvas. */
export class WallpaperPreview {
  constructor(controlsHost, stage, onScreenChange) {
    this.controlsHost = controlsHost;
    this.stage = stage;
    this.onScreenChange = onScreenChange;
    this.canvas = stage.querySelector('#preview-canvas');
    this.options = { enabled: false, screen: 'editor', width: 1170, height: 2532, device: 'notch', posterURL: '' };
    this.controlsHost.classList.add('wallpaper-preview-controls');
    this.controlsHost.innerHTML = '<div class="segmented wallpaper-screen-options" role="group" aria-label="Wallpaper screen preview"><button type="button" data-wallpaper-screen="editor" aria-pressed="true">Editor</button><button type="button" data-wallpaper-screen="lock" aria-pressed="false">Lock Screen</button><button type="button" data-wallpaper-screen="home" aria-pressed="false">Home Screen</button></div><p class="micro wallpaper-preview-note"></p>';
    this.handleScreenClick = event => {
      const button = event.target.closest('[data-wallpaper-screen]');
      if (button && !button.disabled) this.onScreenChange(button.dataset.wallpaperScreen);
    };
    this.controlsHost.addEventListener('click', this.handleScreenClick);

    this.device = document.createElement('div');
    this.device.className = 'wallpaper-device';
    this.display = document.createElement('div');
    this.display.className = 'wallpaper-display';
    this.canvas.before(this.device);
    this.device.append(this.display);
    this.display.append(this.canvas);
    const guides = stage.querySelector('#safe-guides');
    if (guides) this.display.append(guides);
    this.poster = document.createElement('img');
    this.poster.className = 'wallpaper-poster';
    this.poster.alt = 'Still Home Screen wallpaper preview';
    this.poster.hidden = true;
    this.snapshot = document.createElement('canvas');
    this.snapshot.className = 'wallpaper-poster wallpaper-poster-snapshot';
    this.snapshot.setAttribute('aria-label', 'Still Home Screen wallpaper preview');
    this.snapshot.hidden = true;
    this.display.append(this.poster, this.snapshot);
    this.chrome = document.createElement('div');
    this.chrome.className = 'wallpaper-screen-chrome';
    this.chrome.setAttribute('aria-hidden', 'true');
    this.chrome.innerHTML = `<div class="wallpaper-status"><span class="wallpaper-status-time">9:41</span><span class="wallpaper-status-icons"><i class="wallpaper-signal"></i><i class="wallpaper-battery"></i></span></div><div class="wallpaper-camera-cutout"></div><div class="wallpaper-lock-ui"><div class="wallpaper-date">Monday, June 3</div><div class="wallpaper-clock">9:41</div><div class="wallpaper-lock-actions"><span>${screenIcon('Flashlight')}</span><span>${screenIcon('Camera')}</span></div></div><div class="wallpaper-home-ui"><div class="wallpaper-app-grid">${['Photos', 'Camera', 'Notes', 'Maps', 'Music', 'Clock', 'Mail', 'Calendar'].map((name, index) => appTile(name, index)).join('')}</div><div class="wallpaper-dock">${['Phone', 'Messages', 'Browser', 'Music'].map((name, index) => appTile(name, index + 2, true)).join('')}</div></div><div class="wallpaper-home-indicator"></div>`;
    this.display.append(this.chrome);
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(stage);
    this.refresh(this.options);
  }

  refresh(options) {
    const previous = this.options;
    this.options = { ...previous, ...options };
    const { enabled, screen, device, posterURL, disabled, draft } = this.options;
    const active = enabled && screen !== 'editor';
    this.controlsHost.hidden = !enabled;
    this.stage.classList.toggle('wallpaper-screen-active', active);
    this.stage.dataset.wallpaperScreen = active ? screen : 'editor';
    this.device.dataset.device = ['island', 'notch', 'button'].includes(device) ? device : 'notch';
    this.chrome.hidden = !active;
    this.controlsHost.querySelectorAll('[data-wallpaper-screen]').forEach(button => {
      const selected = button.dataset.wallpaperScreen === screen;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = Boolean(disabled);
    });
    this.controlsHost.querySelector('.wallpaper-preview-note').textContent = screen === 'home'
      ? `Approximate${draft || !posterURL ? ' draft' : ''} Home Screen · wallpaper stays still. Clock and icons are not exported.`
      : screen === 'lock'
        ? `Approximate${draft ? ' draft' : ''} Lock Screen · animation depends on iPhone and iOS support. Clock and controls are not exported.`
        : 'Use Lock Screen or Home Screen to check the approximate layout on an iPhone.';
    const home = active && screen === 'home';
    this.poster.hidden = !home || !posterURL;
    this.snapshot.hidden = !home || Boolean(posterURL);
    this.canvas.classList.toggle('wallpaper-live-hidden', home);
    if (posterURL && this.poster.getAttribute('src') !== posterURL) this.poster.src = posterURL;
    if (!posterURL) this.poster.removeAttribute('src');
    if (home && !posterURL && (previous.screen !== 'home' || previous.posterURL || !previous.enabled)) {
      this.captureStill();
      cancelAnimationFrame(this.captureRAF);
      this.captureRAF = requestAnimationFrame(() => {
        if (this.options.enabled && this.options.screen === 'home' && !this.options.posterURL) this.captureStill();
      });
    }
    if (active) this.resize();
  }

  captureStill() {
    this.snapshot.width = this.canvas.width;
    this.snapshot.height = this.canvas.height;
    this.snapshot.getContext('2d').drawImage(this.canvas, 0, 0);
  }

  resize() {
    if (!this.options.enabled || this.options.screen === 'editor') return;
    const { width, height, device } = this.options;
    const ratio = Number.isFinite(width / height) && width > 0 && height > 0 ? width / height : 9 / 19.5;
    const bezel = device === 'button' ? 0.26 : 0;
    const stageWidth = this.stage.clientWidth, stageHeight = this.stage.clientHeight;
    const displayWidth = Math.max(1, Math.min(stageWidth - 46, (stageHeight - 42) / (1 / ratio + bezel)));
    this.device.style.setProperty('--wallpaper-width', `${displayWidth}px`);
    this.device.style.setProperty('--wallpaper-unit', `${displayWidth / 100}px`);
    this.display.style.aspectRatio = String(ratio);
  }

  destroy() {
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.captureRAF);
    this.controlsHost.removeEventListener('click', this.handleScreenClick);
    this.stage.classList.remove('wallpaper-screen-active');
    this.stage.removeAttribute('data-wallpaper-screen');
    this.canvas.classList.remove('wallpaper-live-hidden');
    this.device.before(this.canvas);
    const guides = this.display.querySelector('#safe-guides');
    if (guides) this.canvas.after(guides);
    this.device.remove();
    this.controlsHost.replaceChildren();
  }
}
