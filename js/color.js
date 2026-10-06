const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(hex)) return `#${[...hex].map(channel => channel.repeat(2)).join('').toLowerCase()}`;
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function hexToRgb(value) {
  const hex = normalizeHex(value);
  if (!hex) return null;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(channel => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsv(rgb) {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(channel => clamp(channel, 0, 255) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: (h + 360) % 360, s: max ? delta / max * 100 : 0, v: max * 100 };
}

export function hsvToRgb({ h, s, v }) {
  const hue = ((Number.isFinite(h) ? h : 0) % 360 + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const value = clamp(v, 0, 100) / 100;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = value - chroma;
  const sectors = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
  const channels = sectors[Math.floor(hue / 60)];
  return { r: Math.round((channels[0] + m) * 255), g: Math.round((channels[1] + m) * 255), b: Math.round((channels[2] + m) * 255) };
}

export function hsvToHex(hsv) {
  return rgbToHex(hsvToRgb(hsv));
}

export function rgbaCss(hex, opacity = 100) {
  const { r, g, b } = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  return `rgba(${r}, ${g}, ${b}, ${Number((clamp(opacity, 0, 100) / 100).toFixed(4))})`;
}
