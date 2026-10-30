/**
 * Reads pixels of the current camera frame for one person: the clothing fingerprint
 * (tracking/appearance.ts) and the head crop for face recognition (identity/).
 */
import type { PoseFrame } from './pose.ts';
import { POSE } from './pose.ts';
import { colorSignature } from './appearance.ts';

/** Normalized video-frame rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Torso box (shoulders–hips) of a pose, normalized. */
export function torsoRect(frame: PoseFrame): Rect | null {
  const pts = [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_HIP, POSE.RIGHT_HIP].map((i) => frame.image[i]);
  if (pts.some((p) => !p)) return null;
  const xs = pts.map((p) => p!.x);
  const ys = pts.map((p) => p!.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(Math.max(...xs) - x0, 0.04), h: Math.max(Math.max(...ys) - y0, 0.06) };
}

/** Shoulders → knees (or hips + a bit), the central part only (keep background out). */
export function appearanceRect(frame: PoseFrame): Rect | null {
  const t = torsoRect(frame);
  if (!t) return null;
  const knees = [frame.image[POSE.LEFT_KNEE], frame.image[POSE.RIGHT_KNEE]].filter((k) => k && (k.visibility ?? 1) > 0.5);
  const bottom = knees.length ? Math.max(...knees.map((k) => k!.y)) : t.y + t.h * 1.6;
  return { x: t.x + t.w * 0.15, y: t.y + t.h * 0.05, w: t.w * 0.7, h: Math.max(0.05, bottom - t.y - t.h * 0.05) };
}

export class PersonSampler {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;

  constructor() {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  /** Clothing fingerprint of one person (16×32 px sample). */
  fingerprint(video: HTMLVideoElement, frame: PoseFrame): Float32Array | null {
    const rect = appearanceRect(frame);
    if (!rect || !this.draw(video, rect, 16, 32)) return null;
    return colorSignature(this.ctx.getImageData(0, 0, 16, 32).data, 16, 32);
  }

  /**
   * Draw a normalized rect of the current frame into `target` (resized to its size).
   * Returns false if the rect is empty / off-frame.
   */
  drawInto(video: HTMLVideoElement, rect: Rect, target: HTMLCanvasElement): boolean {
    const ctx = target.getContext('2d');
    return ctx ? this.blit(video, rect, ctx, target.width, target.height) : false;
  }

  private draw(video: HTMLVideoElement, rect: Rect, w: number, h: number): boolean {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    return this.blit(video, rect, this.ctx, w, h);
  }

  private blit(video: HTMLVideoElement, r: Rect, ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return false;
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(1, r.x + r.w);
    const y1 = Math.min(1, r.y + r.h);
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return false;
    // Keep the requested framing even when the rect sticks out of the frame (pad black).
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const dx = ((x0 - r.x) / r.w) * w;
    const dy = ((y0 - r.y) / r.h) * h;
    const dw = ((x1 - x0) / r.w) * w;
    const dh = ((y1 - y0) / r.h) * h;
    ctx.drawImage(video, x0 * vw, y0 * vh, (x1 - x0) * vw, (y1 - y0) * vh, dx, dy, dw, dh);
    return true;
  }
}
