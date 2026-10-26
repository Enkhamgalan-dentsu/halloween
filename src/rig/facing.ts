import type { MarkerSide } from '../config.ts';
import type { PoseFrame } from '../tracking/pose.ts';
import { visibilityOf } from './landmarks.ts';

export type Facing = 'front' | 'back';

const FACE = [0, 2, 5] as const; // nose, left eye, right eye
const ALPHA = 0.12;
const TO_FRONT = 0.72;
const TO_BACK = 0.45;

/**
 * Is the guest looking at the wearer's front or back?
 * Starts from the scanned marker (/F or /B), then follows face visibility with
 * hysteresis. Phase 4 overrides it whenever the chest/back QR is seen in frame.
 */
export class FacingEstimator {
  facing: Facing;
  /** Smoothed face visibility 0..1 (shown in the debug HUD for tuning). */
  faceScore: number;

  constructor(initial: MarkerSide) {
    this.facing = initial === 'back' ? 'back' : 'front';
    this.faceScore = this.facing === 'front' ? 1 : 0;
  }

  update(frame: PoseFrame): Facing {
    let sum = 0;
    for (const i of FACE) sum += visibilityOf(frame.image[i]);
    this.faceScore += ALPHA * (sum / FACE.length - this.faceScore);
    if (this.facing === 'back' && this.faceScore > TO_FRONT) this.facing = 'front';
    else if (this.facing === 'front' && this.faceScore < TO_BACK) this.facing = 'back';
    return this.facing;
  }

  /** A marker seen in frame is stronger evidence than face visibility. */
  override(side: Facing): void {
    this.facing = side;
    this.faceScore = side === 'front' ? 1 : 0;
  }
}
