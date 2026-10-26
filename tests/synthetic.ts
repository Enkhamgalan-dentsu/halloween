import { Quaternion, Vector3 } from 'three';
import type { Landmark, PoseFrame } from '../src/tracking/pose.ts';
import { coverMapping } from '../src/util/viewport.ts';
import type { CoverMapping } from '../src/util/viewport.ts';
import { focalPx } from '../src/rig/placement.ts';
import { swapLeftRight } from '../src/rig/landmarks.ts';

/** A standing adult in three.js axes: hip-mid origin, facing +Z, own left on +X, metres. */
const BASE: Array<[number, number, number]> = [
  [0, 0.68, 0.1], [0.02, 0.71, 0.09], [0.035, 0.71, 0.09], [0.05, 0.71, 0.085],
  [-0.02, 0.71, 0.09], [-0.035, 0.71, 0.09], [-0.05, 0.71, 0.085],
  [0.075, 0.69, 0.01], [-0.075, 0.69, 0.01], [0.025, 0.64, 0.09], [-0.025, 0.64, 0.09],
  [0.19, 0.5, 0], [-0.19, 0.5, 0], [0.22, 0.22, 0], [-0.22, 0.22, 0],
  [0.24, -0.03, 0.02], [-0.24, -0.03, 0.02], [0.25, -0.11, 0], [-0.25, -0.11, 0],
  [0.24, -0.12, 0.03], [-0.24, -0.12, 0.03], [0.22, -0.09, 0.04], [-0.22, -0.09, 0.04],
  [0.1, 0, 0], [-0.1, 0, 0], [0.1, -0.44, 0.01], [-0.1, -0.44, 0.01],
  [0.1, -0.86, 0], [-0.1, -0.86, 0], [0.1, -0.9, -0.05], [-0.1, -0.9, -0.05],
  [0.1, -0.92, 0.12], [-0.1, -0.92, 0.12],
];

export interface SyntheticOptions {
  /** Turn the whole body about the vertical axis (radians, + = toward their left). */
  yaw?: number;
  /** Distance from the camera to the hips (m). */
  depth?: number;
  /** Modify joints (three.js axes, before yaw). */
  edit?: (j: Vector3[]) => void;
  /** Simulate MediaPipe labelling a back view as if it were a front view. */
  mislabel?: boolean;
  visibility?: (i: number) => number;
  presence?: (i: number) => number;
  view?: { width: number; height: number; fov: number };
}

export const VIEW = { width: 390, height: 844, fov: 63 };

export function makeFrame(o: SyntheticOptions = {}): { frame: PoseFrame; mapping: CoverMapping } {
  const view = o.view ?? VIEW;
  const depth = o.depth ?? 3;
  const j = BASE.map((p) => new Vector3(...p));
  o.edit?.(j);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), o.yaw ?? 0);
  for (const p of j) p.applyQuaternion(q);

  const f = focalPx(view.height, view.fov);
  const vis = (i: number) => o.visibility?.(i) ?? 0.99;
  const pres = (i: number) => o.presence?.(i) ?? 0.99;
  const world: Landmark[] = j.map((p, i) => ({ x: p.x, y: -p.y, z: -p.z, visibility: vis(i), presence: pres(i) }));
  const image: Landmark[] = j.map((p, i) => {
    const cz = p.z - depth; // camera space, camera looks down -Z
    return { x: (view.width / 2 + (f * p.x) / -cz) / view.width, y: (view.height / 2 - (f * p.y) / -cz) / view.height, z: 0, visibility: vis(i), presence: pres(i) };
  });
  if (o.mislabel) {
    swapLeftRight(world);
    swapLeftRight(image);
  }
  return {
    frame: { timestampMs: 0, image, world },
    mapping: coverMapping(view.width, view.height, view.width, view.height),
  };
}

export function yawQuat(yaw: number): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
}
