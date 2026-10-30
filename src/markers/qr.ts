/**
 * Phase 4 — find the printed chest/back marker on people in the camera frame.
 *
 *  - Every person's torso is cropped from the video (canvas) and searched for a QR code
 *    with our own finder-pattern detector (finder.ts) — works on iOS, which has no
 *    BarcodeDetector. That decides WHO the wearer is (tracking/wearer-lock.ts).
 *  - Where BarcodeDetector exists (Android Chrome) the code is also decoded: /F or /B
 *    tells the app whether the guest sees the wearer's front or back.
 *  - The same crops give the clothing fingerprint (tracking/appearance.ts).
 */
import type { PoseFrame } from '../tracking/pose.ts';
import { POSE } from '../tracking/pose.ts';
import { colorSignature } from '../tracking/appearance.ts';
import { detectQrCodes, toGray } from './finder.ts';
import type { QrHit } from './finder.ts';

/**
 * Exact payloads printed in the QR codes. All uppercase → QR alphanumeric mode →
 * version 3 at error correction H. Must match the paths handled in config.ts and netlify.toml.
 */
export const MARKER_URLS = {
  front: 'HTTPS://BOO.ANGAAHAI.COM/F',
  back: 'HTTPS://BOO.ANGAAHAI.COM/B',
} as const;

/** Largest crop side for marker search (px). Bigger = finds smaller/farther codes, slower. */
const MAX_SCAN_SIDE = 420;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MarkerFound {
  /** Marker centre, normalized to the video frame (for the debug overlay). */
  x: number;
  y: number;
  /** Decoded side, when the browser can decode (BarcodeDetector). */
  side: 'front' | 'back' | null;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}

/** Torso box of a pose (normalized video coords), widened so a chest/back marker fits. */
export function markerSearchRect(frame: PoseFrame): Rect | null {
  const pts = [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_HIP, POSE.RIGHT_HIP].map((i) => frame.image[i]);
  if (pts.some((p) => !p)) return null;
  const xs = pts.map((p) => p!.x);
  const ys = pts.map((p) => p!.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const w = Math.max(x1 - x0, 0.04);
  const h = Math.max(y1 - y0, 0.06);
  return { x: x0 - w * 0.35, y: y0 - h * 0.15, w: w * 1.7, h: h * 1.25 };
}

/** Shoulders → knees (or hips + a bit), for the clothing fingerprint. */
export function appearanceRect(frame: PoseFrame): Rect | null {
  const base = markerSearchRect(frame);
  if (!base) return null;
  const knees = [frame.image[POSE.LEFT_KNEE], frame.image[POSE.RIGHT_KNEE]].filter((k) => k && (k.visibility ?? 1) > 0.5);
  const bottom = knees.length ? Math.max(...knees.map((k) => k!.y)) : base.y + base.h * 1.4;
  // narrower than the marker box: keep background out of the fingerprint
  return { x: base.x + base.w * 0.2, y: base.y + base.h * 0.1, w: base.w * 0.6, h: Math.max(0.05, bottom - base.y - base.h * 0.1) };
}

export class MarkerScanner {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly barcode: BarcodeDetectorLike | null;
  private decoding = false;

  constructor() {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    const BD = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    let detector: BarcodeDetectorLike | null = null;
    try {
      detector = BD ? new BD({ formats: ['qr_code'] }) : null;
    } catch {
      detector = null;
    }
    this.barcode = detector;
  }

  get canDecode(): boolean {
    return this.barcode !== null;
  }

  /**
   * Look for a marker on one person. Synchronous finder search; if the browser can decode,
   * a decode runs in the background and calls `onSide` with front/back.
   */
  scan(video: HTMLVideoElement, frame: PoseFrame, onSide?: (side: 'front' | 'back') => void): MarkerFound | null {
    const rect = markerSearchRect(frame);
    if (!rect) return null;
    const crop = this.crop(video, rect, MAX_SCAN_SIDE);
    if (!crop) return null;
    const hits: QrHit[] = detectQrCodes(toGray(crop.image.data, crop.w, crop.h), crop.w, crop.h);
    const hit = hits[0];
    if (!hit) return null;
    if (this.barcode && onSide && !this.decoding) {
      this.decoding = true;
      this.barcode
        .detect(crop.image)
        .then((codes) => {
          for (const c of codes) {
            if (c.rawValue.toUpperCase() === MARKER_URLS.front) onSide('front');
            else if (c.rawValue.toUpperCase() === MARKER_URLS.back) onSide('back');
          }
        })
        .catch(() => {})
        .finally(() => {
          this.decoding = false;
        });
    }
    return {
      x: crop.rx + (hit.cx / crop.w) * crop.rw,
      y: crop.ry + (hit.cy / crop.h) * crop.rh,
      side: null,
    };
  }

  /** Clothing fingerprint of one person (16×32 px sample). */
  fingerprint(video: HTMLVideoElement, frame: PoseFrame): Float32Array | null {
    const rect = appearanceRect(frame);
    if (!rect) return null;
    const crop = this.crop(video, rect, 32, 16, 32);
    return crop ? colorSignature(crop.image.data, crop.w, crop.h) : null;
  }

  /** Draw a normalized rect of the current video frame into the canvas and read it back. */
  private crop(video: HTMLVideoElement, r: Rect, maxSide: number, fixedW?: number, fixedH?: number) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const rx = Math.max(0, r.x);
    const ry = Math.max(0, r.y);
    const rw = Math.min(1, r.x + r.w) - rx;
    const rh = Math.min(1, r.y + r.h) - ry;
    if (rw <= 0.01 || rh <= 0.01) return null;
    const sx = rx * vw;
    const sy = ry * vh;
    const sw = rw * vw;
    const sh = rh * vh;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const w = fixedW ?? Math.max(8, Math.round(sw * scale));
    const h = fixedH ?? Math.max(8, Math.round(sh * scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    return { image: this.ctx.getImageData(0, 0, w, h), w, h, rx, ry, rw, rh };
  }
}
