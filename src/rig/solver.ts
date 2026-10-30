import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { POSE } from '../tracking/pose.ts';
import type { PoseFrame } from '../tracking/pose.ts';
import { BONE_KEYS } from './bones.ts';
import type { BoneKey } from './bones.ts';
import type { Facing } from './facing.ts';
import { reliabilityOf, swapLeftRight, toThree, trust, visibilityOf } from './landmarks.ts';

export interface SolverOptions {
  /** Radians of idle tail sway (0 disables — tests). */
  swayAmplitude: number;
  /** Seconds per sway cycle. */
  swayPeriod: number;
  /**
   * Head pitch relative to the chest (radians, + = look down). The face only drives head
   * yaw and roll: pitch from nose-vs-ears is biased differently on every face.
   */
  headPitch: number;
  /** 'hang' = fin keeps its sculpted pose below the tail; 'trail' = along the floor behind. */
  finMode: 'hang' | 'trail';
  /** Max head rotation relative to the chest (radians). */
  headLimit: number;
  /** How far the fin tips down below horizontal when trailing on the floor. */
  finDrop: number;
}

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  swayAmplitude: 0.07,
  swayPeriod: 2.6,
  headPitch: 0,
  finMode: 'hang',
  headLimit: 1.2,
  finDrop: 0.45,
};

export interface SolvedPose {
  /**
   * Model-space rotation of each bone AWAY FROM ITS REST POSE (identity = rest). The suit
   * turns these into local bone rotations through its own hierarchy and rest rotations
   * (suit.ts), so the same solver drives any rig.
   */
  delta: Record<BoneKey, Quaternion>;
  /** 0..1 — how much the torso landmarks can be trusted (visibility or presence). */
  confidence: number;
  /** True when MediaPipe's left/right labels were swapped to match `facing`. */
  swapped: boolean;
}

const DOWN = new Vector3(0, -1, 0);

/** Used when a suit doesn't bind a bone (its delta is computed but never applied). */
const FALLBACK_REST_DIR: Record<BoneKey, readonly [number, number, number]> = {
  hips: [0, 1, 0], spine: [0, 1, 0], spine1: [0, 1, 0], chest: [0, 1, 0], neck: [0, 1, 0], head: [0, 1, 0],
  leftShoulder: [1, 0, 0], leftUpperArm: [0.5, -0.85, 0], leftLowerArm: [0.3, -0.95, 0], leftHand: [0.2, -1, 0],
  rightShoulder: [-1, 0, 0], rightUpperArm: [-0.5, -0.85, 0], rightLowerArm: [-0.3, -0.95, 0], rightHand: [-0.2, -1, 0],
  leftUpperLeg: [0, -1, 0], leftLowerLeg: [0, -1, 0], rightUpperLeg: [0, -1, 0], rightLowerLeg: [0, -1, 0],
  tail1: [0, -1, 0], tail2: [0, -1, 0], tail3: [0, -1, 0], tail4: [0, -1, 0], tail5: [0, -1, 0], fin: [0, -1, 0],
};

/** Where hidden limbs relax to, in the parent's (chest / hips) frame. */
const RELAXED_ARM = { left: new Vector3(0.18, -1, 0.04).normalize(), right: new Vector3(-0.18, -1, 0.04).normalize() };
const RELAXED_LEG = { left: new Vector3(0.04, -1, 0).normalize(), right: new Vector3(-0.04, -1, 0).normalize() };
const IDENTITY = new Quaternion();
const SIDES = [
  { side: 'left', s: POSE.LEFT_SHOULDER, e: POSE.LEFT_ELBOW, w: POSE.LEFT_WRIST, i: POSE.LEFT_INDEX, p: POSE.LEFT_PINKY, upper: 'leftUpperArm', lower: 'leftLowerArm', hand: 'leftHand', shoulder: 'leftShoulder' },
  { side: 'right', s: POSE.RIGHT_SHOULDER, e: POSE.RIGHT_ELBOW, w: POSE.RIGHT_WRIST, i: POSE.RIGHT_INDEX, p: POSE.RIGHT_PINKY, upper: 'rightUpperArm', lower: 'rightLowerArm', hand: 'rightHand', shoulder: 'rightShoulder' },
] as const;
const LEGS = [
  { side: 'left', h: POSE.LEFT_HIP, k: POSE.LEFT_KNEE, a: POSE.LEFT_ANKLE, upper: 'leftUpperLeg', lower: 'leftLowerLeg' },
  { side: 'right', h: POSE.RIGHT_HIP, k: POSE.RIGHT_KNEE, a: POSE.RIGHT_ANKLE, upper: 'rightUpperLeg', lower: 'rightLowerLeg' },
] as const;
const TAILS = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'] as const;

