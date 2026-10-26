/**
 * Phase 1 — body tracking with MediaPipe Pose Landmarker (@mediapipe/tasks-vision).
 * Status: interface only. See docs/PLAN.md, Phase 1.
 *
 * Implementation notes:
 *  - PoseLandmarker.createFromOptions with runningMode 'VIDEO', delegate 'GPU',
 *    numPoses 3 (pick the wearer — see markers/), wasm from /mediapipe/wasm and
 *    model from /models/pose_landmarker_{lite|full}.task (self-hosted, never a CDN).
 *  - Call detectForVideo() only when the video has a new frame
 *    (requestVideoFrameCallback when available), with strictly increasing timestamps.
 *  - `image` landmarks: normalized to the video frame (x right, y down, z ~ relative depth).
 *    `world` landmarks: metres, origin between the hips, x right / y DOWN / z toward camera
 *    from the camera's point of view. Convert to three.js (y up) in one place only.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** 0..1 likelihood the point is visible (not occluded by the body or something else). */
  visibility?: number;
  /** 0..1 likelihood the point is present in the frame at all (may be missing). */
  presence?: number;
}

export interface PoseFrame {
  timestampMs: number;
  /** 33 landmarks, normalized to the video frame. */
  image: Landmark[];
  /** 33 landmarks, metric, hip-centred. */
  world: Landmark[];
}

export interface PoseTracker {
  init(): Promise<void>;
  /** All people found in this frame (0..numPoses). */
  detect(video: HTMLVideoElement, timestampMs: number): PoseFrame[];
  close(): void;
}

/** MediaPipe BlazePose landmark indices. "LEFT" = the person's own left. */
export const POSE = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;
