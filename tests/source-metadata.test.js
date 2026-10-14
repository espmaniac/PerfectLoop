import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceMetadata } from '../js/source-metadata.js';

test('Source metadata uses the video duration instead of a longer audio/container duration',()=>{
    const probe={streams:[{codec_type:'video',avg_frame_rate:'24/1',duration:'8.000',nb_frames:'192'},
        {codec_type:'audio',duration:'8.107'}],format:{duration:'8.107'}};
    assert.deepEqual(sourceMetadata(probe),{fps:24,videoDuration:8,hasAudio:true});
});

test('Video duration falls back to timestamps, then frame count, then container metadata',()=>{
    const video={codec_type:'video',avg_frame_rate:'24/1'};
    assert.equal(sourceMetadata({streams:[{...video,duration_ts:'192000',time_base:'1/24000'}]}).videoDuration,8);
    assert.equal(sourceMetadata({streams:[{...video,nb_frames:'192'}]}).videoDuration,8);
    assert.equal(sourceMetadata({streams:[video],format:{duration:'9'}}).videoDuration,9);
    assert.equal(sourceMetadata({streams:[video]}).videoDuration,undefined);
});


test('An unavailable average rate uses the valid nominal rate',()=>{
    assert.deepEqual(sourceMetadata({streams:[{codec_type:'video',avg_frame_rate:'0/0',r_frame_rate:'24/1',nb_frames:'192'}]}),{fps:24,videoDuration:8,hasAudio:false});
});
