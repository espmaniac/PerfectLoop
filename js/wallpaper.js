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
  return `PerfectLoop ${kind === 'live-photo' ? 'Live Photo' : 'iPhone wallpaper'} files

Video: ${width} x ${height}, ${duration.toFixed(3)} seconds, silent H.264.
Key photo: ${stillTime.toFixed(3)} seconds in the finished video.

Created on the PerfectLoop website
The Live Photo is generated entirely in your browser, including its photo/video
pairing and key-photo metadata. No third-party converter is part of this workflow.
Saving that result as one asset in Apple Photos is a separate system import step.

Experimental Live Photo import
The live-photo.pvt package contains a matching photo.jpg and photo.mov, plus the
package metadata.plist. Its identifiers and timed key-photo marker are already paired.

Try direct import on iPhone or iPad
1. Save the ZIP to Files, including when transferring it from Windows or Linux.
2. Touch and hold the ZIP and choose Uncompress.
3. Open live-photo.pvt. If the system offers Save to Photos, use that action.
4. Confirm that Photos shows ONE Live Photo and that its motion plays.
The Files action depends on the device and iOS version; it may not be offered.
This direct import route has not been verified on a physical iPhone by PerfectLoop.
Merely copying a ZIP to Files does not import a Live Photo.

Built-in Photos import on a Mac
Unzip and import live-photo.pvt into Photos. If the package is not recognized, open
its contents and import BOTH files, photo.jpg and photo.mov, together into Photos.
Verify they appear as ONE Live Photo and that motion plays. Sync that Photos asset
with iCloud Photos, or share the asset from Photos to the iPhone with AirDrop.

Lock Screen wallpaper
In Settings > Wallpaper > Add New Wallpaper > Photos, choose the imported Live Photo.
Check that motion is available before setting it as your Lock Screen. Modern iOS may
accept a Live Photo in Photos and still report Motion Not Available for wallpaper.
Pairing and native packaging do not establish wallpaper eligibility; that must be
verified on the target iPhone. PerfectLoop does not reproduce camera sensor metadata.

${kind === 'kit' ? `Other files in this kit
wallpaper.mp4 is the regular finished video.
wallpaper.jpg is the selected plain still. Save it to Photos for a static wallpaper.

` : ''}The phone frame, clock, and app icons in PerfectLoop are approximate preview overlays.
They are excluded from every exported file. Home Screen wallpaper is static; iOS
controls Lock Screen motion and does not play an endless wallpaper video.

Format and import references:
https://github.com/LimitPoint/LivePhoto
https://github.com/RhetTbull/makelive
https://github.com/Hronrad/livephoto-forge
https://github.com/LimitPoint/LivePhoto/issues/10
`;
}
