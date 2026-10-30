import type { PoseFrame } from '../tracking/pose.ts';
import type { PersonSampler } from '../tracking/sampler.ts';
import type { FaceEngine } from './face-engine.ts';
import { MIN_FACE_PX, faceVisible, headCrop } from './head.ts';
import { bestDistance, judge } from './matcher.ts';
import type { Enrollment, Verdict } from './matcher.ts';

export interface FaceCheck {
  verdict: Verdict | 'no-face';
  distance: number | null;
  /** Head crop centre (normalized) — for the debug overlay. */
  x: number;
  y: number;
}

/** Is this the wearer? Crops the head from the camera frame and compares the face. */
export class FaceChecker {
  private readonly crop = document.createElement('canvas');
  private readonly engine: FaceEngine;
  private readonly enrollment: Enrollment;
  private readonly sampler: PersonSampler;

  constructor(engine: FaceEngine, enrollment: Enrollment, sampler: PersonSampler) {
    this.engine = engine;
    this.enrollment = enrollment;
    this.sampler = sampler;
    this.crop.width = this.crop.height = 160;
  }

  /** Worth checking right now? (facing the camera, face big enough) */
  canCheck(video: HTMLVideoElement, frame: PoseFrame): boolean {
    if (!faceVisible(frame)) return false;
    const head = headCrop(frame, video.videoWidth, video.videoHeight);
    return !!head && head.facePx >= MIN_FACE_PX;
  }

  async check(video: HTMLVideoElement, frame: PoseFrame): Promise<FaceCheck | null> {
    const head = headCrop(frame, video.videoWidth, video.videoHeight);
    if (!head || !this.sampler.drawInto(video, head.rect, this.crop)) return null;
    const x = head.rect.x + head.rect.w / 2;
    const y = head.rect.y + head.rect.h / 2;
    const descriptor = await this.engine.describe(this.crop, 160);
    if (!descriptor) return { verdict: 'no-face', distance: null, x, y };
    const distance = bestDistance(descriptor, this.enrollment);
    return { verdict: judge(distance), distance, x, y };
  }
}
