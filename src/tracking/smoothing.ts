import { OneEuroFilter } from './filters.ts';
import type { Landmark, PoseFrame } from './pose.ts';

export interface SmoothingParams {
  /** Hz. Lower = steadier when still, more lag. */
  minCutoff: number;
  /** Lower = smoother during fast motion, more lag. Higher = snappier. */
  beta: number;
}

/** Starting values; tune on a phone with ?debug&mc=…&beta=… */
export const DEFAULT_SMOOTHING: SmoothingParams = { minCutoff: 1.2, beta: 6 };

const LANDMARK_COUNT = 33;
const VISIBILITY_ALPHA = 0.4;

class LandmarkSetFilter {
  readonly out: Landmark[];
  private readonly filters: OneEuroFilter[];
  private primed = false;

  constructor(p: SmoothingParams) {
    this.filters = Array.from({ length: LANDMARK_COUNT * 3 }, () => new OneEuroFilter(p.minCutoff, p.beta));
    this.out = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 0, presence: 0 }));
  }

  apply(src: readonly Landmark[], t: number): void {
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const s = src[i];
      const o = this.out[i];
      if (!s || !o) continue;
      o.x = this.filters[i * 3]!.filter(s.x, t);
      o.y = this.filters[i * 3 + 1]!.filter(s.y, t);
      o.z = this.filters[i * 3 + 2]!.filter(s.z, t);
      o.visibility = this.ema(o.visibility, s.visibility ?? 1);
      o.presence = this.ema(o.presence, s.presence ?? 0);
    }
    this.primed = true;
  }

  private ema(prev: number | undefined, v: number): number {
    return this.primed && prev !== undefined ? prev + VISIBILITY_ALPHA * (v - prev) : v;
  }

  reset(): void {
    for (const f of this.filters) f.reset();
    this.primed = false;
  }
}

/**
 * One Euro filter on every coordinate of every landmark (image and world).
 * Returns the same PoseFrame object every call — copy it if you need to keep it.
 */
export class PoseSmoother {
  private readonly image: LandmarkSetFilter;
  private readonly world: LandmarkSetFilter;
  private readonly frame: PoseFrame;

  constructor(params: SmoothingParams = DEFAULT_SMOOTHING) {
    this.image = new LandmarkSetFilter(params);
    this.world = new LandmarkSetFilter(params);
    this.frame = { timestampMs: 0, image: this.image.out, world: this.world.out };
  }

  apply(frame: PoseFrame): PoseFrame {
    this.frame.timestampMs = frame.timestampMs;
    this.image.apply(frame.image, frame.timestampMs);
    this.world.apply(frame.world, frame.timestampMs);
    return this.frame;
  }

  /** Call when the wearer is lost, so re-acquiring doesn't glide in from the old pose. */
  reset(): void {
    this.image.reset();
    this.world.reset();
  }
}
