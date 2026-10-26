import { Vector3 } from 'three';
import type { Landmark } from '../tracking/pose.ts';

/**
 * MediaPipe world landmark → three.js axes. This is the ONLY place that converts.
 *   MediaPipe: x right, y DOWN, z AWAY from the camera (smaller z = closer), metres.
 *   three.js:  x right, y UP,   z TOWARD the camera.
 * A person facing the camera therefore faces +Z, with their left on +X — same as the suit.
 */
export function toThree(l: Landmark, out: Vector3 = new Vector3()): Vector3 {
  return out.set(l.x, -l.y, -l.z);
}

/** BlazePose left/right index pairs. */
export const LR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
  [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

/** In-place swap of left/right labels (used when MediaPipe mislabels a back view). */
export function swapLeftRight<T>(points: T[]): T[] {
  for (const [a, b] of LR_PAIRS) {
    const tmp = points[a] as T;
    points[a] = points[b] as T;
    points[b] = tmp;
  }
  return points;
}

export function visibilityOf(l: Landmark | undefined): number {
  return l ? (l.visibility ?? 1) : 0;
}

/**
 * How much the landmark's *position* can be trusted: visible, or at least present in
 * frame. Seen from behind, MediaPipe marks shoulders and hips as poorly "visible"
 * (self-occluded) even though it still locates them well — `presence` stays high.
 */
export function reliabilityOf(l: Landmark | undefined): number {
  return l ? Math.max(l.visibility ?? 1, l.presence ?? 0) : 0;
}

/** Maps visibility to a 0..1 trust weight (below `lo` → 0, above `hi` → 1). */
export function trust(visibility: number, lo = 0.35, hi = 0.75): number {
  const t = (visibility - lo) / (hi - lo);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}
