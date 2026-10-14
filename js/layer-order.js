// Rendering stores overlays back to front; the source video sits between groups.
export const VIDEO_LAYER = Object.freeze({ id: 'video' });
export function layerStack(layers) {
    return [...layers.filter(layer => layer.placement === 'below'), VIDEO_LAYER,
        ...layers.filter(layer => layer.placement !== 'below')];
}

export function moveLayerInStack(layers, id, direction) {
    const stack = layerStack(layers);
    const index = stack.findIndex(layer => layer.id === id);
    const step = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
    const target = index + step;
    if (index < 0 || !step || target < 0 || target >= stack.length) return layers;
    [stack[index], stack[target]] = [stack[target], stack[index]];
    const videoIndex = stack.indexOf(VIDEO_LAYER);
    return stack.flatMap((layer, position) => {
        if (layer === VIDEO_LAYER) return [];
        const placement = position < videoIndex ? 'below' : 'above';
        return [(layer.placement || 'above') === placement ? layer : { ...layer, placement }];
    });
}
