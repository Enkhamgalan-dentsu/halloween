/**
 * Canonical bone keys used by the solver → bone names in the suit GLB
 * (public/suits/mermaid.glb, built by tools/build-suit/). The humanoid part uses
 * Mixamo names; the mermaid has a tail chain instead of legs, driven by the wearer's
 * legs in Phase 2.
 *
 * Every bone's rest (bind) rotation is identity, so a bone's rest direction is simply
 * the offset to its child joint (see END_BONES for chain ends).
 */
import type { JointName } from './rest-pose.ts';

export const SUIT_URL = '/suits/mermaid.glb';

export const BONE_KEYS = [
  'hips',
  'spine',
  'spine1',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'tail1',
  'tail2',
  'tail3',
  'tail4',
  'tail5',
  'fin',
] as const;

export type BoneKey = (typeof BONE_KEYS)[number];

export const SUIT_BONES: Record<BoneKey, string> = {
  hips: 'mixamorigHips',
  spine: 'mixamorigSpine',
  spine1: 'mixamorigSpine1',
  chest: 'mixamorigSpine2',
  neck: 'mixamorigNeck',
  head: 'mixamorigHead',
  leftShoulder: 'mixamorigLeftShoulder',
  leftUpperArm: 'mixamorigLeftArm',
  leftLowerArm: 'mixamorigLeftForeArm',
  leftHand: 'mixamorigLeftHand',
  rightShoulder: 'mixamorigRightShoulder',
  rightUpperArm: 'mixamorigRightArm',
  rightLowerArm: 'mixamorigRightForeArm',
  rightHand: 'mixamorigRightHand',
  tail1: 'Tail1',
  tail2: 'Tail2',
  tail3: 'Tail3',
  tail4: 'Tail4',
  tail5: 'Tail5',
  fin: 'Fin',
};

/** Leaf joints (not skinned) that give the last bone of each chain its direction. */
export const END_BONES = {
  head: 'mixamorigHeadTop_End',
  leftHand: 'mixamorigLeftHandTip',
  rightHand: 'mixamorigRightHandTip',
  fin: 'FinEnd',
} as const;

/** Parent of each solver bone (null = root). Order of BONE_KEYS is parent-before-child. */
export const BONE_PARENT: Record<BoneKey, BoneKey | null> = {
  hips: null,
  spine: 'hips',
  spine1: 'spine',
  chest: 'spine1',
  neck: 'chest',
  head: 'neck',
  leftShoulder: 'chest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'chest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  tail1: 'hips',
  tail2: 'tail1',
  tail3: 'tail2',
  tail4: 'tail3',
  tail5: 'tail4',
  fin: 'tail5',
};

/** Joint a bone starts at, and the joint its rest direction points to. */
export const BONE_SEGMENT: Record<BoneKey, readonly [JointName, JointName]> = {
  hips: ['Hips', 'Spine'],
  spine: ['Spine', 'Spine1'],
  spine1: ['Spine1', 'Spine2'],
  chest: ['Spine2', 'Neck'],
  neck: ['Neck', 'Head'],
  head: ['Head', 'HeadTop_End'],
  leftShoulder: ['LeftShoulder', 'LeftArm'],
  leftUpperArm: ['LeftArm', 'LeftForeArm'],
  leftLowerArm: ['LeftForeArm', 'LeftHand'],
  leftHand: ['LeftHand', 'LeftHandTip'],
  rightShoulder: ['RightShoulder', 'RightArm'],
  rightUpperArm: ['RightArm', 'RightForeArm'],
  rightLowerArm: ['RightForeArm', 'RightHand'],
  rightHand: ['RightHand', 'RightHandTip'],
  tail1: ['Tail1', 'Tail2'],
  tail2: ['Tail2', 'Tail3'],
  tail3: ['Tail3', 'Tail4'],
  tail4: ['Tail4', 'Tail5'],
  tail5: ['Tail5', 'Fin'],
  fin: ['Fin', 'FinEnd'],
};

/** GLB node name of a joint. */
export function jointNodeName(joint: JointName): string {
  return /^(Tail\d|Fin|FinEnd)$/.test(joint) ? joint : `mixamorig${joint}`;
}
