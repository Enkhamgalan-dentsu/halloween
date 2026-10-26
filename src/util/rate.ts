/** Events per second over a rolling ~1 s window. */
export class RateCounter {
  hz = 0;
  private count = 0;
  private windowStart = -1;

  tick(nowMs: number): void {
    if (this.windowStart < 0) this.windowStart = nowMs;
    this.count++;
    const elapsed = nowMs - this.windowStart;
    if (elapsed >= 1000) {
      this.hz = (this.count * 1000) / elapsed;
      this.count = 0;
      this.windowStart = nowMs;
    }
  }
}

/** Exponential moving average, for noisy per-frame timings. */
export class Ema {
  value = 0;
  private primed = false;
  private readonly alpha: number;

  constructor(alpha = 0.1) {
    this.alpha = alpha;
  }

  push(x: number): number {
    this.value = this.primed ? this.value + this.alpha * (x - this.value) : x;
    this.primed = true;
    return this.value;
  }
}
