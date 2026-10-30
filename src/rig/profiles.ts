import { Vector3 } from 'three';
import type { BoneKey } from './bones.ts';

export type SuitId = 'mermaid' | 'bonnie';
export const SUIT_IDS: readonly SuitId[] = ['mermaid', 'bonnie'];

/** A driven bone: its node, and the node its rest direction points toward. */
export interface BoneBinding {
  node: string;
  toward: string;
}

/** What the wearer is fitted by (geometric mean of the available ratios). */
export type FitSegment = 'torso' | 'shoulders' | 'legs';

export interface SuitProfile {
  id: SuitId;
  url: string;
  credit: { title: string; author: string; authorUrl: string; sourceUrl: string };
  bones: Partial<Record<BoneKey, BoneBinding>>;
  /** Sits on the wearer's hip joints: one node, or the midpoint of two. */
  anchor: readonly string[];
  /** Upper-arm roots [left, right] — shoulder line for torso length and width. */
  shoulders: readonly [string, string];
  /** [hip, knee, ankle] per side, for the 'legs' fit. */
  legs?: { left: readonly [string, string, string]; right: readonly [string, string, string] };
  fit: readonly FitSegment[];
}

/**
 * "Creepy Mermaid" by seenoise, CC BY 4.0 — rigged by tools/build-suit (identity rest
 * rotations, Mixamo-style names, tail chain instead of legs).
 */
export const MERMAID: SuitProfile = {
  id: 'mermaid',
  url: '/suits/mermaid.glb',
  credit: {
    title: 'Creepy Mermaid',
    author: 'seenoise',
    authorUrl: 'https://sketchfab.com/seenoise',
    sourceUrl: 'https://sketchfab.com/3d-models/creepy-mermaid-d30d4818353d4957ad23ff635a143abe',
  },
  bones: {
    hips: { node: 'mixamorigHips', toward: 'mixamorigSpine' },
    spine: { node: 'mixamorigSpine', toward: 'mixamorigSpine1' },
    spine1: { node: 'mixamorigSpine1', toward: 'mixamorigSpine2' },
    chest: { node: 'mixamorigSpine2', toward: 'mixamorigNeck' },
    neck: { node: 'mixamorigNeck', toward: 'mixamorigHead' },
    head: { node: 'mixamorigHead', toward: 'mixamorigHeadTop_End' },
    leftShoulder: { node: 'mixamorigLeftShoulder', toward: 'mixamorigLeftArm' },
    leftUpperArm: { node: 'mixamorigLeftArm', toward: 'mixamorigLeftForeArm' },
    leftLowerArm: { node: 'mixamorigLeftForeArm', toward: 'mixamorigLeftHand' },
    leftHand: { node: 'mixamorigLeftHand', toward: 'mixamorigLeftHandTip' },
    rightShoulder: { node: 'mixamorigRightShoulder', toward: 'mixamorigRightArm' },
    rightUpperArm: { node: 'mixamorigRightArm', toward: 'mixamorigRightForeArm' },
    rightLowerArm: { node: 'mixamorigRightForeArm', toward: 'mixamorigRightHand' },
    rightHand: { node: 'mixamorigRightHand', toward: 'mixamorigRightHandTip' },
    tail1: { node: 'Tail1', toward: 'Tail2' },
    tail2: { node: 'Tail2', toward: 'Tail3' },
    tail3: { node: 'Tail3', toward: 'Tail4' },
    tail4: { node: 'Tail4', toward: 'Tail5' },
    tail5: { node: 'Tail5', toward: 'Fin' },
    fin: { node: 'Fin', toward: 'FinEnd' },
  },
  anchor: ['mixamorigHips'],
  shoulders: ['mixamorigLeftArm', 'mixamorigRightArm'],
  // Her shoulders are ~30% wider than a person's for the same torso: fit both.
  fit: ['torso', 'shoulders'],
};

/**
 * "Reanimated Melted Chocolate Bonnie" by OrangeSauceu, CC BY 4.0 — comes rigged (FBX rig
 * with non-identity rest rotations, T-pose). Optimized by tools/build-suit (buildRigged).
 */