function quatRecord(): Record<BoneKey, Quaternion> {
  const r = {} as Record<BoneKey, Quaternion>;
  for (const k of BONE_KEYS) r[k] = new Quaternion();
  return r;
}

/**
 * Landmarks → bone rotations, as model-space deltas from each bone's rest pose. Works for
 * any rig given each bone's rest direction (profiles.ts → analyzeRig).
 *
 *  - hips / chest: orthonormal basis from hip line / shoulder line + spine-up vector
 *  - spine, spine1, neck: slerp between their neighbours
 *  - head: ears + nose basis (front view only), clamped relative to the chest
 *  - arms / legs: swing each bone from its (parent-rotated) rest direction to the observed
 *    one; hidden limbs relax (arms hang, legs straight) instead of springing to the rest pose
 *  - tail: the wearer's legs as a *delta from standing*, applied on top of the curved
 *    rest tail (keeps the S-curve), plus a slow idle sway
 *  - fin: trails along the floor behind the feet
 *
 * Output objects are reused between calls.
 */
export class PoseSolver {
  readonly out: SolvedPose = { delta: quatRecord(), confidence: 0, swapped: false };
  private readonly opts: SolverOptions;
  private readonly restDir = {} as Record<BoneKey, Vector3>;
  private readonly P: Vector3[] = Array.from({ length: 33 }, () => new Vector3());
  private readonly vis: number[] = Array.from({ length: 33 }, () => 0);
  private readonly rel: number[] = Array.from({ length: 33 }, () => 0);
  private swapped = false;

  // scratch
  private readonly m = new Matrix4();
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly v4 = new Vector3();
  private readonly v5 = new Vector3();
  private readonly vAim = new Vector3();
  private readonly relaxed = new Vector3();
  private readonly q1 = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly q3 = new Quaternion();
  private readonly qHead = new Quaternion();
  private readonly e = new Euler();

  constructor(restDir: Partial<Record<BoneKey, Vector3>>, opts: Partial<SolverOptions> = {}) {
    this.opts = { ...DEFAULT_SOLVER_OPTIONS, ...opts };
    for (const key of BONE_KEYS) {
      this.restDir[key] = (restDir[key]?.clone() ?? new Vector3(...FALLBACK_REST_DIR[key])).normalize();
    }
  }

  solve(frame: PoseFrame, facing: Facing, timeMs: number): SolvedPose {
    const { P, vis, rel, out } = this;
    const W = out.delta;
    for (let i = 0; i < 33; i++) {
      const l = frame.world[i];
      if (l) toThree(l, P[i] as Vector3);
      vis[i] = visibilityOf(l);
      rel[i] = reliabilityOf(l);
    }

    this.fixLabels(facing);
    out.swapped = this.swapped;
    out.confidence =
      (this.at(POSE.LEFT_SHOULDER, rel) + this.at(POSE.RIGHT_SHOULDER, rel) +
        this.at(POSE.LEFT_HIP, rel) + this.at(POSE.RIGHT_HIP, rel)) / 4;

    // --- torso
    const hipMid = this.mid(POSE.LEFT_HIP, POSE.RIGHT_HIP, new Vector3());
    const shoulderMid = this.mid(POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, new Vector3());
    const up = this.v1.copy(shoulderMid).sub(hipMid).normalize();
    this.basis(this.v2.copy(this.p(POSE.LEFT_HIP)).sub(this.p(POSE.RIGHT_HIP)), up, W.hips);
    this.basis(this.v2.copy(this.p(POSE.LEFT_SHOULDER)).sub(this.p(POSE.RIGHT_SHOULDER)), up, W.chest);
    W.spine.slerpQuaternions(W.hips, W.chest, 1 / 3);
    W.spine1.slerpQuaternions(W.hips, W.chest, 2 / 3);

    // --- head
    this.solveHead(facing);
    W.neck.slerpQuaternions(W.chest, W.head, 0.5);

    // --- arms (position reliability: from behind, arms are "self-occluded" but well located)
    for (const side of SIDES) {
      W[side.shoulder].copy(W.chest);
      const ve = trust(this.at(side.e, rel));
      const vw = trust(this.at(side.w, rel));
      const relaxed = this.relaxed.copy(RELAXED_ARM[side.side]).applyQuaternion(W.chest);
      this.aim(W[side.shoulder], side.upper, this.dir(side.s, side.e), ve, relaxed, W[side.upper]);
      // A hidden forearm / hand just continues the bone before it.
      this.boneDir(side.upper, W[side.upper], this.relaxed);
      this.aim(W[side.upper], side.lower, this.dir(side.e, side.w), Math.min(ve, vw), this.relaxed, W[side.lower]);
      this.boneDir(side.lower, W[side.lower], this.relaxed);
      const handMid = this.mid(side.i, side.p, this.v4);
      this.aim(W[side.lower], side.hand, this.v2.copy(handMid).sub(this.p(side.w)),
        Math.min(vw, trust(Math.min(this.at(side.i, rel), this.at(side.p, rel)))), this.relaxed, W[side.hand]);
    }

    // --- legs (bipeds) — computed for every suit, applied only where the suit has legs
    for (const leg of LEGS) {
      const vk = trust(this.at(leg.k, rel));
      const va = trust(this.at(leg.a, rel));
      const relaxed = this.relaxed.copy(RELAXED_LEG[leg.side]).applyQuaternion(W.hips);
      this.aim(W.hips, leg.upper, this.dir(leg.h, leg.k), vk, relaxed, W[leg.upper]);
      this.boneDir(leg.upper, W[leg.upper], this.relaxed);
      this.aim(W[leg.upper], leg.lower, this.dir(leg.k, leg.a), Math.min(vk, va), this.relaxed, W[leg.lower]);
    }

    // --- tail from legs (mermaid)
    this.solveTail(hipMid, timeMs);
    return out;
  }

