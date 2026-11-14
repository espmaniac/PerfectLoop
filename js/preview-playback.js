import { needsEncoding } from './loop-frames.js';

// Most results play live in the browser. Only repairs and interpolation are
// encoded, and only Play requests that encoding. Edits stop playback and
// invalidate any pending request to resume it; they never enqueue encoding work.
export class PreviewPlayback {
    constructor({getState, preview, render, needsRender}) {
        Object.assign(this, {getState, preview, render, needsRender});
        this.version = 0; this.pending = false;
    }
    stop() { this.version++; this.preview.pause(); }
    async play() {
        const initial = this.getState();
        if (this.pending || initial.job || !initial.info.duration) return;
        if (!this.preview.active().paused) { this.stop(); return; }
        const result = initial.previewChoice === 'result' && initial.tab !== 'find';
        const encoded = result && needsEncoding(initial.s);
        const source = initial.sourceURL, version = ++this.version;
        this.pending = true;
        try {
            if (encoded && (this.needsRender() || !initial.renderURL)) {
                if (!await this.render()) return;
            }
            const current = this.getState();
            if (version !== this.version || current.job || source !== current.sourceURL) return;
            if (encoded) {
                if (current.previewChoice !== 'result' || current.tab === 'find' || this.needsRender() || !current.renderURL) return;
                if (current.mode !== 'loop') this.preview.setMode('loop');
            } else if (result && current.mode === 'loop') this.preview.setMode('composition');
            await this.preview.play();
        } finally { this.pending = false; }
    }
}
