import { FFmpeg, FFFSType } from '../vendor/ffmpeg/index.js';
import { gunzipSync } from '../vendor/fflate.js';
import { audioGraph, framePlan, geometry, validate, videoGraph } from './logic.js';
const even = (n) => Math.max(16, Math.round(n / 2) * 2);
const numberRate = (rate) => { const [a, b = '1'] = (rate || '0').split('/'); return Number(a) / Number(b) || 30; };
export class VideoEngine {
    ff = new FFmpeg();
    loading;
    mounted = false;
    currentProgress;
    stageDuration = 1;
    cancelled = false;
    everLoaded = false;
    wasmPromise;
    logs = [];
    constructor() { this.listeners(); }
    listeners() {
        this.ff.on('log', ({ message }) => { this.logs.push(message); if (this.logs.length > 80)
            this.logs.shift(); });
        this.ff.on('progress', ({ time }) => this.currentProgress?.(Math.min(0.99, Math.max(0, time / 1_000_000 / this.stageDuration))));
    }
    cancel() {
        this.cancelled = true;
        this.resetWorker();
    }
    resetWorker() {
        this.ff.terminate();
        this.ff = new FFmpeg();
        this.loading = undefined;
        this.mounted = false;
        this.currentProgress = undefined;
        this.listeners();
    }
    async load(onProgress) {
        if (this.ff.loaded)
            return;
        const requestedWorker = this.ff;
        if (!this.loading)
            this.loading = (async () => {
                onProgress(0, this.everLoaded ? 'Starting the video engine…' : 'Loading the video engine for the first time…');
                const base = new URL('../vendor/ffmpeg/', import.meta.url);
                // Store the unmodified WASM core as gzip so every hosted file fits
                // GitHub's web uploader. The browser expands it once per page.
                if (!this.wasmPromise) this.wasmPromise = (async () => {
                    const response = await fetch(new URL('ffmpeg-core.wasm.gz', base));
                    if (!response.ok) throw new Error('The video engine could not be loaded. Check that all site files were uploaded.');
                    const compressed = new Uint8Array(await response.arrayBuffer());
                    let bytes;
                    if (typeof DecompressionStream !== 'undefined') {
                        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
                        bytes = await new Response(stream).arrayBuffer();
                    } else bytes = gunzipSync(compressed);
                    return URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
                })().catch(error => { this.wasmPromise = undefined; throw error; });
                const wasmURL = await this.wasmPromise;
                if (requestedWorker !== this.ff || this.cancelled) throw new DOMException('Cancelled', 'AbortError');
                await requestedWorker.load({ coreURL: new URL('ffmpeg-core.js', base).href, wasmURL });
                this.everLoaded = true;
            })();
        try {
            await this.loading;
        }
        catch (e) {
            this.loading = undefined;
            throw e;
        }
    }
    async mount(file) {
        if (this.mounted)
            await this.ff.unmount('/input');
        try {
            await this.ff.createDir('/input');
        }
        catch { /* directory already exists */ }
        const ext = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'mp4';
        const name = `source.${ext}`;
        this.mounted = await this.ff.mount(FFFSType.WORKERFS, { blobs: [{ name, data: file }] }, '/input');
        if (!this.mounted)
            throw new Error('This video engine cannot read local files. Restore the bundled engine files and retry.');
        return `/input/${name}`;
    }
    async probe(path) {
        this.logs = [];
        try {
            await this.ff.deleteFile('probe.json');
        }
        catch { /* no previous probe */ }
        // core 0.12.10 leaves ret=-1 after successful ffprobe. Validate its output,
        // rather than treating that stale exit field as a failed probe.
        await this.ff.ffprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path, '-o', 'probe.json']);
        try {
            const data = await this.ff.readFile('probe.json', 'utf8');
            const probe = JSON.parse(String(data));
            await this.ff.deleteFile('probe.json');
            if (!Array.isArray(probe.streams) || !probe.streams.length)
                throw new Error('No readable streams.');
            return probe;
        }
        catch {
            throw new Error(`Could not read the video metadata. ${this.logs.slice(-5).join(' ').slice(0, 350)}`);
        }
    }
    async exec(args, duration, from, to, message, onProgress) {
        if (this.cancelled)
            throw new DOMException('Cancelled', 'AbortError');
        this.stageDuration = Math.max(0.01, duration);
        this.currentProgress = p => onProgress(from + p * (to - from), message);
        onProgress(from, message);
        this.logs = [];
        let code;
        try {
            code = await this.ff.exec(['-hide_banner', '-y', '-threads', '1', '-filter_complex_threads', '1', ...args]);
        }
        catch (e) {
            if (this.cancelled)
                throw new DOMException('Cancelled', 'AbortError');
            throw new Error(`${message} Video processing failed. ${this.logs.slice(-8).join(' ').slice(-900) || String(e)}`);
        }
        if (code !== 0)
            throw new Error(`Video processing failed. ${this.logs.filter(l => /error|invalid|memory|not found|failed/i.test(l)).slice(-3).join(' ').slice(0, 400) || 'Try a smaller resolution or a different input codec.'}`);
        onProgress(to, message);
    }
    async cleanup() {
        this.currentProgress = undefined;
        if (!this.ff.loaded)
            return;
        if (this.mounted) {
            try {
                await this.ff.unmount('/input');
            }
            catch { /* cancelled */ }
            this.mounted = false;
        }
        try {
            for (const item of await this.ff.listDir('/'))
                if (!item.isDir && /^(clip|cyclic|audio|result|proxy|probe)\./.test(item.name))
                    await this.ff.deleteFile(item.name);
        }
        catch { /* terminated workers have no filesystem */ }
        // FFmpeg allocations are not reliably reclaimed by unlinking files. Recreate
        // the worker after each job so a series of exports has a bounded WASM heap.
        // The same-origin core assets are cached by the browser.
        this.resetWorker();
    }
    async render(file, original, info, onProgress, preview = false) {
        const issues = validate(original, info);
        if (issues.length)
            throw new Error(issues[0]);
        this.cancelled = false;
        const ratio = preview ? Math.min(1, 360 / original.width, 640 / original.height) : 1;
        const s = preview ? { ...original, width: even(original.width * ratio), height: even(original.height * ratio), quality: 'small', format: 'mp4', audio: original.format === 'gif' ? 'strip' : original.audio, repeats: 1, targetMB: 0, interpolate: original.interpolate } : { ...original };
        const plan = framePlan(s);
        try {
            await this.load(onProgress);
            const source = await this.mount(file);
            const probe = await this.probe(source);
            const hasAudio = probe.streams.some(st => st.codec_type === 'audio') && s.audio !== 'strip' && s.format !== 'gif';
            const rawDuration = s.end - s.start;
            const motion = s.interpolate ? `minterpolate=fps=${s.fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1` : `fps=${s.fps}:start_time=0`;
            const normalize = `${geometry(s)},setpts=(PTS-STARTPTS)/${s.speed},${motion},tpad=stop_mode=clone:stop_duration=${2 / s.fps},trim=end_frame=${plan.frames},setpts=PTS-STARTPTS,format=yuv420p`;
            await this.exec(['-ss', String(s.start), '-t', String(rawDuration), '-i', source, '-map', '0:v:0', '-an', '-vf', normalize, '-frames:v', String(plan.frames), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-map_metadata', '-1', 'clip.mp4'], plan.frames / s.fps, 0.04, 0.35, 'Preparing the selected frames…', onProgress);
            const ext = s.format === 'webm' ? 'webm' : 'mp4';
            const crf = s.format === 'gif' || s.quality === 'high' ? 18 : s.quality === 'small' ? 28 : 22;
            const webmRate = Math.max(200_000, Math.round(s.width * s.height * s.fps * (s.quality === 'high' ? 0.18 : s.quality === 'small' ? 0.08 : 0.12)));
            // The bundled single-thread core can throw an unhandled longjmp in VP9.
            // VP8 is reliable on ordinary static hosts and needs no extra headers.
            const codec = ext === 'webm' ? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '6', '-crf', String(crf + 8), '-b:v', String(webmRate), '-lag-in-frames', '0'] : ['-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'veryfast', '-crf', String(crf)];
            if (s.format !== 'gif' && s.targetMB > 0) {
                const bitrate = Math.max(48_000, Math.floor(s.targetMB * 1024 ** 2 * 8 * 0.93 / plan.totalDuration) - (hasAudio ? 128_000 : 0));
                codec.push('-b:v', String(bitrate), '-maxrate', String(Math.round(bitrate * 1.25)), '-bufsize', String(bitrate * 2));
            }
            await this.exec(['-i', 'clip.mp4', '-filter_complex', videoGraph(s), '-map', '[outv]', '-an', ...codec, '-threads', '1', '-pix_fmt', 'yuv420p', '-frames:v', String(plan.outputFrames), '-r', String(s.fps), '-map_metadata', '-1', `cyclic.${ext}`], plan.duration, 0.35, 0.75, 'Building the loop and smoothing the transition…', onProgress);
            if (hasAudio)
                await this.exec(['-ss', String(s.start), '-t', String(rawDuration), '-i', source, '-filter_complex', audioGraph(s), '-map', '[aout]', '-vn', '-ar', '48000', '-c:a', 'pcm_s16le', '-t', String(plan.duration), 'audio.wav'], plan.duration, 0.75, 0.84, 'Preparing the audio timeline…', onProgress);
            const result = `result.${s.format}`;
            if (s.format === 'gif') {
                await this.exec(['-i', `cyclic.${ext}`, '-filter_complex', '[0:v]split[g1][g2];[g1]palettegen=stats_mode=diff[pal];[g2][pal]paletteuse=dither=sierra2_4a', '-an', '-loop', s.gifLoop === false ? '-1' : '0', '-frames:v', String(plan.totalFrames), '-t', String(plan.totalDuration), result], plan.totalDuration, 0.84, 0.98, 'Encoding the animated GIF…', onProgress);
            }
            else {
                const args = ['-stream_loop', String(s.repeats - 1), '-i', `cyclic.${ext}`];
                if (hasAudio)
                    args.push('-stream_loop', String(s.repeats - 1), '-i', 'audio.wav');
                args.push('-map', '0:v:0', '-c:v', 'copy');
                if (hasAudio)
                    args.push('-map', '1:a:0', '-c:a', ext === 'webm' ? 'libopus' : 'aac', '-b:a', '128k');
                else
                    args.push('-an');
                if (ext === 'mp4')
                    args.push('-movflags', '+faststart');
                args.push('-t', String(plan.totalDuration), '-map_metadata', '-1', result);
                await this.exec(args, plan.totalDuration, 0.84, 0.98, hasAudio ? 'Finishing the file…' : 'Finishing the file without an audio track…', onProgress);
            }
            const output = await this.probe(result), video = output.streams.find(st => st.codec_type === 'video');
            if (!video)
                throw new Error('The export did not contain a video stream.');
            const bytes = await this.ff.readFile(result);
            if (!(bytes instanceof Uint8Array))
                throw new Error('The export could not be read.');
            const blob = new Blob([bytes.slice().buffer], { type: s.format === 'gif' ? 'image/gif' : s.format === 'mp4' ? 'video/mp4' : 'video/webm' });
            onProgress(1, 'Ready');
            return { blob, name: `${file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '-').slice(0, 60) || 'video'}-${s.method}-loop.${s.format}`, duration: Number(output.format?.duration || video.duration || plan.totalDuration), width: video.width || s.width, height: video.height || s.height, fps: numberRate(video.avg_frame_rate), frames: Number(video.nb_frames || plan.totalFrames), hasAudio: output.streams.some(st => st.codec_type === 'audio'), sourceFps: numberRate(probe.streams.find(st => st.codec_type === 'video')?.avg_frame_rate) };
        }
        catch (e) {
            if (this.cancelled)
                throw new DOMException('Cancelled', 'AbortError');
            throw e;
        }
        finally {
            await this.cleanup();
        }
    }
    async inspect(file, onProgress) {
        this.cancelled = false;
        try {
            await this.load(onProgress);
            const source = await this.mount(file), probe = await this.probe(source);
            return { fps: numberRate(probe.streams.find(st => st.codec_type === 'video')?.avg_frame_rate), hasAudio: probe.streams.some(st => st.codec_type === 'audio') };
        }
        catch (e) {
            if (this.cancelled)
                throw new DOMException('Cancelled', 'AbortError');
            throw e;
        }
        finally {
            await this.cleanup();
        }
    }
    async makeProxy(file, onProgress) {
        this.cancelled = false;
        try {
            await this.load(onProgress);
            const source = await this.mount(file), probe = await this.probe(source);
            await this.exec(['-i', source, '-map', '0:v:0', '-an', '-vf', "scale='min(640,iw)':-2", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'proxy.mp4'], Number(probe.format?.duration || 1), 0.05, 0.98, 'Creating a playable proxy. The original file will still be used for export…', onProgress);
            const bytes = await this.ff.readFile('proxy.mp4');
            if (!(bytes instanceof Uint8Array))
                throw new Error('Could not read the proxy.');
            return { blob: new Blob([bytes.slice().buffer], { type: 'video/mp4' }), probe };
        }
        catch (e) {
            if (this.cancelled)
                throw new DOMException('Cancelled', 'AbortError');
            throw e;
        }
        finally {
            await this.cleanup();
        }
    }
}
