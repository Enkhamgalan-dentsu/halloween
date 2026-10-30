/**
 * Canonical bone keys driven by the solver. A suit maps the keys it has to its own node
 * names (profiles.ts); keys it doesn't map are simply not applied (e.g. the mermaid has a
 * tail instead of legs, Bonnie has legs instead of a tail and a single spine bone).
 */
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
  'leftUpperLeg',
  'leftLowerLeg',
  'rightUpperLeg',
  'rightLowerLeg',
  'tail1',
  'tail2',
  'tail3',
  'tail4',
  'tail5',
  'fin',
] as const;

export type BoneKey = (typeof BONE_KEYS)[number];

/** Solver hierarchy (parent before child in BONE_KEYS). */
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
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  tail1: 'hips',
  tail2: 'tail1',
  tail3: 'tail2',
  tail4: 'tail3',
  tail5: 'tail4',
  fin: 'tail5',
};
