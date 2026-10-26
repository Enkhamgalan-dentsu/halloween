import type { Landmark, PoseFrame } from '../src/tracking/pose.ts';

/** A standing person: torso centred at (cx, cy) with the given torso width/height. */
export function fakePose(cx: number, cy: number, w = 0.2, h = 0.3, t = 0): PoseFrame {
  const image: Landmark[] = Array.from({ length: 33 }, () => ({ x: cx, y: cy, z: 0, visibility: 0.9 }));
  image[11] = { x: cx + w / 2, y: cy - h / 2, z: 0, visibility: 0.9 }; // left shoulder (image right)
  image[12] = { x: cx - w / 2, y: cy - h / 2, z: 0, visibility: 0.9 };
  image[23] = { x: cx + w / 2, y: cy + h / 2, z: 0, visibility: 0.9 };
  image[24] = { x: cx - w / 2, y: cy + h / 2, z: 0, visibility: 0.9 };
  const world = image.map((p) => ({ ...p }));
  return { timestampMs: t, image, world };
}
