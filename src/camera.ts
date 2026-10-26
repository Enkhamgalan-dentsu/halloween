import type { CameraFacing } from './config.ts';

export interface CameraOptions {
  facing: CameraFacing;
  /** Desired field of view relative to the default lens: 0.5 = the "0.5×" ultra-wide. */
  zoom?: number;
  width?: number;
  height?: number;
}

/** What we ended up with — shown in the ?debug HUD. */
export interface CameraInfo {
  label: string;
  /** How the wide view was obtained (or why not). */
  wide: 'zoom' | 'ultra-wide lens' | 'not requested' | 'not available';
  zoom: number | null;
}

/** `zoom` is in the Media Capture spec but missing from TypeScript's DOM types. */
type ZoomCapabilities = MediaTrackCapabilities & { zoom?: { min: number; max: number } };
type ZoomSettings = MediaTrackSettings & { zoom?: number };

/** Starts the device camera into `video`. Must be called from a user gesture on iOS. */
export async function startCamera(video: HTMLVideoElement, opts: CameraOptions): Promise<{ stream: MediaStream; info: CameraInfo }> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('CameraUnavailable');
  }
  let stream = await open(opts, null);
  let wide: CameraInfo['wide'] = 'not requested';
  if (opts.facing === 'environment' && (opts.zoom ?? 1) < 1) {
    const result = await widen(stream, opts);
    stream = result.stream;
    wide = result.wide;
  }
  video.srcObject = stream;
  await playWhenReady(video);
  const track = stream.getVideoTracks()[0];
  const settings = (track?.getSettings() ?? {}) as ZoomSettings;
  return { stream, info: { label: track?.label ?? '?', wide, zoom: settings.zoom ?? null } };
}

function open(opts: CameraOptions, deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: opts.facing } }),
      width: { ideal: opts.width ?? 1280 },
      height: { ideal: opts.height ?? 720 },
      frameRate: { ideal: 30 },
    },
  });
}

/**
 * Try to get the wide "0.5×" view, which fits a whole person plus the fin in a small room.
 *  1. Zoom out on the current camera, if the browser exposes `zoom` (Android Chrome; on
 *     multi-lens iPhones the virtual camera's default can be 2 = "1×", so 1 = "0.5×").
 *  2. Otherwise switch to a camera labelled "Ultra Wide" (iOS lists "Back Ultra Wide Camera"
 *     on some versions; labels only appear after permission, which we now have).
 *  3. Otherwise keep the default lens.
 * Note: ultra-wide lenses are noisier in dim light — compare tracking with ?zoom=1.
 */
async function widen(stream: MediaStream, opts: CameraOptions): Promise<{ stream: MediaStream; wide: CameraInfo['wide'] }> {
  const target = opts.zoom ?? 0.5;
  const track = stream.getVideoTracks()[0];
  if (!track) return { stream, wide: 'not available' };

  const caps = (typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}) as ZoomCapabilities;
  const current = ((track.getSettings() as ZoomSettings).zoom) ?? 1;
  if (caps.zoom && caps.zoom.min < current) {
    const desired = Math.max(caps.zoom.min, current * target);
    try {
      await track.applyConstraints({ advanced: [{ zoom: desired } as MediaTrackConstraintSet] });
      return { stream, wide: 'zoom' };
    } catch (err) {
      console.warn('[camera] zoom failed', err);
    }
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const ultra = devices.find((d) => d.kind === 'videoinput' && /ultra\s*wide/i.test(d.label));
    if (ultra && ultra.deviceId !== track.getSettings().deviceId) {
      const next = await open(opts, ultra.deviceId);
      for (const t of stream.getTracks()) t.stop();
      return { stream: next, wide: 'ultra-wide lens' };
    }
  } catch (err) {
    console.warn('[camera] ultra-wide switch failed', err);
  }
  return { stream, wide: 'not available' };
}

/** Debug: play a recorded clip in a loop instead of the live camera. */
export async function startVideoFile(video: HTMLVideoElement, src: string): Promise<void> {
  video.srcObject = null;
  video.src = src;
  video.loop = true;
  await playWhenReady(video);
}

async function playWhenReady(video: HTMLVideoElement): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve) =>
      video.addEventListener('loadeddata', () => resolve(), { once: true }),
    );
  }
}

export function friendlyCameraError(err: unknown): string {
  const name = err instanceof Error ? (err.name === 'Error' ? err.message : err.name) : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Camera permission was blocked. Allow camera access in your browser settings and reload.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No suitable camera found on this device.';
    case 'NotReadableError':
      return 'The camera is busy in another app. Close it and try again.';
    case 'CameraUnavailable':
      return 'Camera is not available here. Open this link in Safari (iPhone) or Chrome (Android).';
    default:
      return 'Could not start the camera. Please reload and try again.';
  }
}
