import { FFmpeg, FFFSType } from '../vendor/ffmpeg/index.js';
import { gunzipSync } from '../vendor/fflate.js';
import { audioGraph, framePlan, geometry, validate, videoGraph } from './logic.js';
import { rasterizeLayers, validateLayers } from './layers.js';
import { layerOverlayGraph } from './layer-export.js';
import { captureWallpaperStill } from './wallpaper-still.js';
import { wallpaperExportSettings } from './wallpaper.js';
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
    renderController;
    constructor() { this.listeners(); }
    listeners() {
        this.ff.on('log', ({ message }) => { this.logs.push(message); if (this.logs.length > 80)
            this.logs.shift(); });
        this.ff.on('progress', ({ time }) => this.currentProgress?.(Math.min(0.99, Math.max(0, time / 1_000_000 / this.stageDuration))));
    }
    cancel() {
        this.cancelled = true;
        this.renderController?.abort();
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
                const threaded = globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';
                const base = new URL(threaded ? '../vendor/ffmpeg-mt/' : '../vendor/ffmpeg/', import.meta.url);
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
                await requestedWorker.load({ coreURL: new URL('ffmpeg-core.js', base).href, wasmURL,
                    ...(threaded ? { workerURL: new URL('ffmpeg-core.worker.js', base).href } : {}) });
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
                if (!item.isDir && (/^(clip|cyclic|audio|result|proxy|probe|wallpaper|photo)\./.test(item.name) || /^layer-\d+\.png$/.test(item.name)))
                    await this.ff.deleteFile(item.name);
        }
        catch { /* terminated workers have no filesystem */ }
        // FFmpeg allocations are not reliably reclaimed by unlinking files. Recreate
        // the worker after each job so a series of exports has a bounded WASM heap.
        // The same-origin core assets are cached by the browser.
        this.resetWorker();
    }
    async render(file, original, info, onProgress, preview = false, wallpaperOptions = null) {
        const controller = new AbortController();
        this.renderController = controller;
        try {
            const result = await this.renderVideo(file, original, info, onProgress, preview, wallpaperOptions);
            if (controller.signal.aborted)
                throw new DOMException('Cancelled', 'AbortError');
            if (result.wallpaper) {
                // Release the WASM worker before decoding the key photo. Encoding
                // another full-size frame in FFmpeg can exhaust Safari's heap.
                onProgress(0.95, 'Preparing the wallpaper still frame…');
                result.wallpaper.jpeg = await captureWallpaperStill(result.blob, {
                    time: result.wallpaper.stillTime, fps: result.fps,
                    width: result.width, height: result.height,
                }, controller.signal);
            }
            if (controller.signal.aborted)
                throw new DOMException('Cancelled', 'AbortError');
            onProgress(1, 'Ready');
            return result;
        }
        finally {
            if (this.renderController === controller)
                this.renderController = undefined;
        }
    }
    async renderVideo(file, original, info, onProgress, preview = false, wallpaperOptions = null) {
        const livePhoto = Boolean(wallpaperOptions && wallpaperOptions.livePhoto !== false);
        const exportSettings = livePhoto ? wallpaperExportSettings(original) : original;
        const issues = [...validate(exportSettings, info), ...validateLayers(original.layers || [], original)];
        if (issues.length)
            throw new Error(issues[0]);
        if (wallpaperOptions && (preview || original.format !== 'mp4'))
            throw new Error('Live Photo preparation requires a full-resolution MP4 export.');
        if (livePhoto && (globalThis.crossOriginIsolated !== true || typeof SharedArrayBuffer === 'undefined'))
            throw new Error('This browser could not start Live Photo export. Open the site in a full browser tab and reload, or choose JPG or MP4.');
        this.cancelled = false;
        const requestedWorker = this.ff;
        const checkCancelled = () => {
            if (this.cancelled || requestedWorker !== this.ff)
                throw new DOMException('Cancelled', 'AbortError');
        };
        const ratio = preview ? Math.min(1, 360 / original.width, 640 / original.height) : 1;
        const s = preview ? { ...original, width: even(original.width * ratio), height: even(original.height * ratio), quality: 'small', format: 'mp4', audio: original.format === 'gif' ? 'strip' : original.audio, repeats: 1, targetMB: 0, interpolate: original.interpolate } : { ...exportSettings };
        const plan = framePlan(s);
        try {
            if (original.layers?.some(layer => layer.visible))
                onProgress(0, 'Preparing text and image layers…');
            const sprites = await rasterizeLayers(original.layers || [], s, original);
            checkCancelled();
            await this.load(onProgress);
            checkCancelled();
            const source = await this.mount(file);
            checkCancelled();
            const probe = await this.probe(source);
            checkCancelled();
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
            for (const [index, sprite] of sprites.entries()) {
                checkCancelled();
                // The worker transfers this buffer; keep the cached sprite reusable.
                await this.ff.writeFile(`layer-${index}.png`, sprite.png.slice());
            }
            checkCancelled();
            const overlay = layerOverlayGraph(s, sprites);
            const graph = [videoGraph(s), overlay.graph].filter(Boolean).join(';');
            await this.exec(['-i', 'clip.mp4', ...overlay.inputs, '-filter_complex', graph, '-map', `[${overlay.outputLabel}]`, '-an', ...codec, '-threads', '1', '-pix_fmt', 'yuv420p', '-frames:v', String(plan.outputFrames), '-r', String(s.fps), '-map_metadata', '-1', `cyclic.${ext}`], plan.duration, 0.35, 0.75, 'Building the loop and smoothing the transition…', onProgress);
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
                await this.exec(args, plan.totalDuration, 0.84, wallpaperOptions ? 0.9 : 0.98, hasAudio ? 'Finishing the file…' : 'Finishing the file without an audio track…', onProgress);
            }
            const output = await this.probe(result), video = output.streams.find(st => st.codec_type === 'video');
            checkCancelled();
            if (!video)
                throw new Error('The export did not contain a video stream.');
            const bytes = await this.ff.readFile(result);
            checkCancelled();
            if (!(bytes instanceof Uint8Array))
                throw new Error('The export could not be read.');
            const blob = new Blob([bytes.slice().buffer], { type: s.format === 'gif' ? 'image/gif' : s.format === 'mp4' ? 'video/mp4' : 'video/webm' });
            const duration = Number(output.format?.duration || video.duration || plan.totalDuration);
            const fps = numberRate(video.avg_frame_rate);
            let wallpaper;
            if (wallpaperOptions) {
                if (!Number.isFinite(duration) || duration <= 0)
                    throw new Error('The wallpaper video has no usable duration.');
                const percent = Number(wallpaperOptions.posterPercent ?? 50);
                if (!Number.isFinite(percent))
                    throw new Error('Choose a valid still frame position.');
                const frameCount = Number(video.nb_frames) || Math.floor(duration * fps + 0.000001);
                const lastFrame = Math.max(0, Math.min(frameCount - 1, Math.floor(duration * fps + 0.000001) - 1));
                const stillTime = Math.round(lastFrame * Math.max(0, Math.min(100, percent)) / 100) / fps;
                wallpaper = { stillTime };
                if (livePhoto) {
                    // Modern wallpaper converters use 8-bit HEVC at 60 fps. Keep a
                    // terminal moov so the pairing writer can append timed tracks.
                    // The single-thread core's x265 build hangs; this runs only in
                    // the isolated multithread core, with bounded encoder threads.
                    await this.exec(['-i', result, '-map', '0:v:0', '-an', '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', String(crf), '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-threads', '1', '-x265-params', 'pools=none:frame-threads=1:wpp=0:bframes=0:rc-lookahead=0:keyint=60:min-keyint=60:scenecut=0', '-r', String(s.fps), '-frames:v', String(frameCount), '-video_track_timescale', '60000', '-movie_timescale', '60000', '-map_metadata', '-1', '-f', 'mov', '-brand', 'qt  ', 'wallpaper.mov'], duration, 0.9, 0.95, 'Preparing the Live Photo video…', onProgress);
                    checkCancelled();
                    const pairedOutput = await this.probe('wallpaper.mov');
                    checkCancelled();
                    const pairedVideo = pairedOutput.streams.find(stream => stream.codec_type === 'video');
                    if (!pairedVideo || pairedVideo.codec_name !== 'hevc' || pairedVideo.codec_tag_string !== 'hvc1'
                        || pairedVideo.width !== video.width || pairedVideo.height !== video.height
                        || numberRate(pairedVideo.avg_frame_rate) !== s.fps || Number(pairedVideo.nb_frames) !== frameCount)
                        throw new Error('The Live Photo video could not be prepared. Try a shorter cycle.');
                    const mov = await this.ff.readFile('wallpaper.mov');
                    checkCancelled();
                    if (!(mov instanceof Uint8Array) || !mov.length)
                        throw new Error('The wallpaper files could not be read.');
                    wallpaper = { ...wallpaper, mov: new Blob([mov.slice().buffer], { type: 'video/quicktime' }),
                        codec: pairedVideo.codec_name, width: pairedVideo.width, height: pairedVideo.height,
                        fps: numberRate(pairedVideo.avg_frame_rate), frames: Number(pairedVideo.nb_frames),
                        duration: Number(pairedOutput.format?.duration || pairedVideo.duration || duration) };
                }
            }
            return { blob, name: `${file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '-').slice(0, 60) || 'video'}-${s.method}-loop.${s.format}`, duration, width: video.width || s.width, height: video.height || s.height, fps, frames: Number(video.nb_frames || plan.totalFrames), hasAudio: output.streams.some(st => st.codec_type === 'audio'), sourceFps: numberRate(probe.streams.find(st => st.codec_type === 'video')?.avg_frame_rate), ...(wallpaper ? { wallpaper } : {}) };
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
    async makePhotoVideo(file, onProgress, { motion = 'zoom' } = {}) {
        if (!['zoom', 'still'].includes(motion))
            throw new Error('Choose a supported photo movement.');
        this.cancelled = false;
        const requestedWorker = this.ff;
        const checkCancelled = () => {
            if (this.cancelled || requestedWorker !== this.ff)
                throw new DOMException('Cancelled', 'AbortError');
        };
        const duration = 2, fps = 30, frames = duration * fps;
        try {
            await this.load(onProgress);
            checkCancelled();
            const source = await this.mount(file);
            checkCancelled();
            const probe = await this.probe(source);
            checkCancelled();
            const image = probe.streams.find(stream => stream.codec_type === 'video');
            if (!image || !(image.width > 0) || !(image.height > 0))
                throw new Error('The photo could not be read. Choose a JPEG, PNG, or WebP image.');
            const scale = Math.min(1, 1920 / image.width, 1920 / image.height);
            const width = even(image.width * scale), height = even(image.height * scale);
            // Zoompan rounds crop coordinates to source pixels. A larger still
            // smooths that movement, and one input frame supplies the whole pulse.
            // Both ends use exactly 1× so the file boundary preserves the photo.
            const movement = motion === 'zoom'
                ? `scale=${width * 2}:${height * 2},zoompan=z='1+0.02*(1-cos(2*PI*on/${frames - 1}))':x='iw/2-iw/(2*zoom)':y='ih/2-ih/(2*zoom)':d=${frames}:s=${width}x${height}:fps=${fps}`
                : `scale=${width}:${height}`;
            await this.exec(['-loop', '1', '-framerate', String(fps), '-i', source, '-map', '0:v:0', '-an', '-vf', `${movement},setsar=1,format=yuv420p`, '-frames:v', String(frames), '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-map_metadata', '-1', '-movflags', '+faststart', 'photo.mp4'], duration, 0.05, 0.98, motion === 'zoom' ? 'Creating a gentle motion loop from your photo…' : 'Preparing your photo as a video…', onProgress);
            checkCancelled();
            const bytes = await this.ff.readFile('photo.mp4');
            checkCancelled();
            if (!(bytes instanceof Uint8Array) || !bytes.length)
                throw new Error('The photo video could not be read.');
            onProgress(1, 'Ready');
            return { blob: new Blob([bytes.slice().buffer], { type: 'video/mp4' }), name: `${file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '-').slice(0, 60) || 'photo'}-motion-source.mp4`, width, height, fps, duration, hasAudio: false };
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
