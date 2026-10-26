/**
 * Mapping between normalized video coordinates (what MediaPipe returns, 0..1 in the
 * *video frame*) and CSS pixels on screen, where the video is shown with
 * `object-fit: cover` (cropped to fill). Forgetting the crop is the #1 cause of the
 * suit drifting off the body on tall phone screens.
 */
export interface CoverMapping {
  scale: number;
  offsetX: number;
  offsetY: number;
  videoWidth: number;
  videoHeight: number;
  mirrored: boolean;
}

export function coverMapping(
  videoWidth: number,
  videoHeight: number,
  viewWidth: number,
  viewHeight: number,
  mirrored = false,
): CoverMapping {
  const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
  return {
    scale,
    offsetX: (viewWidth - videoWidth * scale) / 2,
    offsetY: (viewHeight - videoHeight * scale) / 2,
    videoWidth,
    videoHeight,
    mirrored,
  };
}

export function videoToView(nx: number, ny: number, m: CoverMapping): { x: number; y: number } {
  const x = (m.mirrored ? 1 - nx : nx) * m.videoWidth * m.scale + m.offsetX;
  const y = ny * m.videoHeight * m.scale + m.offsetY;
  return { x, y };
}