export const BONNIE: SuitProfile = {
  id: 'bonnie',
  url: '/suits/bonnie.glb',
  credit: {
    title: 'Reanimated Melted Chocolate Bonnie',
    author: 'OrangeSauceu',
    authorUrl: 'https://sketchfab.com/orangesauceu',
    sourceUrl: 'https://sketchfab.com/3d-models/reanimated-melted-chocolate-bonnie-452423bd24f6420d9c4c500bb1d5e44b',
  },
  bones: {
    hips: { node: 'Pelvis_Bn_04', toward: 'Neck_Bn_024' },
    // One spine bone: it takes the chest rotation (shoulders follow the chest).
    chest: { node: 'Spine_Bn_011', toward: 'Neck_Bn_024' },
    neck: { node: 'Neck_Bn_024', toward: 'Head_Bn_025' },
    head: { node: 'Head_Bn_025', toward: 'L_Ear_Bn_027' },
    leftShoulder: { node: 'L_Clavicle_Bn_012', toward: 'L_Arm_01_Bn_013' },
    leftUpperArm: { node: 'L_Arm_01_Bn_013', toward: 'L_Arm_02_Bn_014' },
    leftLowerArm: { node: 'L_Arm_02_Bn_014', toward: 'L_Arm_03_Bn_015' },
    leftHand: { node: 'L_Arm_03_Bn_015', toward: 'L_Finger03_01_Bn_020' },
    rightShoulder: { node: 'R_Clavicle_Bn_045', toward: 'R_Arm_01_Bn_046' },
    rightUpperArm: { node: 'R_Arm_01_Bn_046', toward: 'R_Arm_02_Bn_047' },
    rightLowerArm: { node: 'R_Arm_02_Bn_047', toward: 'R_Arm_03_Bn_048' },
    rightHand: { node: 'R_Arm_03_Bn_048', toward: 'R_Finger03_01_Bn_053' },
    leftUpperLeg: { node: 'L_Leg_01_Bn_06', toward: 'L_Leg_02_Bn_07' },
    leftLowerLeg: { node: 'L_Leg_02_Bn_07', toward: 'L_Leg_03_Bn_08' },
    rightUpperLeg: { node: 'R_Leg_01_Bn_09', toward: 'R_Leg_02_Bn_00' },
    rightLowerLeg: { node: 'R_Leg_02_Bn_00', toward: 'R_Leg_03_Bn_010' },
  },
  anchor: ['L_Leg_01_Bn_06', 'R_Leg_01_Bn_09'],
  shoulders: ['L_Arm_01_Bn_013', 'R_Arm_01_Bn_046'],
  legs: {
    left: ['L_Leg_01_Bn_06', 'L_Leg_02_Bn_07', 'L_Leg_03_Bn_08'],
    right: ['R_Leg_01_Bn_09', 'R_Leg_02_Bn_00', 'R_Leg_03_Bn_010'],
  },
  // Short legs + short torso for a person: fit torso AND legs → a tall, bulky animatronic
  // whose feet land on the wearer's feet.
  fit: ['torso', 'legs'],
};

export const PROFILES: Record<SuitId, SuitProfile> = { mermaid: MERMAID, bonnie: BONNIE };

/** Rest-pose facts the solver and placement need, derived from bind-pose positions. */
export interface RigAnalysis {
  /** Rest direction of every driven bone, in model space. */
  restDir: Partial<Record<BoneKey, Vector3>>;
  /** Anchor (hip) position in model space — the suit root is offset by −anchor. */
  anchor: Vector3;
  measure: SuitMeasure;
}

export interface SuitMeasure {
  /** Anchor → shoulder-line midpoint. */
  torso: number;
  shoulders: number;
  /** Mean hip→knee→ankle length, if the suit has legs. */
  legs: number | null;
  fit: readonly FitSegment[];
}

/** Pure: works from any "node name → rest world position" lookup (three.js or raw GLB). */
export function analyzeRig(profile: SuitProfile, positionOf: (node: string) => Vector3): RigAnalysis {
  const restDir: Partial<Record<BoneKey, Vector3>> = {};
  for (const [key, b] of Object.entries(profile.bones) as Array<[BoneKey, BoneBinding]>) {
    restDir[key] = positionOf(b.toward).sub(positionOf(b.node)).normalize();
  }
  const anchor = new Vector3();
  for (const n of profile.anchor) anchor.add(positionOf(n));
  anchor.multiplyScalar(1 / profile.anchor.length);
  const ls = positionOf(profile.shoulders[0]);
  const rs = positionOf(profile.shoulders[1]);
  const shoulderMid = ls.clone().add(rs).multiplyScalar(0.5);
  let legs: number | null = null;
  if (profile.legs) {
    const len = (chain: readonly [string, string, string]) => {
      const [h, k, a] = chain.map(positionOf) as [Vector3, Vector3, Vector3];
      return h.distanceTo(k) + k.distanceTo(a);
    };
    legs = (len(profile.legs.left) + len(profile.legs.right)) / 2;
  }
  return {
    restDir,
    anchor,
    measure: { torso: shoulderMid.distanceTo(anchor), shoulders: ls.distanceTo(rs), legs, fit: profile.fit },
  };
}
