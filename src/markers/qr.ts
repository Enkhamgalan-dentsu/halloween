/**
 * Phase 4 — find the printed chest/back marker inside the camera frame.
 * Status: interface only. See docs/PLAN.md, Phase 4.
 *
 * Uses: (a) front/back disambiguation, (b) picking the wearer when several people
 * are in frame (the pose whose torso contains the marker).
 * Strategy: BarcodeDetector where supported (Chrome Android), jsQR fallback (iOS),
 * run every ~300–500 ms on a crop of the torso region only, never every frame.
 */
import type { MarkerSide } from '../config.ts';

/**
 * Exact payloads printed in the QR codes. All uppercase → QR alphanumeric mode →
 * version 3 at error correction H. Must match the paths handled in config.ts and netlify.toml.
 */
export const MARKER_URLS = {
  front: 'HTTPS://BOO.ANGAAHAI.COM/F',
  back: 'HTTPS://BOO.ANGAAHAI.COM/B',
} as const;

export interface MarkerHit {
  side: Exclude<MarkerSide, 'unknown'>;
  /** Marker centre, normalized to the video frame. */
  center: { x: number; y: number };
  timestampMs: number;
}

export interface MarkerDetector {
  detect(source: HTMLVideoElement, roi?: DOMRectReadOnly): Promise<MarkerHit | null>;
}
