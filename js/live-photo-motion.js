// Independently generated V3 timing records for the finished digital frames.
// Their coordinate space is fixed: identity trajectory, no added motion blur,
// and unit zoom. These are not measurements copied from a source camera.
// Structure references are documented in docs/iphone-wallpapers.md.
export const MOTION_PAYLOAD_SIZE = 136;
export const MOTION_SETUP_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>LivePhotoMetadataSetupDataVersion</key><integer>1</integer></dict></plist>`;

export function neutralMotionPayload(presentationTicks, timescale) {
    if (!Number.isSafeInteger(presentationTicks) || presentationTicks < 0
        || !Number.isSafeInteger(timescale) || timescale <= 0)
        throw new Error('Live Photo requires valid motion sample timing.');
    const bytes = new Uint8Array(MOTION_PAYLOAD_SIZE), view = new DataView(bytes.buffer);
    const nanoseconds = (BigInt(presentationTicks) * 1_000_000_000n + BigInt(Math.floor(timescale / 2))) / BigInt(timescale);
    if (nanoseconds > 0xffffffffffffffffn) throw new Error('Live Photo motion timestamp is too large.');
    view.setUint32(0, 3, true);
    view.setFloat32(32, 1, true);
    // Only blur displacement (zero) and coordinate zoom (one) are declared.
    // Exposure, focus, gain, faces and other camera fields remain absent.
    view.setUint16(42, 0x18, true);
    // Trajectory, current/original timestamps, and uninterpolated frame status.
    view.setUint16(64, 0x27, true);
    for (const component of [0, 4, 8]) view.setFloat32(68 + component * 4, 1, true);
    view.setBigUint64(104, nanoseconds, true);
    view.setBigUint64(112, nanoseconds, true);
    return bytes;
}
