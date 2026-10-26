/**
 * One Euro filter (Casiez et al., 2012): low jitter when still, low lag when moving.
 * minCutoff ↓ = smoother when still; beta ↑ = less lag on fast motion.
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;

  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filter(x: number, timestampMs: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = timestampMs;
      return x;
    }
    const dt = Math.max((timestampMs - this.tPrev) / 1000, 1e-3);
    const dx = (x - this.xPrev) / dt;
    const aD = smoothingFactor(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = smoothingFactor(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = timestampMs;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

function smoothingFactor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
