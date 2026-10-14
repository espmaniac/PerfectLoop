// Coalesce edits and attempt each settings revision once. A failed or cancelled
// render waits for a new edit or an explicit retry instead of restarting forever.
export class AutoPreview {
    constructor(render, { delay = 900, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) } = {}) {
        Object.assign(this, { render, delay, setTimer, clearTimer });
        this.attempted = ''; this.pending = ''; this.timer = null;
    }
    stop() {
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null; this.pending = '';
    }
    sync(key, eligible) {
        if (!eligible || !key || key === this.attempted) { this.stop(); return; }
        if (this.pending === key) return;
        this.stop(); this.pending = key;
        this.timer = this.setTimer(() => {
            this.timer = null; this.pending = ''; this.attempted = key;
            void this.render(key);
        }, this.delay);
    }
    retry() { this.attempted = ''; this.stop(); }
}
