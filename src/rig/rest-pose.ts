import { Vector3 } from 'three';

/**
 * Joint names in the suit GLB, without the "mixamorig" prefix
 * (tools/build-suit/build-suit.js → JOINTS).
 */
export const JOINT_NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandTip',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandTip',
  'Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5', 'Fin', 'FinEnd',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

/** Rest-pose joint positions in metres, model space (hips at origin, Y up, facing +Z). */
export type RestPose = Record<JointName, Vector3>;

/**
 * Copy of the build report for public/suits/mermaid.glb — used by tests and as a
 * fallback. At runtime the rest pose is read from the loaded skeleton (suit.ts), and a
 * test checks these numbers still match the GLB.
 */
export const REST_JOINTS: Record<JointName, readonly [number, number, number]> = {
  Hips: [0, 0, 0],
  Spine: [0.004, 0.154, 0.05],
  Spine1: [0.008, 0.308, 0.085],
  Spine2: [0, 0.481, 0.046],
  Neck: [0, 0.643, 0.015],
  Head: [0.004, 0.72, 0.046],
  HeadTop_End: [0.008, 1.021, 0.1],
  LeftShoulder: [0.046, 0.589, 0.008],
  LeftArm: [0.254, 0.52, -0.004],
  LeftForeArm: [0.428, 0.237, -0.111],
  LeftHand: [0.532, -0.043, -0.065],
  LeftHandTip: [0.582, -0.325, -0.172],
  RightShoulder: [-0.046, 0.589, 0.008],
  RightArm: [-0.254, 0.52, -0.008],
  RightForeArm: [-0.436, 0.237, -0.042],
  RightHand: [-0.641, 0, 0.082],
  RightHandTip: [-0.699, -0.289, 0.039],
  Tail1: [0, -0.019, -0.008],
  Tail2: [0.012, -0.204, 0.023],
  Tail3: [0.035, -0.358, 0.066],
  Tail4: [0.014, -0.512, 0.043],
  Tail5: [-0.039, -0.666, -0.057],
  Fin: [-0.012, -0.79, -0.168],
  FinEnd: [-0.005, -1.229, -0.258],
};

export function restPoseFromTable(table: Record<JointName, readonly [number, number, number]> = REST_JOINTS): RestPose {
  const out = {} as RestPose;
  for (const name of JOINT_NAMES) out[name] = new Vector3(...table[name]);
  return out;
}
