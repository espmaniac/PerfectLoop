import { clamp, framePlan } from './logic.js';

// Representative display sizes, rather than a promise to reproduce every iPhone UI.
export const PHONE_PROFILES = [
  { id: 'notch', name: 'iPhone · Face ID', width: 1170, height: 2532, chrome: 'notch' },
  { id: 'island', name: 'iPhone · Large screen', width: 1290, height: 2796, chrome: 'island' },
  { id: 'button', name: 'iPhone · Home button', width: 750, height: 1334, chrome: 'button' },
];

export function phoneProfile(settings) {
  return settings.wallpaperDevice === 'custom'
    ? { id: 'custom', name: 'Custom phone size', width: settings.width, height: settings.height, chrome: 'island' }
    : PHONE_PROFILES.find(profile => profile.id === settings.wallpaperDevice) || PHONE_PROFILES[0];
}

export function wallpaperRange(settings, info, seconds = 3) {
  const target = Math.max(3, Math.round(seconds * settings.fps));
  let frames = target;
  if (settings.method.includes('pingpong')) frames = Math.ceil((target + 2) / 2);
  else if (['crossfade', 'offset'].includes(settings.method)) {
    // Solve in frames because a long requested overlap is capped by clip length.
    while (frames < target * 2 && framePlan({ ...settings, start: 0, end: frames / settings.fps * settings.speed }).outputFrames < target) frames++;
  }
  const rawDuration = frames / settings.fps * settings.speed;
  const duration = info.duration > 0 ? info.duration : rawDuration;
  const start = clamp(settings.start || 0, 0, Math.max(0, duration - rawDuration));
  return { start, end: Math.min(duration, start + rawDuration) };
}

export function wallpaperPreset(settings, info, device = settings.wallpaperDevice || 'notch') {
  const profile = phoneProfile({ ...settings, wallpaperDevice: device });
  const next = { ...settings, preset: 'iphone', aspect: 'custom', wallpaperDevice: profile.id,
    width: profile.width, height: profile.height, format: 'mp4', fps: 30, audio: 'strip', repeats: 1, targetMB: 0 };
  return { ...next, ...wallpaperRange(next, info) };
}

export function keyPhotoTime(duration, fps, percent = 50, frameCount = Math.floor(duration * fps + 1e-6)) {
  const last = Math.max(0, Math.min(frameCount - 1, Math.floor(duration * fps + 1e-6) - 1));
  return Math.round(last * clamp(percent, 0, 100) / 100) / fps;
}

export function wallpaperInstructions({ kind, width, height, duration, stillTime }) {
  return `PerfectLoop iPhone wallpaper files

Video: ${width} x ${height}, ${duration.toFixed(3)} seconds, silent H.264.
Key photo: ${stillTime.toFixed(3)} seconds in the finished video.

MP4 conversion (recommended for wallpaper installation)
1. Transfer wallpaper.mp4 to your iPhone using Files, cloud storage, or AirDrop.
2. Open it in an iOS converter that supports Live Photo wallpapers for your iOS version.
3. Save the converted Live Photo to Photos.
4. In Settings > Wallpaper > Add New Wallpaper > Photos, choose that Live Photo.
5. Check that motion is available before setting it as your Lock Screen.

Static wallpaper
Save wallpaper.jpg to Photos and use it as a still Lock Screen or Home Screen wallpaper.

${kind === 'kit' || kind === 'pair' ? `Experimental Live Photo pair
The live-photo folder contains a matching photo.jpg and photo.mov. Their identifiers
and timed key-photo marker are paired; the MOV contains real QuickTime metadata.
On a Mac, import BOTH files together into Photos. Verify they appear as ONE Live Photo
and that motion plays. Sync that Photos asset with iCloud Photos, or share the asset
from Photos to the iPhone with AirDrop. Merely copying a ZIP to Files does not import
a Live Photo. Windows/Linux users can use the MP4 conversion path instead.

Modern iOS may accept a Live Photo in Photos and still report Motion Not Available
for wallpaper. The additional wallpaper eligibility rules are not reproduced by this
export. Use a compatible iOS converter if motion is unavailable.

` : ''}The phone frame, clock, and app icons in PerfectLoop are approximate preview overlays.
They are excluded from every exported file. Home Screen wallpaper is static; iOS
controls Lock Screen motion and does not play an endless wallpaper video.

Format and import references:
https://github.com/LimitPoint/LivePhoto
https://github.com/RhetTbull/makelive
https://github.com/LimitPoint/LivePhoto/issues/10
`;
}
