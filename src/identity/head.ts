import { POSE } from '../tracking/pose.ts';
import type { PoseFrame } from '../tracking/pose.ts';
import type { Rect } from '../tracking/sampler.ts';

/** Face must be at least this tall (camera pixels) to be worth recognizing. */
export const MIN_FACE_PX = 34;

export interface HeadCrop {
  /** Square (in pixels) crop around the face, normalized video coords. */
  rect: Rect;
  /** Estimated face height in camera pixels. */
  facePx: number;
}

const vis = (frame: PoseFrame, i: number) => frame.image[i]?.visibility ?? 0;

/** Is this person facing the camera enough for face recognition? */
export function faceVisible(frame: PoseFrame, min = 0.6): boolean {
  return vis(frame, POSE.NOSE) > min && vis(frame, 2) > min && vis(frame, 5) > min; // nose + both eyes
}

/**
 * Square crop around a person's face from the BODY landmarks (nose, eyes, ears,
 * shoulders), so faces are checked per person without a face-detector pass over the whole
 * frame. Generous margin: the face detector runs inside the crop.
 */
export function headCrop(frame: PoseFrame, videoW: number, videoH: number): HeadCrop | null {
  const nose = frame.image[POSE.NOSE];
  const le = frame.image[POSE.LEFT_EAR];
  const re = frame.image[POSE.RIGHT_EAR];
  const ley = frame.image[2];
  const rey = frame.image[5];
  const ls = frame.image[POSE.LEFT_SHOULDER];
  const rs = frame.image[POSE.RIGHT_SHOULDER];
  if (!nose || !ley || !rey) return null;
  const px = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * videoW, (a.y - b.y) * videoH);
  // Face height (brow→chin, ~0.21 m) ≈ 3.3× eye spacing ≈ 1.5× ear spacing ≈ 0.55× shoulders.
  // Max of the estimates: turning the head shrinks eye/ear spacing, not the face.
  const estimates = [px(ley, rey) * 3.3];
  if (le && re) estimates.push(px(le, re) * 1.5);
  if (ls && rs) estimates.push(px(ls, rs) * 0.55);
  const facePx = Math.max(...estimates);
  const side = facePx * 2.2; // margin: the face detector runs inside this crop
  const cx = nose.x * videoW;
  const cy = nose.y * videoH - facePx * 0.1;
  return {
    rect: { x: (cx - side / 2) / videoW, y: (cy - side / 2) / videoH, w: side / videoW, h: side / videoH },
    facePx,
  };
}
