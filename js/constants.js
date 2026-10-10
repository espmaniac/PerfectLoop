export const METHODS = [
    { id: 'natural', name: 'Natural cut', short: 'Keep the original motion', detail: 'Use matching moments in the source. Best for genuinely repeating motion. Find a close match with Auto find, then inspect the seam.' },
    { id: 'crossfade', name: 'Crossfade', short: 'Blend the end into the start', detail: 'Overlap the tail and head, then join them with a dissolve. The loop becomes shorter by the overlap. Works well for light, smoke, water, and abstract footage.' },
    { id: 'offset', name: 'Offset dissolve', short: 'Move the transition inside', detail: 'Create a cyclic dissolve, then rotate the timeline. The file boundary follows continuous source motion; the dissolve appears inside the video.' },
    { id: 'pingpong', name: 'Ping-pong', short: 'Forward, then backward', detail: 'Play to the end, then reverse back to the start. Each cycle is nearly twice as long as a forward pass, with no repeated turning-point frames. Available for MP4, WebM, and GIF.' },
    { id: 'smooth-pingpong', name: 'Smooth ping-pong', short: 'Forward and backward with eased turns', detail: 'Play forward and backward, slowing down at both turns. Each cycle is nearly twice as long as a forward pass. Available for MP4, WebM, and GIF.' },
    { id: 'fade', name: 'Fade through black', short: 'Hide the cut in darkness', detail: 'Fade to black at the tail and out of black at the head. The boundary is hidden by matching black frames. This creates a visible fade, rather than continuous motion.' },
];
export const DEFAULTS = {
    start: 0, end: 6, method: 'crossfade', transition: 0.5, curve: 'smooth', shift: 0,
    speed: 1, preset: 'spotify', aspect: '9:16', width: 576, height: 1024, fps: 30,
    fit: 'cover', zoom: 100, cropX: 50, cropY: 50, rotate: 0, mirror: false,
    background: '#000000', interpolate: false, audio: 'strip', format: 'mp4',
    quality: 'balanced', repeats: 1, targetMB: 0, gifLoop: true, layers: [],
    wallpaperDevice: 'notch', wallpaperPoster: 50, repair: null,
};
