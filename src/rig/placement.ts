import { Vector3 } from 'three';
import { OneEuroFilter } from '../tracking/filters.ts';
import { POSE } from '../tracking/pose.ts';
import type { Landmark, PoseFrame } from '../tracking/pose.ts';
import { videoToView } from '../util/viewport.ts';
import type { CoverMapping } from '../util/viewport.ts';
import { reliabilityOf } from './landmarks.ts';
import type { SuitMeasure } from './profiles.ts';

/** Body segments used to estimate depth: pairs of landmark indices. */
const SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
  [POSE.LEFT_SHOULDER, POSE.LEFT_HIP],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_HIP],
  [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW],
  [POSE.LEFT_HIP, POSE.LEFT_KNEE],
  [POSE.RIGHT_HIP, POSE.RIGHT_KNEE],
  [POSE.LEFT_KNEE, POSE.LEFT_ANKLE],
  [POSE.RIGHT_KNEE, POSE.RIGHT_ANKLE],
];

/** Minimum landmark reliability (visibility or presence) for a segment to count. */
const MIN_RELIABILITY = 0.5;
const MIN_IN_PLANE = 0.4;
const MIN_PX = 8;

/** The wearer's own lengths (metres, MediaPipe world landmarks). */
export interface WearerMeasure {
  torso: number;
  shoulders: number;
  /** Mean hip→knee→ankle, or null when the legs aren't reliably tracked. */
  legs: number | null;
}

/**
 * Suit scale that fits the wearer: geometric mean of the ratios the suit asks for
 * (profile.fit), e.g. torso + shoulders for the mermaid (her shoulders are ~30% wider than
 * a person's), torso + legs for Bonnie (short legs → feet must still reach the floor).
 */
export function fitScale(wearer: WearerMeasure, suit: SuitMeasure): number {
  let logSum = 0;
  let n = 0;
  for (const seg of suit.fit) {
    const w = wearer[seg];
    const m = suit[seg];
    if (w === null || m === null || w <= 0 || m <= 0) continue;
    logSum += Math.log(w / m);
    n++;
  }
  if (n === 0) return wearer.torso / suit.torso;
  return Math.exp(logSum / n);
}

/** Focal length in screen pixels for a three.js camera with this vertical FOV. */
export function focalPx(viewHeight: number, fovDeg: number): number {
  return viewHeight / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * Depth from apparent size: each segment's metric length (MediaPipe world landmarks, only
 * the part parallel to the image plane) vs. its length on screen. Weighted toward long
 * segments that face the camera. Returns null when nothing is usable.
 */
export function estimateDepth(frame: PoseFrame, mapping: CoverMapping, focal: number): number | null {
  let sum = 0;
  let weights = 0;
  for (const [a, b] of SEGMENTS) {
    const wa = frame.world[a];
    const wb = frame.world[b];
    const ia = frame.image[a];
    const ib = frame.image[b];
    if (!wa || !wb || !ia || !ib) continue;
    const vis = Math.min(reliabilityOf(wa), reliabilityOf(wb));
    if (vis < MIN_RELIABILITY) continue;
    const dx = wb.x - wa.x;
    const dy = wb.y - wa.y;
    const dz = wb.z - wa.z;
    const length = Math.hypot(dx, dy, dz);
    const inPlane = Math.hypot(dx, dy);
    if (length < 1e-3 || inPlane / length < MIN_IN_PLANE) continue;
    const A = videoToView(ia.x, ia.y, mapping);
    const B = videoToView(ib.x, ib.y, mapping);
    const px = Math.hypot(B.x - A.x, B.y - A.y);
    if (px < MIN_PX) continue;
    const c = inPlane / length;
    const w = c * c * vis * length;
    sum += w * ((focal * inPlane) / px);
    weights += w;
  }
  return weights > 0 ? sum / weights : null;
}

function midScreen(a: Landmark | undefined, b: Landmark | undefined, m: CoverMapping): { x: number; y: number } | null {
  if (!a || !b) return null;
  return videoToView((a.x + b.x) / 2, (a.y + b.y) / 2, m);
}

/**
 * Where the suit goes: hips on the wearer's hips (on screen), at the estimated depth,
 * scaled so the suit's torso matches the wearer's (MediaPipe's metric estimate). Any
 * error in MediaPipe's absolute scale cancels out, since depth and scale share it.
 */
export class RootPlacer {
  readonly position = new Vector3();
  scale = 1;
  depth = 3;
  /** False until the first good estimate. */
  valid = false;
  /** User multiplier on top of the automatic fit (?size=). */
  sizeMultiplier = 1;

  private readonly suit: SuitMeasure;
  /** Landmarks are already smoothed; depth (from noisy segment lengths) gets its own filter. */
  private readonly depthFilter = new OneEuroFilter(0.8, 0.4);

  constructor(suit: SuitMeasure) {
    this.suit = suit;
  }

  update(frame: PoseFrame, mapping: CoverMapping, viewWidth: number, viewHeight: number, fovDeg: number): boolean {
    const f = focalPx(viewHeight, fovDeg);
    const depth = estimateDepth(frame, mapping, f);
    const hips = midScreen(frame.image[POSE.LEFT_HIP], frame.image[POSE.RIGHT_HIP], mapping);
    const ls = frame.world[POSE.LEFT_SHOULDER];
    const rs = frame.world[POSE.RIGHT_SHOULDER];
    const lh = frame.world[POSE.LEFT_HIP];
    const rh = frame.world[POSE.RIGHT_HIP];
    if (!hips || !ls || !rs || !lh || !rh) return false;
    // No usable segment this frame (e.g. turning side-on): keep the last depth.
    if (depth === null && !this.valid) return false;

    const t = frame.timestampMs;
    if (depth !== null) this.depth = this.depthFilter.filter(depth, t);
    const torso = Math.hypot((ls.x + rs.x - lh.x - rh.x) / 2, (ls.y + rs.y - lh.y - rh.y) / 2, (ls.z + rs.z - lh.z - rh.z) / 2);
    const shoulders = Math.hypot(ls.x - rs.x, ls.y - rs.y, ls.z - rs.z);
    const scale = fitScale({ torso, shoulders, legs: wearerLegs(frame) }, this.suit) * this.sizeMultiplier;
    // Body size doesn't change: smooth scale very slowly once we have a value.
    this.scale = this.valid ? this.scale + 0.03 * (scale - this.scale) : scale;

    this.position.set(((hips.x - viewWidth / 2) / f) * this.depth, (-(hips.y - viewHeight / 2) / f) * this.depth, -this.depth);
    this.valid = true;
    return true;
  }

  reset(): void {
    this.valid = false;
    this.depthFilter.reset();
  }
}

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Mean thigh + shin length over the reliably tracked legs, or null. */
export function wearerLegs(frame: PoseFrame): number | null {
  const sides = [
    [POSE.LEFT_HIP, POSE.LEFT_KNEE, POSE.LEFT_ANKLE],
    [POSE.RIGHT_HIP, POSE.RIGHT_KNEE, POSE.RIGHT_ANKLE],
  ] as const;
  let sum = 0;
  let n = 0;
  for (const [h, k, a] of sides) {
    const H = frame.world[h];
    const K = frame.world[k];
    const A = frame.world[a];
    if (!H || !K || !A) continue;
    if (Math.min(reliabilityOf(H), reliabilityOf(K), reliabilityOf(A)) < MIN_RELIABILITY) continue;
    sum += dist(H, K) + dist(K, A);
    n++;
  }
  return n > 0 ? sum / n : null;
}
