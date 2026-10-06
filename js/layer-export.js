import { framePlan } from './logic.js';
import { angleTrajectory, animationCycles, layerRotation } from './layers.js';

// Static PNG sprites contain rotation and opacity; spinning sprites contain
// opacity and a square safe for every angle. Composite after the video method
// so movement and rotation follow one complete output cycle.
export function layerOverlayGraph(settings, sprites, inputLabel = 'outv', outputLabel = 'layered') {
    if (!sprites.length)
        return { graph: '', inputs: [], outputLabel: inputLabel };
    const duration = framePlan(settings).duration;
    const cycleTime = `mod(t,${duration})`;
    const phase = cycles => {
        const raw = `${cycles}*${cycleTime}/${duration}`;
        const nearest = `floor(${raw}+0.5)`;
        // Snap pass/turn boundaries, then remove whole cycles so repeated
        // positions and angles use exactly the same coefficients as frame zero.
        return `mod(if(lt(abs(${raw}-${nearest}),0.000000000001),${nearest},${raw}),1)`;
    };
    const inputs = [], pieces = [`[${inputLabel}]format=rgba[layer-base]`];
    let previous = 'layer-base';
    sprites.forEach((sprite, index) => {
        inputs.push('-loop', '1', '-framerate', String(settings.fps), '-i', `layer-${index}.png`);
        const { layer, width, height } = sprite;
        const motionPhase = phase(animationCycles(layer, 'motion'));
        const spinPhase = phase(animationCycles(layer, 'spin'));
        const trajectory = angleTrajectory(layer, settings.width, settings.height, width, height);
        const horizontal = layer.motion === 'left' || layer.motion === 'right';
        const vertical = layer.motion === 'up' || layer.motion === 'down';
        const animated = horizontal || vertical;
        // Include every periodic copy that can intersect the frame, even when a
        // long text line or a rotated image is wider than the video itself.
        const radius = horizontal ? Math.max(1, Math.ceil(width / (2 * settings.width))) : vertical ? Math.max(1, Math.ceil(height / (2 * settings.height))) : 0;
        const copies = Array.from({ length: 2 * radius + 1 }, (_, copy) => copy - radius);
        const labels = copies.map((_, copy) => `layer-${index}-${copy}`);
        const spinDirection = layer.spin === 'clockwise' ? 1 : layer.spin === 'counterclockwise' ? -1 : 0;
        const rotation = spinDirection ? `,rotate=angle='${layerRotation(layer, 0, duration) * Math.PI / 180}+(${spinDirection})*2*PI*${spinPhase}':ow=iw:oh=ih:c=none` : '';
        pieces.push(`[${index + 1}:v]format=rgba${rotation}${animated ? `,split=${copies.length}` : ''}${labels.map(label => `[${label}]`).join('')}`);
        const centerX = layer.x / 100 * settings.width;
        const centerY = layer.y / 100 * settings.height;
        const sign = layer.motion === 'left' || layer.motion === 'up' ? -1 : 1;
        const move = (center, size, half) => `floor(mod(mod(${center}+${sign}*${size}*${motionPhase},${size})+${size},${size})-${half}+0.5)`;
        // Travel along the rotated layer's local axis, then re-enter only after
        // its complete sprite has left the frame. This keeps diagonal motion
        // straight rather than wrapping its two coordinates independently.
        const displacement = trajectory ? `(${trajectory.min}+mod(mod(-(${trajectory.min})+${trajectory.distance}*${motionPhase},${trajectory.distance})+${trajectory.distance},${trajectory.distance}))` : '';
        copies.forEach((copy, copyIndex) => {
            const x = trajectory ? `floor(${trajectory.x}+(${trajectory.dx})*${displacement}-${width / 2}+0.5)` : horizontal ? `${move(centerX, settings.width, width / 2)}+${copy * settings.width}` : String(Math.round(centerX - width / 2));
            const y = trajectory ? `floor(${trajectory.y}+(${trajectory.dy})*${displacement}-${height / 2}+0.5)` : vertical ? `${move(centerY, settings.height, height / 2)}+${copy * settings.height}` : String(Math.round(centerY - height / 2));
            const next = `layer-composite-${index}-${copyIndex}`;
            pieces.push(`[${previous}][${labels[copyIndex]}]overlay=x='${x}':y='${y}':eval=frame:shortest=1:format=auto:alpha=straight[${next}]`);
            previous = next;
        });
    });
    pieces.push(`[${previous}]format=yuv420p[${outputLabel}]`);
    return { graph: pieces.join(';'), inputs, outputLabel };
}
