/**
 * Runtime configuration read from the URL.
 *
 * Path (printed in the QR codes — never change after printing):
 *   /F  → guest scanned the CHEST marker (sees the wearer's front)
 *   /B  → guest scanned the BACK marker
 *   Uppercase on purpose: an all-uppercase URL fits QR "alphanumeric" mode, which keeps
 *   the code at version 3 (29×29) even with error correction H → scans from farther away.
 *
 * Query (development):
 *   ?s=f | ?s=b      same as /F and /B
 *   ?cam=front       use the selfie camera (wearer testing alone)
 *   ?debug           show landmark skeleton, FPS and tracking state
 *   ?video=/x.mp4    run the pipeline on a recorded clip instead of the camera (same-origin path only)
 *   ?model=full      use the heavier, more accurate pose model
 *   ?mc=1.2&beta=6   landmark smoothing (One Euro minCutoff / beta) for tuning on a phone
 *   ?fov=63          vertical field of view of the 3D camera, degrees. Size and position are
 *                    estimated with the same FOV they're drawn with, so it mostly cancels; it
 *                    only changes perspective strength (near parts looking bigger).
 *   ?size=1          suit size multiplier on top of the automatic fit (0.9 = 10% smaller)
 *   ?head=0          head pitch offset in degrees (+ = look down, − = look up)
 *   ?fin=hang|trail  fin hangs below the tail (default) or trails along the floor behind
 *   ?zoom=0.5        try the wide (0.5×) back camera; ?zoom=1 = normal lens
 *   ?float=1         ghost-like easing: 0 = locked to tracking, 1 = default, 2 = extra floaty
 */
import { DEFAULT_SMOOTHING } from './tracking/smoothing.ts';
import type { SmoothingParams } from './tracking/smoothing.ts';

export type CameraFacing = 'environment' | 'user';
export type MarkerSide = 'front' | 'back' | 'unknown';
export type PoseModel = 'lite' | 'full';
export type FinMode = 'hang' | 'trail';

export interface AppConfig {
  debug: boolean;
  facing: CameraFacing;
  side: MarkerSide;
  videoSrc: string | null;
  poseModel: PoseModel;
  smoothing: SmoothingParams;
  fov: number;
  size: number;
  headPitchDeg: number;
  fin: FinMode;
  zoom: number;
  float: number;
}

export function readConfig(
  pathname: string = window.location.pathname,
  search: string = window.location.search,
): AppConfig {
  const q = new URLSearchParams(search);
  const video = q.get('video');
  return {
    debug: q.has('debug'),
    facing: q.get('cam') === 'front' ? 'user' : 'environment',
    side: sideFromUrl(pathname, q.get('s')),
    // Only same-origin absolute paths, never arbitrary URLs.
    videoSrc: video && video.startsWith('/') && !video.startsWith('//') ? video : null,
    poseModel: q.get('model') === 'full' ? 'full' : 'lite',
    smoothing: {
      minCutoff: positiveNumber(q.get('mc'), DEFAULT_SMOOTHING.minCutoff),
      beta: positiveNumber(q.get('beta'), DEFAULT_SMOOTHING.beta),
    },
    fov: clamp(positiveNumber(q.get('fov'), 63), 30, 100),
    size: clamp(positiveNumber(q.get('size'), 1), 0.5, 1.5),
    headPitchDeg: clamp(finiteNumber(q.get('head'), 0), -45, 45),
    fin: q.get('fin') === 'trail' ? 'trail' : 'hang',
    zoom: clamp(positiveNumber(q.get('zoom'), 0.5), 0.5, 1),
    float: clamp(positiveNumber(q.get('float'), 1), 0, 3),
  };
}

function sideFromUrl(pathname: string, s: string | null): MarkerSide {
  const key = (pathname.replace(/^\/+|\/+$/g, '') || s || '').toLowerCase();
  if (key === 'f') return 'front';
  if (key === 'b') return 'back';
  return 'unknown';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function finiteNumber(raw: string | null, fallback: number): number {
  const n = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(raw: string | null, fallback: number): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
