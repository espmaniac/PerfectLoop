import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, hsvToHex, rgbaCss } from '../js/color.js';

test('Hex fields normalize accepted shorthand and reject malformed colors', () => {
    assert.equal(normalizeHex('  #AbC  '), '#aabbcc');
    assert.equal(normalizeHex('00FF80'), '#00ff80');
    assert.deepEqual(hexToRgb('#ff0080'), { r: 255, g: 0, b: 128 });
    for (const value of [null, undefined, 123, '', '#', '#1234', '#12345678', '#12xy00', 'rgb(255, 0, 0)']) {
        assert.equal(normalizeHex(value), null);
        assert.equal(hexToRgb(value), null);
    }
    assert.equal(rgbToHex({ r: 300, g: -10, b: 15.5 }), '#ff0010');
    assert.equal(rgbToHex({ r: NaN, g: Infinity, b: 12 }), '#00000c');
});

test('HSV color controls use the standard primary hues and preserve achromatic brightness', () => {
    for (const [hex, hue] of [['#ff0000', 0], ['#ffff00', 60], ['#00ff00', 120], ['#00ffff', 180], ['#0000ff', 240], ['#ff00ff', 300]]) {
        const rgb = hexToRgb(hex);
        assert.deepEqual(rgbToHsv(rgb), { h: hue, s: 100, v: 100 });
        assert.deepEqual(hsvToRgb({ h: hue, s: 100, v: 100 }), rgb);
    }
    for (const channel of [0, 64, 128, 255]) {
        const hsv = rgbToHsv({ r: channel, g: channel, b: channel });
        assert.equal(hsv.h, 0);
        assert.equal(hsv.s, 0);
        assert.ok(Math.abs(hsv.v - channel / 255 * 100) < 1e-10);
        assert.deepEqual(hsvToRgb(hsv), { r: channel, g: channel, b: channel });
    }
    assert.equal(hsvToHex({ h: -60, s: 100, v: 100 }), '#ff00ff');
    assert.equal(hsvToHex({ h: 540, s: 100, v: 100 }), '#00ffff');
    assert.equal(hsvToHex({ h: 720, s: 100, v: 100 }), '#ff0000');
    assert.equal(hsvToHex({ h: 30, s: 200, v: 200 }), '#ff8000');
    assert.equal(hsvToHex({ h: 30, s: -10, v: 50 }), '#808080');
    assert.equal(hsvToHex({ h: 30, s: 50, v: -10 }), '#000000');
});

test('RGB and HSV round trips preserve mixed colors across the color cube', () => {
    for (const r of [0, 64, 128, 255]) {
        for (const g of [0, 96, 192, 255]) {
            for (const b of [0, 80, 160, 255]) {
                const rgb = { r, g, b }, hsv = rgbToHsv(rgb);
                assert.ok(hsv.h >= 0 && hsv.h < 360 && hsv.s >= 0 && hsv.s <= 100 && hsv.v >= 0 && hsv.v <= 100);
                assert.deepEqual(hsvToRgb(hsv), rgb);
                assert.equal(hsvToHex(hsv), rgbToHex(rgb));
            }
        }
    }
});

test('RGBA colors retain their RGB channels at zero opacity and clamp alpha at its limits', () => {
    const channels = css => css.match(/[\d.]+/g).map(Number);
    assert.deepEqual(channels(rgbaCss('#ff0080', 50)), [255, 0, 128, 0.5]);
    assert.deepEqual(channels(rgbaCss('#ff0080', 0)), [255, 0, 128, 0]);
    assert.deepEqual(channels(rgbaCss('#ff0080', -20)), [255, 0, 128, 0]);
    assert.deepEqual(channels(rgbaCss('#ff0080', 120)), [255, 0, 128, 1]);
});
