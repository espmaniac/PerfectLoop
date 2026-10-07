import { rotatedDimensions } from './framing.js';

// Output dimensions stay independent of the source player's proportions.
export function dimensionsForAspect(aspect, info, rotate = 0) {
  if (aspect === 'original') {
    const rotated = rotatedDimensions(info.width || 1920, info.height || 1080, rotate);
    const width = Math.max(16, rotated.width);
    const height = Math.max(16, rotated.height);
    const scale = Math.min(1, 3840 / width, 3840 / height);
    return { width: Math.max(16, Math.floor(width * scale / 2) * 2), height: Math.max(16, Math.floor(height * scale / 2) * 2) };
  }
  return aspect === '16:9' ? { width: 1920, height: 1080 }
    : aspect === '9:16' ? { width: 1080, height: 1920 }
      : { width: 1080, height: 1080 };
}

export function selectedAspect(settings) {
  if (settings.aspect === 'original') return 'original';
  if (settings.aspect === 'custom') return 'custom';
  if (settings.width * 9 === settings.height * 16) return '16:9';
  if (settings.width * 16 === settings.height * 9) return '9:16';
  if (settings.width === settings.height) return '1:1';
  return 'custom';
}

export function alternateFormat(settings) {
  return settings.width > settings.height
    ? { aspect: '9:16', width: 720, height: 1280 }
    : { aspect: '16:9', width: 1280, height: 720 };
}
