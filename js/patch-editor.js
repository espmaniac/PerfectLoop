import { extractPatch } from './patch.js';

// A modal freezes the chosen source frame and prevents changes to its framing
// while a selection is drawn. No user media leaves the browser.
export function selectPatch(frame, sourceTime) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'patch-dialog';
        dialog.innerHTML = `<div class="help-head"><h2>Create patch</h2><button class="btn secondary" data-patch="cancel">Cancel</button></div>
          <p class="micro">Source frame at ${sourceTime.toFixed(3)}s, before layers and loop effects. Close this window to choose another frame on the timeline.</p>
          <div class="patch-toolbar"><label class="field"><span>Selection tool</span><select aria-label="Selection tool"><option value="rectangle">Rectangle</option><option value="lasso">Lasso</option><option value="polygon">Polygonal lasso</option></select></label>
          <label class="field"><span>Feather (output pixels)</span><input aria-label="Feather" type="number" min="0" max="30" value="2"></label>
          <button class="btn secondary" data-patch="clear">Clear selection</button><button class="btn secondary" data-patch="close">Close polygon</button></div>
          <p class="micro">Rectangle or lasso: drag to select. Polygon: click corners, then Close polygon. Escape cancels.</p>
          <label class="patch-zoom">Selection zoom <input type="range" aria-label="Selection zoom" min="100" max="400" step="25" value="100"><output>100%</output></label><div class="patch-viewport"><canvas class="patch-canvas" aria-label="Draw patch selection"></canvas></div><p class="micro" role="status"></p>
          <div class="patch-footer"><p class="micro">The patch stays at the same position. Set its active time in Layers after creating it. Moving subjects need manual repositioning; there is no tracking.</p><button class="btn primary" data-patch="create" disabled>Create patch</button></div>`;
        document.body.append(dialog);
        const canvas = dialog.querySelector('canvas'), ctx = canvas.getContext('2d');
        canvas.width = frame.width; canvas.height = frame.height;
        const tool = dialog.querySelector('select'), feather = dialog.querySelector('input'), create = dialog.querySelector('[data-patch=create]'), status = dialog.querySelector('[role=status]');
        let points = [], drawing = false, closed = false, creating = false, anchor, result = null;
        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(frame, 0, 0);
            if (points.length) {
                ctx.beginPath(); points.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y)); if (closed) ctx.closePath();
                const scale = frame.width / Math.max(1, canvas.getBoundingClientRect().width);
                ctx.lineWidth = 3 * scale; ctx.strokeStyle = '#111111'; ctx.setLineDash([]); ctx.stroke();
                ctx.lineWidth = scale; ctx.strokeStyle = '#ffffff'; ctx.setLineDash([5 * scale, 4 * scale]); ctx.stroke(); ctx.setLineDash([]);
            }
            create.disabled = creating || !closed || points.length < 3;
            dialog.querySelector('[data-patch=close]').disabled = tool.value !== 'polygon' || points.length < 3 || closed;
        }
        const point = e => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(frame.width, (e.clientX - r.left) / r.width * frame.width)), y: Math.max(0, Math.min(frame.height, (e.clientY - r.top) / r.height * frame.height)) }; };
        const clear = () => { points = []; closed = false; drawing = false; status.textContent = ''; draw(); };
        canvas.addEventListener('pointerdown', e => {
            if (e.button !== 0 || drawing || creating) return; e.preventDefault();
            const p = point(e);
            if (tool.value === 'polygon') { if (closed) clear(); if (points.length < 2000) points.push(p); draw(); return; }
            clear(); anchor = p; points = [p]; drawing = true; canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', e => {
            if (!drawing || creating) return; const p = point(e);
            if (tool.value === 'rectangle') points = [anchor, { x: p.x, y: anchor.y }, p, { x: anchor.x, y: p.y }];
            else if (points.length < 2000 && Math.hypot(p.x - points.at(-1).x, p.y - points.at(-1).y) >= 1) points.push(p);
            draw();
        });
        canvas.addEventListener('pointerup', e => { if (!drawing) return; drawing = false; closed = points.length >= 3; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); draw(); });
        canvas.addEventListener('pointercancel', clear);
        tool.addEventListener('change', clear);
        const viewport = dialog.querySelector('.patch-viewport'), zoom = dialog.querySelector('[aria-label="Selection zoom"]');
        const layout = () => {
            const scale = Math.min(viewport.clientWidth / frame.width, viewport.clientHeight / frame.height) * Number(zoom.value) / 100;
            canvas.style.width = `${frame.width * scale}px`; canvas.style.height = `${frame.height * scale}px`;
            dialog.querySelector('output').textContent = `${zoom.value}%`; draw();
        };
        zoom.addEventListener('input', layout);
        const resize = new ResizeObserver(layout); resize.observe(viewport);
        dialog.addEventListener('click', async e => {
            const action = e.target.closest('[data-patch]')?.dataset.patch;
            if (action === 'cancel') { dialog.close(); return; }
            if (creating) return;
            if (action === 'clear') clear();
            if (action === 'close') { closed = points.length >= 3; draw(); }
            if (action === 'create') {
                try {
                    const value = Number(feather.value);
                    if (!Number.isFinite(value) || value < 0 || value > 30) throw new Error('Feather must be between 0 and 30 pixels.');
                    const patch = extractPatch(frame, points, value);
                    creating = true; create.disabled = true;
                    dialog.querySelectorAll('input, select, [data-patch=clear], [data-patch=close]').forEach(input => { input.disabled = true; });
                    const blob = await new Promise(done => patch.canvas.toBlob(done, 'image/png'));
                    if (!blob) throw new Error('The patch could not be created. Try a smaller selection.');
                    if (!dialog.open) return;
                    result = { blob, bounds: patch.bounds, feather: value }; dialog.close();
                } catch (error) {
                    creating = false;
                    dialog.querySelectorAll('input, select, [data-patch=clear]').forEach(input => { input.disabled = false; });
                    status.textContent = error.message; draw();
                }
            }
        });
        dialog.addEventListener('close', () => { resize.disconnect(); dialog.remove(); resolve(result); }, { once: true });
        dialog.showModal(); layout();
    });
}