  /** Make the body's forward direction agree with `facing` by swapping MediaPipe's L/R labels. */
  private fixLabels(facing: Facing): void {
    const across = this.v1.copy(this.p(POSE.LEFT_SHOULDER)).sub(this.p(POSE.RIGHT_SHOULDER))
      .add(this.p(POSE.LEFT_HIP)).sub(this.p(POSE.RIGHT_HIP));
    const up = this.mid(POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, this.v2)
      .sub(this.mid(POSE.LEFT_HIP, POSE.RIGHT_HIP, this.v3));
    const forward = across.cross(up);
    const len = forward.length();
    const towardCamera = len > 1e-6 ? forward.z / len : 0;
    // Side-on (|towardCamera| small) is ambiguous: keep the last decision.
    if (Math.abs(towardCamera) > 0.3) this.swapped = towardCamera > 0 !== (facing === 'front');
    if (this.swapped) {
      swapLeftRight(this.P);
      swapLeftRight(this.vis);
      swapLeftRight(this.rel);
    }
  }

  private solveHead(facing: Facing): void {
    const { P, vis, opts } = this;
    const W = this.out.delta;
    const faceTrust = facing === 'front'
      ? Math.min(trust(this.at(POSE.NOSE, vis)), trust(this.at(POSE.LEFT_EAR, vis)), trust(this.at(POSE.RIGHT_EAR, vis)))
      : 0;
    const chestPitched = this.qHead.copy(W.chest).multiply(this.q2.setFromEuler(this.e.set(opts.headPitch, 0, 0, 'XYZ')));
    if (faceTrust <= 0) {
      W.head.copy(chestPitched);
      return;
    }
    const x = this.v2.copy(P[POSE.LEFT_EAR] as Vector3).sub(P[POSE.RIGHT_EAR] as Vector3).normalize();
    const earMid = this.mid(POSE.LEFT_EAR, POSE.RIGHT_EAR, this.v3);
    const f = this.v4.copy(P[POSE.NOSE] as Vector3).sub(earMid);
    const z = f.addScaledVector(x, -f.dot(x)).normalize();
    const y = this.v1.crossVectors(z, x);
    this.m.makeBasis(x, y, z);
    this.q1.setFromRotationMatrix(this.m);
    // Keep only yaw (turn) and half the roll (tilt) of the face relative to the chest.
    this.q3.copy(W.chest).invert().multiply(this.q1);
    this.e.setFromQuaternion(this.q3, 'YXZ');
    this.q3.setFromEuler(this.e.set(opts.headPitch, this.e.y, this.e.z * 0.5, 'YXZ'));
    this.q1.copy(W.chest).multiply(this.q3);
    W.head.slerpQuaternions(chestPitched, this.q1, faceTrust);
    // Clamp: never twist the head further than a neck could.
    this.q3.copy(W.chest).rotateTowards(W.head, opts.headLimit);
    W.head.copy(this.q3);
  }

