import { zipSync } from '../vendor/fflate.js';
import { livePhotoJpeg, livePhotoMov } from './live-photo.js';
import { wallpaperInstructions } from './wallpaper.js';

function aborted(signal) { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); }

const metadataPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PFVideoComplementMetadataVersionKey</key>
  <string>1</string>
</dict>
</plist>
`;

function wallpaperBase(result) { return result.name.replace(/\.[^.]+$/, '').replace(/-loop$/, '') || 'wallpaper'; }

function wallpaperMedia(result, motion = true) {
  const { jpeg, mov, stillTime } = result.wallpaper || {};
  if (!(jpeg instanceof Blob) || (motion && !(mov instanceof Blob)) || !Number.isFinite(stillTime)) throw new Error('The wallpaper files are not ready. Export again.');
  return { jpeg, mov, stillTime };
}

function pairedDetails(result) {
  const wallpaper = result.wallpaper || {};
  const fps = wallpaper.fps ?? result.fps;
  return { width: wallpaper.width ?? result.width, height: wallpaper.height ?? result.height, fps,
    frames: wallpaper.frames ?? result.frames ?? Math.floor(result.duration * fps + 1e-6),
    duration: wallpaper.duration ?? result.duration, codec: wallpaper.codec ?? result.codec ?? 'h264' };
}

async function pairedPackage(result, signal) {
  aborted(signal);
  const { jpeg, mov, stillTime } = wallpaperMedia(result);
  const random = crypto.getRandomValues(new Uint8Array(16));
  random[6] = (random[6] & 0x0f) | 0x40; random[8] = (random[8] & 0x3f) | 0x80;
  const hex = [...random].map(value => value.toString(16).padStart(2, '0')).join('');
  const identifier = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const details = pairedDetails(result);
  const photo = await livePhotoJpeg(jpeg, identifier, details);
  aborted(signal);
  const video = await livePhotoMov(mov, identifier, { ...details, stillTime });
  aborted(signal);
  return { identifier, photo, video, details, plist: new Blob([metadataPlist], { type: 'application/xml' }) };
}

export async function wallpaperDownload(result, kind, signal) {
  aborted(signal);
  if (!['video', 'image', 'live-photo', 'kit'].includes(kind)) throw new Error('Choose a wallpaper download format.');
  const base = wallpaperBase(result);
  if (kind === 'video') return { ...result, name: `${base}-wallpaper.mp4` };
  const { jpeg, stillTime } = wallpaperMedia(result, kind !== 'image');
  if (kind === 'image') return { ...result, blob: jpeg, name: `${base}-wallpaper.jpg`, hasAudio: false };
  const { identifier, photo, video, details, plist } = await pairedPackage(result, signal);
  const read = async source => {
    aborted(signal);
    const bytes = new Uint8Array(await source.arrayBuffer());
    aborted(signal);
    return bytes;
  };
  const files = {
    'live-photo.pvt/': [new Uint8Array(), { attrs: 16, os: 0 }],
    'live-photo.pvt/photo.jpg': await read(photo),
    'live-photo.pvt/photo.mov': await read(video),
    'live-photo.pvt/metadata.plist': await read(plist),
  };
  if (kind === 'kit') {
    files['wallpaper.jpg'] = await read(jpeg);
    files['wallpaper.mp4'] = await read(result.blob);
    files['README.txt'] = new TextEncoder().encode(wallpaperInstructions({ ...details, stillTime, kind }));
    files['wallpaper-info.json'] = new TextEncoder().encode(JSON.stringify({ width: details.width, height: details.height,
      duration: details.duration, fps: details.fps, frames: details.frames, codec: details.codec, keyPhotoTime: stillTime, assetIdentifier: identifier,
      livePhotoImport: 'experimental', wallpaperEligibility: 'requires verification on the target iPhone' }, null, 2));
  }
  aborted(signal);
  const zip = zipSync(files, { level: 0 });
  aborted(signal);
  const suffix = kind === 'live-photo' ? 'live-photo.pvt.zip' : 'wallpaper-kit.zip';
  return { ...result, blob: new Blob([zip], { type: 'application/zip' }), name: `${base}-${suffix}`, hasAudio: false };
}

export async function saveWallpaperPackage(result, parent, signal) {
  aborted(signal);
  if (!parent || typeof parent.getDirectoryHandle !== 'function' || typeof parent.removeEntry !== 'function')
    throw new Error('Choose a writable folder to save the Live Photo package.');
  const { identifier, photo, video, plist } = await pairedPackage(result, signal);
  const base = wallpaperBase(result).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^[ .]+|[ .]+$/g, '').slice(0, 100) || 'wallpaper';
  const stem = `${base}-live-photo-${identifier}`;
  let name = '', directory;
  try {
    // A UUID makes unrelated exports distinct. Check both directory and file
    // collisions because create:true would otherwise reuse an existing package.
    for (let suffix = 0; !directory; suffix++) {
      aborted(signal);
      const candidate = `${stem}${suffix ? `-${suffix + 1}` : ''}.pvt`;
      try {
        await parent.getDirectoryHandle(candidate);
        aborted(signal);
        continue;
      } catch (error) {
        aborted(signal);
        if (error.name === 'TypeMismatchError') continue;
        if (error.name !== 'NotFoundError') throw error;
      }
      directory = await parent.getDirectoryHandle(candidate, { create: true });
      name = candidate;
      aborted(signal);
    }
    for (const [filename, source] of [['photo.jpg', photo], ['photo.mov', video], ['metadata.plist', plist]]) {
      aborted(signal);
      const file = await directory.getFileHandle(filename, { create: true });
      aborted(signal);
      let writable;
      try {
        writable = await file.createWritable();
        aborted(signal);
        await writable.write(source);
        aborted(signal);
        await writable.close();
        writable = null;
        aborted(signal);
      } catch (error) {
        if (writable) {
          try { await writable.abort(); } catch { /* Package cleanup below handles unfinished files. */ }
        }
        throw error;
      }
    }
    return { name, identifier, bytes: photo.size + video.size + plist.size, hasAudio: false };
  } catch (error) {
    if (name) {
      try { await parent.removeEntry(name, { recursive: true }); }
      catch (cleanupError) {
        const failure = new Error(`Saving "${name}" did not finish, and its partial Live Photo package could not be removed. Delete that package from the selected folder before trying again.`, { cause: error });
        failure.partialPackageName = name;
        failure.cleanupError = cleanupError;
        throw failure;
      }
    }
    throw error;
  }
}
