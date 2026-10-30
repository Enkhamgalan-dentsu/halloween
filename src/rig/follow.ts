import { Quaternion, Vector3 } from 'three';
import { BONE_KEYS } from './bones.ts';
import type { BoneKey } from './bones.ts';

/**
 * Seconds each bone takes to (mostly) catch up with the tracked pose, at float = 1.
 * Increases down the body → the tail and fin trail behind like a ghost's wake.
 */
const BONE_LAG: Record<BoneKey, number> = {
  hips: 0.12,
  spine: 0.13,
  spine1: 0.14,
  chest: 0.15,
  neck: 0.18,
  head: 0.2,
  leftShoulder: 0.15,
  leftUpperArm: 0.14,
  leftLowerArm: 0.16,
  leftHand: 0.2,
  rightShoulder: 0.15,
  rightUpperArm: 0.14,
  rightLowerArm: 0.16,
  rightHand: 0.2,
  tail1: 0.18,
  tail2: 0.22,
  tail3: 0.27,
  tail4: 0.32,
  tail5: 0.37,
  fin: 0.42,
  leftUpperLeg: 0.16,
  leftLowerLeg: 0.2,
  rightUpperLeg: 0.16,
  rightLowerLeg: 0.2,
};

export interface FollowOptions {
  /** 0 = locked to the tracking (no lag), 1 = default ghostly float, 2 = extra floaty. */
  float: number;
  /** Seconds for the body position to catch up (critically damped spring), at float = 1. */
  positionLag: number;
  /** Seconds for the size to settle, at float = 1. */
  scaleLag: number;
  /** Hover bob amplitude as a fraction of body scale (metres at scale 1), at float = 1. */
  bobAmplitude: number;
  /** Seconds per hover cycle. */
  bobPeriod: number;
  /** Jumps larger than this (metres) snap instead of gliding — e.g. a different person. */
  snapDistance: number;
}

export const DEFAULT_FOLLOW: FollowOptions = {
  float: 1,
  positionLag: 0.18,
  scaleLag: 0.6,
  bobAmplitude: 0.015,
  bobPeriod: 3.2,
  snapDistance: 1.0,
};

/** Unity-style SmoothDamp: critically damped spring, no overshoot, frame-rate independent. */
function smoothDamp(current: number, target: number, velocity: { v: number }, smoothTime: number, dt: number): number {
  if (smoothTime <= 0 || dt <= 0) {
    velocity.v = 0;
    return target;
  }
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity.v + omega * change) * dt;
  velocity.v = (velocity.v - omega * temp) * e;
  return target + (change + temp) * e;
}

/**
 * The pose that is actually displayed. Tracking updates arrive at camera rate (15–30 Hz)
 * via `setTarget`; `update(dt)` runs every rendered frame and eases the displayed pose
 * toward the target — smooth even between camera frames, trailing a little on fast moves
 * and gliding back, with the tail lagging most. Output objects are reused.
 */
export class SuitFollower {
  readonly position = new Vector3();
  scale = 1;
  /** Displayed model-space bone deltas (see SolvedPose.delta). */
  readonly rotations = {} as Record<BoneKey, Quaternion>;

  private readonly opts: FollowOptions;
  private readonly targetPosition = new Vector3();
  private targetScale = 1;
  private readonly targetRotations = {} as Record<BoneKey, Quaternion>;
  private readonly velocity = [{ v: 0 }, { v: 0 }, { v: 0 }];
  private readonly scaleVelocity = { v: 0 };
  private hasTarget = false;
  private needsSnap = true;
  private time = 0;
  /** Displayed position including the hover bob. */
  readonly displayPosition = new Vector3();

  constructor(opts: Partial<FollowOptions> = {}) {
    this.opts = { ...DEFAULT_FOLLOW, ...opts };
    for (const key of BONE_KEYS) {
      this.rotations[key] = new Quaternion();
      this.targetRotations[key] = new Quaternion();
    }
  }

  setTarget(rotations: Record<BoneKey, Quaternion>, position: Vector3, scale: number): void {
    for (const key of BONE_KEYS) this.targetRotations[key].copy(rotations[key]);
    if (this.hasTarget && position.distanceTo(this.targetPosition) > this.opts.snapDistance) this.needsSnap = true;
    this.targetPosition.copy(position);
    this.targetScale = scale;
    this.hasTarget = true;
  }

  /** Jump straight to the next target (first appearance, re-appearance, new person). */
  snap(): void {
    this.needsSnap = true;
  }

  update(dtSeconds: number): void {
    if (!this.hasTarget) return;
    const dt = Math.min(Math.max(dtSeconds, 0), 0.1);
    this.time += dt;
    const f = this.opts.float;

    if (this.needsSnap || f <= 0) {
      this.position.copy(this.targetPosition);
      this.scale = this.targetScale;
      for (const key of BONE_KEYS) this.rotations[key].copy(this.targetRotations[key]);
      for (const v of this.velocity) v.v = 0;
      this.scaleVelocity.v = 0;
      this.needsSnap = false;
    } else {
      const lag = this.opts.positionLag * f;
      this.position.set(
        smoothDamp(this.position.x, this.targetPosition.x, this.velocity[0] as { v: number }, lag, dt),
        smoothDamp(this.position.y, this.targetPosition.y, this.velocity[1] as { v: number }, lag, dt),
        smoothDamp(this.position.z, this.targetPosition.z, this.velocity[2] as { v: number }, lag, dt),
      );
      this.scale = smoothDamp(this.scale, this.targetScale, this.scaleVelocity, this.opts.scaleLag * f, dt);
      for (const key of BONE_KEYS) {
        // Exponential approach: ~95% of the way after 3 × lag.
        const t = 1 - Math.exp(-dt / (BONE_LAG[key] * f));
        this.rotations[key].slerp(this.targetRotations[key], t);
      }
    }

    const bob = this.opts.bobAmplitude * f * this.scale * Math.sin((2 * Math.PI * this.time) / this.opts.bobPeriod);
    this.displayPosition.copy(this.position);
    this.displayPosition.y += bob;
  }
}
