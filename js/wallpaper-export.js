import { zipSync } from '../vendor/fflate.js';
import { livePhotoJpeg, livePhotoMov } from './live-photo.js';
import { wallpaperInstructions } from './wallpaper.js';

function aborted(signal) { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); }

export async function wallpaperDownload(result, kind, signal) {
  aborted(signal);
  if (!['video', 'image', 'kit'].includes(kind)) throw new Error('Choose a wallpaper download format.');
  const base = result.name.replace(/\.[^.]+$/, '').replace(/-loop$/, '') || 'wallpaper';
  if (kind === 'video') return { ...result, name: `${base}-wallpaper.mp4` };
  const { jpeg, mov, stillTime } = result.wallpaper || {};
  if (!(jpeg instanceof Blob) || !(mov instanceof Blob) || !Number.isFinite(stillTime)) throw new Error('The wallpaper files are not ready. Export again.');
  if (kind === 'image') return { ...result, blob: jpeg, name: `${base}-wallpaper.jpg`, hasAudio: false };
  const random = crypto.getRandomValues(new Uint8Array(16));
  random[6] = (random[6] & 0x0f) | 0x40; random[8] = (random[8] & 0x3f) | 0x80;
  const hex = [...random].map(value => value.toString(16).padStart(2, '0')).join('');
  const identifier = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const photo = await livePhotoJpeg(jpeg, identifier, result);
  aborted(signal);
  const video = await livePhotoMov(mov, identifier, { stillTime, fps: result.fps });
  aborted(signal);
  const files = {
    'live-photo/photo.jpg': new Uint8Array(await photo.arrayBuffer()),
    'live-photo/photo.mov': new Uint8Array(await video.arrayBuffer()),
    'wallpaper.jpg': new Uint8Array(await jpeg.arrayBuffer()),
    'README.txt': new TextEncoder().encode(wallpaperInstructions({ ...result, stillTime, kind })),
  };
  // Conversion input remains available if iOS rejects the paired files as wallpaper.
  files['wallpaper.mp4'] = new Uint8Array(await result.blob.arrayBuffer());
  files['wallpaper-info.json'] = new TextEncoder().encode(JSON.stringify({ width: result.width, height: result.height,
    duration: result.duration, fps: result.fps, keyPhotoTime: stillTime, assetIdentifier: identifier,
    livePhotoImport: 'experimental', wallpaperEligibility: 'requires verification on the target iPhone' }, null, 2));
  aborted(signal);
  const zip = zipSync(files, { level: 0 });
  aborted(signal);
  return { ...result, blob: new Blob([zip], { type: 'application/zip' }), name: `${base}-wallpaper-kit.zip`, hasAudio: false };
}
