import type { Landmark, PoseFrame } from '../tracking/pose.ts';
import { videoToView } from '../util/viewport.ts';
import type { CoverMapping } from '../util/viewport.ts';

/** BlazePose connections (body + simplified face). */
const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // face
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  // torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // arms + hands
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // legs + feet
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

const COLOR_LEFT = '#ff9a3c'; // the person's left
const COLOR_RIGHT = '#58d0ff';
const COLOR_CENTRE = '#f4ece1';
const COLOR_OTHER = 'rgba(255, 255, 255, 0.35)';
const VISIBLE = 0.5;

function sideColor(a: number, b: number): string {
  if (a < 11 || b < 11) return COLOR_CENTRE;
  const left = a % 2 === 1;
  return left === (b % 2 === 1) ? (left ? COLOR_LEFT : COLOR_RIGHT) : COLOR_CENTRE;
}

/**
 * ?debug: draws the tracked skeleton on a 2D canvas above the 3D layer.
 * Orange = the person's LEFT side, blue = RIGHT. Faint = low visibility.
 * If the lines don't sit on the body, the cover mapping is wrong — fix that first.
 */
export class SkeletonOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'debug-canvas';
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(
    wearer: PoseFrame | null,
    others: readonly PoseFrame[],
    mapping: CoverMapping,
    markers: ReadonlyArray<{ x: number; y: number; ageMs: number }> = [],
  ): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const other of others) this.drawPose(other.image, mapping, COLOR_OTHER, 2);
    if (wearer) this.drawPose(wearer.image, mapping, null, 4);
    // Recently seen QR markers: a fading square.
    for (const m of markers) {
      const p = videoToView(m.x, m.y, mapping);
      ctx.globalAlpha = Math.max(0, 1 - m.ageMs / 1500);
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x - 18, p.y - 18, 36, 36);
    }
    ctx.globalAlpha = 1;
  }

  private drawPose(points: readonly Landmark[], m: CoverMapping, flat: string | null, width: number): void {
    const { ctx } = this;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';

    for (const [a, b] of CONNECTIONS) {
      const pa = points[a];
      const pb = points[b];
      if (!pa || !pb) continue;
      const vis = Math.min(pa.visibility ?? 1, pb.visibility ?? 1);
      const A = videoToView(pa.x, pa.y, m);
      const B = videoToView(pb.x, pb.y, m);
      ctx.globalAlpha = vis < VISIBLE ? 0.25 : 1;
      ctx.strokeStyle = flat ?? sideColor(a, b);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }

    ctx.fillStyle = flat ?? COLOR_CENTRE;
    for (const p of points) {
      const P = videoToView(p.x, p.y, m);
      ctx.globalAlpha = (p.visibility ?? 1) < VISIBLE ? 0.25 : 1;
      ctx.beginPath();
      ctx.arc(P.x, P.y, width, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
