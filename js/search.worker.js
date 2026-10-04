import { rankFrames } from './ranking.js';
self.onmessage = (event) => {
    try {
        self.postMessage({ candidates: rankFrames(event.data.frames, event.data.options) });
    }
    catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};
