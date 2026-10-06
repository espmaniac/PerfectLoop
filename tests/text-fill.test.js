import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveFill, validateFill, gradientGeometry, textPaint, fillCacheKey } from '../js/text-fill.js';

const stops = () => [{ color: '#ff0000', opacity: 100, position: 0 }, { color: '#0000ff', opacity: 100, position: 100 }];
const linear = () => ({ type: 'linear', angle: 37, stops: stops() });
const radial = () => ({ type: 'radial', centerX: 50, centerY: 50, radius: 100, stops: stops() });
const conic = () => ({ type: 'conic', angle: 37, centerX: 50, centerY: 50, stops: stops() });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
const rgba = css => css.match(/[\d.]+/g).map(Number);

function context() {
    const calls = [], additions = [];
    const paint = { addColorStop(position, color) { additions.push([position, rgba(color)]); } };
    const ctx = {};
    for (const type of ['Linear', 'Radial', 'Conic'])
        ctx[`create${type}Gradient`] = (...args) => { calls.push({ type: type.toLowerCase(), args }); return paint; };
    return { ctx, paint, calls, additions };
}

test('Legacy text colors keep their original solid paint and explicit fills take precedence without mutation', () => {
    const layer = Object.freeze({ color: '#AbCdEf', opacity: 25 });
    assert.deepEqual(effectiveFill(layer), { type: 'solid', color: '#AbCdEf', opacity: 100 });
    assert.deepEqual(rgba(textPaint({}, effectiveFill(layer), 320, 180)), [171, 205, 239, 1], 'Layer opacity remains separate from paint opacity');
    const fill = Object.freeze({ type: 'solid', color: '#0080ff', opacity: 40 });
    assert.equal(effectiveFill({ color: '#ff0000', fill }), fill);
    assert.deepEqual(rgba(textPaint({}, fill, 320, 180)), [0, 128, 255, 0.4]);
    assert.equal(effectiveFill({ color: '#ff0000', fill: null }), null, 'An explicit invalid fill cannot silently fall back to another color');
});

test('Linear gradients follow their physical angle and cover the entire text block at every degree and scale', () => {
    for (const [width, height] of [[320, 180], [180, 320]]) {
        for (let angle = 0; angle <= 360; angle++) {
            const fill = { ...linear(), angle };
            const geometry = gradientGeometry(fill, width, height), scaled = gradientGeometry(fill, width * 3.25, height * 3.25);
            const dx = geometry.x1 - geometry.x0, dy = geometry.y1 - geometry.y0, length = Math.hypot(dx, dy);
            near(dx / length, Math.cos(angle * Math.PI / 180));
            near(dy / length, Math.sin(angle * Math.PI / 180));
            near(geometry.x0 + geometry.x1, 0);
            near(geometry.y0 + geometry.y1, 0);
            for (const key of ['x0', 'y0', 'x1', 'y1'])
                near(scaled[key], geometry[key] * 3.25);
            const projections = [];
            for (const x of [-width / 2, width / 2])
                for (const y of [-height / 2, height / 2])
                    projections.push(x * dx / length + y * dy / length);
            near(Math.min(...projections), -length / 2);
            near(Math.max(...projections), length / 2);
        }
    }
    const horizontal = gradientGeometry({ ...linear(), angle: 0 }, 320, 180);
    near(horizontal.x0, -160);
    near(horizontal.x1, 160);
    near(horizontal.y0, 0);
    near(horizontal.y1, 0);
    const vertical = gradientGeometry({ ...linear(), angle: 90 }, 320, 180);
    near(vertical.x0, 0);
    near(vertical.x1, 0);
    near(vertical.y0, -90);
    near(vertical.y1, 90);
});

test('Radial and conic geometry use centered local coordinates with proportional off-center scaling', () => {
    for (const [centerX, centerY] of [[50, 50], [0, 100], [100, 0], [16, 83]]) {
        for (const radius of [1, 100, 200]) {
            const fill = { ...radial(), centerX, centerY, radius };
            const geometry = gradientGeometry(fill, 320, 180), scaled = gradientGeometry(fill, 640, 360);
            near(geometry.x, (centerX - 50) * 3.2);
            near(geometry.y, (centerY - 50) * 1.8);
            near(geometry.radius, Math.hypot(320, 180) / 2 * radius / 100);
            for (const key of ['x', 'y', 'radius'])
                near(scaled[key], geometry[key] * 2);
        }
        for (const angle of [0, 37, 90, 180, 270, 360]) {
            const fill = { ...conic(), angle, centerX, centerY };
            const geometry = gradientGeometry(fill, 320, 180), scaled = gradientGeometry(fill, 640, 360);
            near(geometry.x, (centerX - 50) * 3.2);
            near(geometry.y, (centerY - 50) * 1.8);
            near(geometry.angle, angle * Math.PI / 180);
            near(scaled.x, geometry.x * 2);
            near(scaled.y, geometry.y * 2);
            near(scaled.angle, geometry.angle);
        }
    }
});

