export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const seconds = (n) => Math.max(0, n).toFixed(3);
export function timecode(n) {
    const ms = Math.round(Math.max(0, n) * 1000);
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`;
}
export const humanSize = (n) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
export function framePlan(s) {
    const frames = Math.max(2, Math.floor((s.end - s.start) / s.speed * s.fps + 1e-7));
    const overlap = clamp(Math.round(s.transition * s.fps), 2, Math.max(2, Math.floor((frames - 1) / 2)));
    const blended = s.method === 'crossfade' || s.method === 'offset';
    const rebound = s.method === 'pingpong' || s.method === 'smooth-pingpong';
    const outputFrames = rebound ? 2 * frames - 2 : blended ? frames - overlap : frames;
    const repeats = s.format === 'gif' ? 1 : s.repeats;
    const totalFrames = outputFrames * repeats;
    return { frames, overlap, outputFrames, totalFrames, duration: outputFrames / s.fps, totalDuration: outputFrames / s.fps * repeats };
}
export function validate(s, info) {
    const issues = [];
    const numericOptions = ['start', 'end', 'speed', 'transition', 'shift', 'width', 'height', 'fps', 'cropX', 'cropY', 'rotate'];
    if (s.format !== 'gif')
        numericOptions.push('repeats', 'targetMB');
    for (const k of numericOptions) {
        if (!Number.isFinite(s[k]))
            issues.push(`Invalid ${k} value.`);
    }
    if (s.start < 0 || s.end > info.duration + 0.002 || s.end <= s.start)
        issues.push('Choose a valid start and end inside the source video.');
    if (s.end - s.start < 3 / s.fps * s.speed)
        issues.push('Select at least three output frames.');
    if (s.speed < 0.25 || s.speed > 4)
        issues.push('Playback speed must be between 0.25× and 4×.');
    if (s.fps < 1 || s.fps > 60 || !Number.isInteger(s.fps))
        issues.push('Frame rate must be a whole number between 1 and 60.');
    if (s.width < 16 || s.height < 16 || s.width > 3840 || s.height > 3840 || s.width % 2 || s.height % 2)
        issues.push('Use even dimensions between 16 and 3840 pixels.');
    if (s.format !== 'gif' && (s.repeats < 1 || s.repeats > 50 || !Number.isInteger(s.repeats)))
        issues.push('Cycles in video must be a whole number between 1 and 50.');
    if (s.transition < 0.01 || s.transition > 30)
        issues.push('Transition must be between 0.01 and 30 seconds.');
    if (s.format !== 'gif' && (s.targetMB < 0 || s.targetMB > 2000))
        issues.push('Target size must be between 0 and 2000 MB.');
    if (s.cropX < 0 || s.cropX > 100 || s.cropY < 0 || s.cropY > 100 || s.shift < 0 || s.shift > 99)
        issues.push('Crop and seam positions are outside their allowed ranges.');
    if (![0, 90, 180, 270].includes(s.rotate))
        issues.push('Rotation must be 0, 90, 180, or 270 degrees.');
    if (!/^#[0-9a-f]{6}$/i.test(s.background))
        issues.push('Choose a valid background color.');
    const p = framePlan(s);
    if ((s.method === 'crossfade' || s.method === 'offset') && p.frames < 5)
        issues.push('Crossfade needs at least five output frames.');
    if (s.preset === 'spotify') {
        if (p.totalDuration < 3 - 1e-6 || p.totalDuration > 8 + 1e-6)
            issues.push('Spotify Canvas must be 3–8 seconds after processing and repeats.');
        if (s.width * 16 !== s.height * 9 || s.height < 720 || s.height > 1080)
            issues.push('Spotify Canvas needs exact 9:16 dimensions and a height of 720–1080 px.');
        if (s.format !== 'mp4')
            issues.push('Use MP4 for Spotify Canvas.');
    }
    if ((s.method === 'pingpong' || s.method === 'smooth-pingpong') && p.frames * s.width * s.height * 1.5 > 900 * 1024 ** 2)
        issues.push('Ping-pong would use too much memory. Shorten the range or lower the resolution/frame rate.');
    return [...new Set(issues)];
}
export function geometry(s) {
    const f = [];
    if (s.rotate === 90)
        f.push('transpose=1');
    if (s.rotate === 180)
        f.push('hflip', 'vflip');
    if (s.rotate === 270)
        f.push('transpose=2');
    if (s.mirror)
        f.push('hflip');
    if (s.fit === 'cover')
        f.push(`scale=${s.width}:${s.height}:force_original_aspect_ratio=increase`, `crop=${s.width}:${s.height}:(iw-ow)*${s.cropX / 100}:(ih-oh)*${s.cropY / 100}`);
    else if (s.fit === 'contain')
        f.push(`scale=${s.width}:${s.height}:force_original_aspect_ratio=decrease`, `pad=${s.width}:${s.height}:(ow-iw)/2:(oh-ih)/2:color=0x${s.background.slice(1)}`);
    else
        f.push(`scale=${s.width}:${s.height}`);
    f.push('setsar=1');
    return f.join(',');
}
function blendWeight(s, overlap) {
    const u = `(N-1)/${overlap - 1}`;
    return s.curve === 'smooth' ? `(${u})*(${u})*(3-2*(${u}))` : s.curve === 'cosine' ? `(1-cos(PI*(${u})))/2` : u;
}
export function videoGraph(s) {
    const { frames: n, overlap: k, outputFrames } = framePlan(s);
    const pieces = [];
    let input = '0:v';
    if (s.method === 'smooth-pingpong') {
        // FPS resampling can discard the final eased frame at EOF. Preserve the
        // original turning point explicitly instead of cloning the previous frame.
        pieces.push(`[${input}]split[ease-input][turn-input]`, `[ease-input]setpts='acos(1-2*N/${n - 1})*${n - 1}/${s.fps}/PI/TB',fps=${s.fps},tpad=stop_mode=clone:stop_duration=${2 / s.fps},trim=end_frame=${n - 1},setpts=PTS-STARTPTS[eased-body]`, `[turn-input]trim=start_frame=${n - 1}:end_frame=${n},setpts=PTS-STARTPTS[eased-turn]`, '[eased-body][eased-turn]concat=n=2:v=1:a=0[eased]');
        input = 'eased';
    }
    if (s.method === 'crossfade' || s.method === 'offset') {
        const w = blendWeight(s, k);
        pieces.push(`[${input}]split=3[m][t][h]`, `[m]trim=start_frame=${k}:end_frame=${n - k},setpts=PTS-STARTPTS[mid]`, `[t]trim=start_frame=${n - k}:end_frame=${n},setpts=PTS-STARTPTS[tail]`, `[h]trim=end_frame=${k},setpts=PTS-STARTPTS[head]`, `[tail][head]blend=all_expr='A*(1-(${w}))+B*(${w})':shortest=1[blend]`, '[mid][blend]concat=n=2:v=1:a=0[cyclic]');
    }
    else if (s.method === 'pingpong' || s.method === 'smooth-pingpong') {
        pieces.push(`[${input}]split[f][r]`, `[r]reverse,trim=start_frame=1:end_frame=${n - 1},setpts=PTS-STARTPTS[rev]`, '[f][rev]concat=n=2:v=1:a=0[cyclic]');
    }
    else if (s.method === 'fade') {
        const fadeFrames = Math.min(k, Math.floor(n / 2));
        pieces.push(`[${input}]fade=t=in:s=0:n=${fadeFrames - 1},fade=t=out:s=${n - fadeFrames}:n=${fadeFrames - 1}[cyclic]`);
    }
    else
        pieces.push(`[${input}]null[cyclic]`);
    const shift = Math.round(outputFrames * s.shift / 100);
    if (shift > 0 && shift < outputFrames)
        pieces.push('[cyclic]split[x][y]', `[x]trim=start_frame=${shift},setpts=PTS-STARTPTS[later]`, `[y]trim=end_frame=${shift},setpts=PTS-STARTPTS[earlier]`, '[later][earlier]concat=n=2:v=1:a=0[outv]');
    else
        pieces.push('[cyclic]null[outv]');
    return pieces.join(';');
}
export function tempo(speed) {
    const f = [];
    while (speed < 0.5) {
        f.push('atempo=0.5');
        speed /= 0.5;
    }
    while (speed > 2) {
        f.push('atempo=2');
        speed /= 2;
    }
    f.push(`atempo=${speed}`);
    return f.join(',');
}
export function audioGraph(s) {
    const { frames: n, overlap: k, duration, outputFrames } = framePlan(s);
    const t = n / s.fps, d = k / s.fps;
    const parts = [`[0:a]${tempo(s.speed)},apad,atrim=duration=${t},asetpts=PTS-STARTPTS[a]`];
    if (s.method === 'crossfade' || s.method === 'offset') {
        parts.push('[a]asplit=3[am][at][ah]', `[am]atrim=start=${d}:end=${t - d},asetpts=PTS-STARTPTS[amid]`, `[at]atrim=start=${t - d}:end=${t},asetpts=PTS-STARTPTS[atail]`, `[ah]atrim=end=${d},asetpts=PTS-STARTPTS[ahead]`, `[atail][ahead]acrossfade=d=${d}:c1=tri:c2=tri[ablend]`, '[amid][ablend]concat=n=2:v=0:a=1[acyclic]');
    }
    else if (s.method === 'pingpong' || s.method === 'smooth-pingpong') {
        // Pitch-preserving audio cannot follow the nonlinear video easing. Keep a linear rebound timeline.
        parts.push('[a]asplit[af][ar]', `[ar]areverse,atrim=start=${1 / s.fps}:end=${t - 1 / s.fps},asetpts=PTS-STARTPTS[arev]`, '[af][arev]concat=n=2:v=0:a=1[acyclic]');
    }
    else if (s.audio === 'smooth' || s.method === 'fade') {
        const a = Math.min(s.transition, duration / 4);
        parts.push(`[a]afade=t=in:d=${a},afade=t=out:st=${duration - a}:d=${a}[acyclic]`);
    }
    else
        parts.push('[a]anull[acyclic]');
    const shift = Math.round(outputFrames * s.shift / 100) / s.fps;
    if (shift > 0 && shift < duration)
        parts.push('[acyclic]asplit[ax][ay]', `[ax]atrim=start=${shift},asetpts=PTS-STARTPTS[alater]`, `[ay]atrim=end=${shift},asetpts=PTS-STARTPTS[aearlier]`, '[alater][aearlier]concat=n=2:v=0:a=1[aout]');
    else
        parts.push('[acyclic]anull[aout]');
    return parts.join(';');
}
export function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
