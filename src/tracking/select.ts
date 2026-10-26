import { POSE } from './pose.ts';
import type { Landmark, PoseFrame } from './pose.ts';

export interface TorsoBox {
  /** Centre and size, normalized to the video frame. */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const TORSO = [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_HIP, POSE.RIGHT_HIP] as const;

/** A person whose torso centre stays within this distance of the last pick keeps the suit. */
const STICKY_RADIUS = 0.15;
const STICKY_BONUS = 3;

export function torsoBox(image: readonly Landmark[]): TorsoBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of TORSO) {
    const p = image[i];
    if (!p) return null;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

/**
 * Picks the wearer among the detected people: big torso (close to the camera), near the
 * centre of the frame, and — strongly — the same person as last frame, so someone
 * walking past doesn't steal the suit. Phase 4 adds "the torso that contains the marker".
 */
export class WearerSelector {
  private last: { x: number; y: number } | null = null;

  /** Index into `frames`, or -1 if nobody usable is in view. */
  select(frames: readonly PoseFrame[]): number {
    let best = -1;
    let bestScore = 0;
    frames.forEach((frame, i) => {
      const box = torsoBox(frame.image);
      if (!box) return;
      const area = Math.max(box.w, 0.02) * Math.max(box.h, 0.02);
      const offCentre = Math.hypot(box.cx - 0.5, box.cy - 0.5);
      let score = area * (1 - Math.min(offCentre, 0.7));
      if (this.last && Math.hypot(box.cx - this.last.x, box.cy - this.last.y) < STICKY_RADIUS) {
        score *= STICKY_BONUS;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });

    const chosen = best >= 0 ? frames[best] : undefined;
    const box = chosen ? torsoBox(chosen.image) : null;
    if (box) this.last = { x: box.cx, y: box.cy };
    return best;
  }

  reset(): void {
    this.last = null;
  }
}