test('Painting preserves per-stop alpha and duplicate-position hard edges through a stable immutable sort', () => {
    const originalStops = Object.freeze([
        Object.freeze({ color: '#00ff00', opacity: 100, position: 75 }),
        Object.freeze({ color: '#ff0000', opacity: 50, position: 25 }),
        Object.freeze({ color: '#0000ff', opacity: 0, position: 25 }),
        Object.freeze({ color: '#ffffff', opacity: 100, position: 100 }),
        Object.freeze({ color: '#000000', opacity: 100, position: 0 }),
    ]);
    const snapshot = JSON.stringify(originalStops);
    for (const base of [linear(), radial(), conic()]) {
        const fill = Object.freeze({ ...base, stops: originalStops });
        const { ctx, paint, calls, additions } = context();
        assert.equal(textPaint(ctx, fill, 320, 180), paint);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].type, base.type);
        assert.deepEqual(additions, [
            [0, [0, 0, 0, 1]],
            [0.25, [255, 0, 0, 0.5]],
            [0.25, [0, 0, 255, 0]],
            [0.75, [0, 255, 0, 1]],
            [1, [255, 255, 255, 1]],
        ]);
        assert.equal(JSON.stringify(originalStops), snapshot);
    }
    const radialContext = context();
    textPaint(radialContext.ctx, { ...radial(), centerX: 0, centerY: 100 }, 320, 180);
    assert.deepEqual(radialContext.calls[0].args.slice(0, 5), [-160, 90, 0, -160, 90], 'The radial paint uses one shared local center and begins at zero radius');
    assert.throws(() => textPaint({}, conic(), 320, 180), /browser.*conic|conic.*browser/i);
});

test('Gradients accept arbitrary stop counts and reject malformed values before creating a paint', () => {
    const many = Array.from({ length: 257 }, (_, index) => ({ color: index % 2 ? '#ff0000' : '#0000ff', opacity: index % 2 ? 0 : 100, position: index / 256 * 100 }));
    const fill = { ...linear(), stops: many };
    assert.deepEqual(validateFill(fill), []);
    const observed = context();
    textPaint(observed.ctx, fill, 320, 180);
    assert.equal(observed.additions.length, 257);
    const cyclic = linear();
    cyclic.stops = [cyclic, cyclic];
    const invalid = [null, [], 'red', {}, { type: 'unknown' }, cyclic,
        { type: 'solid', color: '#fff', opacity: 100 }, { type: 'solid', color: '#ffffff', opacity: '50' },
        { ...linear(), angle: NaN }, { ...linear(), angle: -1 }, { ...linear(), angle: 361 },
        { ...radial(), centerX: Infinity }, { ...radial(), centerY: 101 }, { ...radial(), radius: 0 }, { ...radial(), radius: 201 },
        { ...conic(), angle: Infinity }, { ...linear(), stops: [] }, { ...linear(), stops: [stops()[0]] },
    ];
    for (const update of [{ color: null }, { color: '#gg0000' }, { opacity: NaN }, { opacity: -1 }, { opacity: 101 }, { position: NaN }, { position: -1 }, { position: 101 }, { position: '50' }])
        invalid.push({ ...linear(), stops: [{ ...stops()[0], ...update }, stops()[1]] });
    for (const value of invalid) {
        assert.ok(validateFill(value).length > 0);
        const spy = context();
        assert.throws(() => textPaint(spy.ctx, value, 320, 180));
        assert.equal(spy.calls.length, 0, 'Invalid settings never reach a canvas gradient call');
    }
    for (const [width, height] of [[0, 100], [100, -1], [NaN, 100], [100, Infinity]])
        assert.throws(() => gradientGeometry(linear(), width, height));
});

test('Fill cache keys track active paint changes while excluding irrelevant and circular metadata', () => {
    for (const base of [{ type: 'solid', color: '#0080ff', opacity: 50 }, linear(), radial(), conic()]) {
        const before = JSON.stringify(fillCacheKey(base));
        const extra = { ...base, editorSelection: {}, unused: undefined };
        extra.editorSelection.fill = extra;
        assert.deepEqual(validateFill(extra), []);
        assert.equal(JSON.stringify(fillCacheKey(extra)), before, 'Unrelated editor metadata cannot introduce a cache cycle');
        if (base.type === 'solid') {
            assert.notEqual(JSON.stringify(fillCacheKey({ ...base, color: '#ff0000' })), before);
            assert.notEqual(JSON.stringify(fillCacheKey({ ...base, opacity: 0 })), before);
        }
        else {
            for (const update of [{ color: '#00ff00' }, { opacity: 20 }, { position: 10 }]) {
                const edited = { ...base, stops: [{ ...base.stops[0], ...update }, base.stops[1]] };
                assert.notEqual(JSON.stringify(fillCacheKey(edited)), before, 'Every active stop property invalidates the paint cache');
            }
            for (const key of base.type === 'linear' ? ['angle'] : base.type === 'radial' ? ['centerX', 'centerY', 'radius'] : ['angle', 'centerX', 'centerY'])
                assert.notEqual(JSON.stringify(fillCacheKey({ ...base, [key]: base[key] + 1 })), before, `${key} changes invalidate gradient geometry`);
        }
    }
    const shared = { color: '#ff0000', opacity: 50, position: 50 };
    const repeated = { ...linear(), stops: [shared, shared] };
    assert.deepEqual(validateFill(repeated), []);
    const paint = context();
    textPaint(paint.ctx, repeated, 320, 180);
    assert.equal(paint.additions.length, 2, 'Shared stop references remain deliberate duplicate hard-edge stops');
});
