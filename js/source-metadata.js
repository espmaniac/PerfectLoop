// Container duration may include an audio tail beyond the final video frame.
export function sourceMetadata(probe) {
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    const fps = [video?.avg_frame_rate, video?.r_frame_rate].map(rate => {
        const [numerator, denominator = 1] = (rate || '0/1').split('/').map(Number);
        return numerator / denominator;
    }).find(rate => Number.isFinite(rate) && rate > 0);
    const [tick, scale = 1] = (video?.time_base || '0/1').split('/').map(Number);
    const durations = [Number(video?.duration), Number(video?.duration_ts) * tick / scale,
        Number(video?.nb_frames) / fps, Number(probe.format?.duration)];
    const videoDuration = durations.find(duration => Number.isFinite(duration) && duration > 0);
    return { fps: Number.isFinite(fps) && fps > 0 ? fps : 30, videoDuration,
        hasAudio: probe.streams.some(stream => stream.codec_type === 'audio') };
}
