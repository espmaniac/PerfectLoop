import { icon } from './ui.js';
// Review is non-destructive; temporary URLs are released on every close path.
export function reviewAutoRepair(report) {
    return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.className='help-dialog auto-repair-dialog';
        dialog.innerHTML=`<div class="help-head"><h2>Auto repair review</h2><button class="btn secondary" data-review="cancel">${icon('Undo2', 16)}<span>Keep original</span></button></div>
          <p data-review-message></p><p class="micro" data-review-summary></p>
          <div class="auto-repair-comparison"><figure><figcaption>Before</figcaption><div class="auto-repair-stage"><video controls muted playsinline loop aria-label="Before repair"></video><div class="auto-repair-region" hidden aria-hidden="true"></div></div></figure>
          <figure data-after><figcaption>After · proposed repair</figcaption><div class="auto-repair-stage"><video controls muted playsinline loop aria-label="After repair"></video></div></figure></div>
          <p class="micro">The outline marks the detected mismatch region, not an object selection. Checks estimate boundary continuity and detail; they cannot guarantee artifact-free motion.</p>
          <details><summary>What was tested</summary><ul data-review-trials></ul></details>
          <div class="auto-repair-actions"><button class="btn secondary" data-review="play">${icon('Play', 16)}<span data-review-play-label>Play both from the seam</span></button><button class="btn primary" data-review="apply">${icon('Check', 16)}<span>Apply repair</span></button></div>`;
        const urls=[],videos=[...dialog.querySelectorAll('video')];let apply=false;
        const attach=(video,result)=>{const url=URL.createObjectURL(result.blob);urls.push(url);video.src=url;video.muted=true;};
        attach(videos[0],report.before);
        if(report.best)attach(videos[1],report.best.result);
        else dialog.querySelector('[data-after]').hidden=true;
        dialog.querySelector('[data-review-message]').textContent=report.message;
        dialog.querySelector('[data-review-summary]').textContent=report.best
            ? `${report.best.label} · sampled seam error reduced by ${Math.round(report.best.improvement*100)}%. Cycle: ${report.before.duration.toFixed(3)}s → ${report.best.result.duration.toFixed(3)}s. Changes remain editable; Undo restores the previous settings.`
            : report.region ? 'No changes applied. Use the highlighted region as a guide for a manual patch.' : 'No changes applied. Try another range or inspect the seam manually.';
        const region=report.region,box=dialog.querySelector('.auto-repair-region');
        if(region){box.hidden=false;Object.assign(box.style,{left:`${region.x*100}%`,top:`${region.y*100}%`,width:`${region.width*100}%`,height:`${region.height*100}%`});}
        for(const trial of report.trials){const li=document.createElement('li');li.textContent=`${trial.label}: ${trial.accepted?'passed sampled checks':trial.reasons.join(' ')}`;dialog.querySelector('[data-review-trials]').append(li);}
        dialog.querySelector('[data-review=apply]').disabled=!report.best;
        dialog.querySelector('[data-review-play-label]').textContent=report.best?'Play both from the seam':'Play original from the seam';
        dialog.addEventListener('click',event=>{
            const action=event.target.closest('[data-review]')?.dataset.review;
            if(action==='play')for(const video of videos.filter(v=>v.src)){
                video.currentTime=Math.max(0,(Number.isFinite(video.duration)?video.duration:0)-.7);
                video.play().catch(()=>{});
            }
            if(action==='apply'&&report.best){apply=true;dialog.close();}
            if(action==='cancel')dialog.close();
        });
        dialog.addEventListener('close',()=>{
            videos.forEach(video=>{video.pause();video.removeAttribute('src');video.load();});urls.forEach(url=>URL.revokeObjectURL(url));
            dialog.remove();resolve(apply);
        },{once:true});
        document.body.append(dialog);dialog.showModal();
    });
}