  private solveTail(hipMid: Vector3, timeMs: number): void {
    const { rel: vis, opts } = this; // position reliability (presence counts: legs from behind)
    const W = this.out.delta;
    const hipsInv = this.q3.copy(W.hips).invert();

    const kneeMid = this.mid(POSE.LEFT_KNEE, POSE.RIGHT_KNEE, new Vector3());
    const ankleMid = this.mid(POSE.LEFT_ANKLE, POSE.RIGHT_ANKLE, new Vector3());
    const wKnee = trust(Math.min(this.at(POSE.LEFT_KNEE, vis), this.at(POSE.RIGHT_KNEE, vis)));
    const wAnkle = trust(Math.min(this.at(POSE.LEFT_ANKLE, vis), this.at(POSE.RIGHT_ANKLE, vis)));

    // Leg directions in the hips frame → rotation away from "standing straight".
    // (slerpQuaternions copies its first argument into `this` first — never alias the target.)
    const d1 = this.v2.copy(kneeMid).sub(hipMid).applyQuaternion(hipsInv).normalize();
    const thigh = new Quaternion().setFromUnitVectors(DOWN, d1);
    const delta1 = new Quaternion().slerpQuaternions(IDENTITY, thigh, wKnee);
    const d2 = this.v2.copy(ankleMid).sub(kneeMid).applyQuaternion(hipsInv).normalize();
    const shin = new Quaternion().setFromUnitVectors(DOWN, d2);
    const delta2 = new Quaternion().slerpQuaternions(delta1, shin, wKnee * wAnkle);

    const deltas = [
      new Quaternion().slerpQuaternions(IDENTITY, delta1, 0.5),
      delta1,
      new Quaternion().slerpQuaternions(delta1, delta2, 0.5),
      delta2,
      delta2,
    ];
    const t = (timeMs / 1000) * ((2 * Math.PI) / opts.swayPeriod);
    TAILS.forEach((key, i) => {
      const a = opts.swayAmplitude;
      const sway = this.q2.setFromEuler(this.e.set(0.5 * a * Math.sin(0.7 * t - 0.9 * i), 0, a * Math.sin(t - 0.7 * i), 'XYZ'));
      W[key].copy(W.hips).multiply(deltas[i] as Quaternion).multiply(sway);
    });

    if (opts.finMode === 'hang') {
      W.fin.copy(W.tail5); // keeps its sculpted angle below the tail
      return;
    }

    // Fin: trail along the floor, behind the feet (or behind the hips if feet are hidden).
    const forward = this.v1.set(0, 0, 1).applyQuaternion(W.hips);
    forward.y = 0;
    const feetTrust = trust(Math.min(this.at(POSE.LEFT_HEEL, vis), this.at(POSE.RIGHT_HEEL, vis),
      this.at(POSE.LEFT_FOOT_INDEX, vis), this.at(POSE.RIGHT_FOOT_INDEX, vis)));
    const toes = this.mid(POSE.LEFT_FOOT_INDEX, POSE.RIGHT_FOOT_INDEX, this.v2)
      .sub(this.mid(POSE.LEFT_HEEL, POSE.RIGHT_HEEL, this.v3));
    toes.y = 0;
    if (forward.lengthSq() > 1e-6) forward.normalize();
    if (toes.lengthSq() > 1e-6) forward.lerp(toes.normalize(), feetTrust);
    const trail = forward.lengthSq() > 1e-6 ? forward.normalize().negate() : forward.set(0, 0, -1);
    trail.y = -opts.finDrop;
    this.aim(W.tail5, 'fin', trail, 1, trail, W.fin);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * out = parent delta, then swung so the bone's (parent-rotated) rest direction points
   * along `target`. With weight < 1 the direction blends toward `relaxed` (both model
   * space), so hidden limbs hang naturally instead of snapping to the rig's rest pose
   * (Bonnie's rest pose is a T-pose).
   */
  private aim(parent: Quaternion, key: BoneKey, target: Vector3, weight: number, relaxed: Vector3, out: Quaternion): void {
    const want = this.vAim;
    const hasTarget = target.lengthSq() > 1e-10 && weight > 0;
    if (hasTarget) want.copy(target).normalize().multiplyScalar(weight).addScaledVector(this.v5.copy(relaxed).normalize(), 1 - weight);
    else want.copy(relaxed);
    if (want.lengthSq() < 1e-10) want.copy(relaxed);
    const d = this.v3.copy(this.restDir[key]).applyQuaternion(parent).normalize();
    const swing = this.q1.setFromUnitVectors(d, want.normalize());
    out.copy(swing).multiply(parent);
  }

  /** Current model-space direction of a solved bone. */
  private boneDir(key: BoneKey, delta: Quaternion, out: Vector3): Vector3 {
    return out.copy(this.restDir[key]).applyQuaternion(delta);
  }

  /** Rotation whose X axis follows `xRaw` and Y axis is exactly `y` (unit). */
  private basis(xRaw: Vector3, y: Vector3, out: Quaternion): void {
    const z = this.v3.crossVectors(xRaw, y).normalize();
    const x = this.v4.crossVectors(y, z);
    this.m.makeBasis(x, y, z);
    out.setFromRotationMatrix(this.m);
  }

  private p(i: number): Vector3 {
    return this.P[i] as Vector3;
  }

  private at(i: number, arr: number[]): number {
    return arr[i] ?? 0;
  }

  private mid(a: number, b: number, out: Vector3): Vector3 {
    return out.copy(this.p(a)).add(this.p(b)).multiplyScalar(0.5);
  }

  private dir(a: number, b: number): Vector3 {
    return this.v2.copy(this.p(b)).sub(this.p(a));
  }
}
