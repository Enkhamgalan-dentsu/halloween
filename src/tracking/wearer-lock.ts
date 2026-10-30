import type { PoseFrame } from './pose.ts';
import { torsoBox } from './select.ts';
import { blendSignature, similarity } from './appearance.ts';

export type LockState = 'searching' | 'locked';

export interface LockOptions {
  /** Max jump of the torso centre between camera frames (normalized), grows while unseen. */
  gate: number;
  /** Not seen for this long → stop showing the costume and search again. */
  lostAfterMs: number;
  /** Re-lock on appearance alone (no marker) only above this similarity… */
  reacquireSimilarity: number;
  /** …and only if it beats the next-best person by this margin. */
  reacquireMargin: number;
  /**
   * While locked, the person at the wearer's position must still roughly look like the
   * wearer (someone stepping into the spot you just left). Lenient: lighting changes.
   */
  keepSimilarity: number;
  /** Consecutive mismatching frames before the person at the spot is rejected. */
  mismatchFrames: number;
}

export const DEFAULT_LOCK: LockOptions = {
  gate: 0.12,
  lostAfterMs: 700,
  reacquireSimilarity: 0.86,
  reacquireMargin: 0.06,
  keepSimilarity: 0.6,
  mismatchFrames: 3,
};

/**
 * Who is the wearer? Nobody — until the printed QR marker is seen on someone's torso
 * (`markerOn`). From then on that person is followed frame to frame (torso position), with
 * the clothing fingerprint breaking ties when people overlap. If they leave the frame the
 * costume disappears; it comes back on the marker, or on a confident fingerprint match.
 * Pure logic — pixels are sampled by the caller (`appearance(i)` is only called when needed).
 */
export class WearerLock {
  state: LockState = 'searching';
  /** Last similarity computed (debug HUD). */
  lastSimilarity: number | null = null;
  lastMarkerMs = -Infinity;
  private readonly opts: LockOptions;
  private last: { x: number; y: number } | null = null;
  private lastSeenMs = -Infinity;
  private signature: Float32Array | null = null;
  private mismatches = 0;

  constructor(opts: Partial<LockOptions> = {}) {
    this.opts = { ...DEFAULT_LOCK, ...opts };
  }

  get hasFingerprint(): boolean {
    return this.signature !== null;
  }

  /** Index of the wearer in `frames`, or −1 (costume hidden). */
  update(frames: readonly PoseFrame[], nowMs: number, appearance: (i: number) => Float32Array | null): number {
    const boxes = frames.map((f) => torsoBox(f.image));

    if (this.state === 'locked' && this.last) {
      const since = Math.max(0, nowMs - this.lastSeenMs);
      const gate = this.opts.gate * (1 + since / 250);
      const within: number[] = [];
      boxes.forEach((b, i) => {
        if (b && Math.hypot(b.cx - this.last!.x, b.cy - this.last!.y) < gate) within.push(i);
      });
      let pick = -1;
      if (within.length === 1) pick = within[0]!;
      else if (within.length > 1) pick = this.bestByAppearance(within, appearance) ?? this.nearest(within, boxes);
      if (pick >= 0) {
        const s = this.score(pick, appearance);
        if (s !== null && s < this.opts.keepSimilarity) {
          // Same spot, different clothes: tolerate a couple of frames (blur, lighting).
          if (++this.mismatches >= this.opts.mismatchFrames) pick = -1;
        } else {
          this.mismatches = 0;
          // Confidently the wearer: let the fingerprint follow slow lighting changes.
          if (s !== null && s > 0.75 && within.length === 1 && this.signature) {
            const sig = appearance(pick);
            if (sig) blendSignature(this.signature, sig, 0.02);
          }
        }
      }
      if (pick >= 0) {
        this.seen(boxes[pick]!, nowMs);
        return pick;
      }
      if (nowMs - this.lastSeenMs > this.opts.lostAfterMs) this.state = 'searching';
      return -1;
    }

    // Searching: only a confident fingerprint match may bring the costume back without a marker.
    if (this.signature && frames.length > 0) {
      const scored = frames
        .map((_, i) => ({ i, s: this.score(i, appearance) }))
        .filter((x) => x.s !== null && boxes[x.i]) as Array<{ i: number; s: number }>;
      scored.sort((a, b) => b.s - a.s);
      const best = scored[0];
      const second = scored[1];
      if (best && best.s >= this.opts.reacquireSimilarity && (!second || best.s - second.s >= this.opts.reacquireMargin)) {
        this.state = 'locked';
        this.mismatches = 0;
        this.seen(boxes[best.i]!, nowMs);
        return best.i;
      }
    }
    return -1;
  }

  /**
   * The marker was found on candidate `i`'s torso: that's the wearer (switches if it was
   * someone else). Returns true if the wearer changed (caller resets smoothing).
   */
  markerOn(i: number, frames: readonly PoseFrame[], nowMs: number, signature: Float32Array | null): boolean {
    const box = frames[i] ? torsoBox(frames[i]!.image) : null;
    if (!box) return false;
    const changed =
      this.state !== 'locked' || !this.last || Math.hypot(box.cx - this.last.x, box.cy - this.last.y) > this.opts.gate;
    this.state = 'locked';
    this.seen(box, nowMs);
    this.lastMarkerMs = nowMs;
    this.mismatches = 0;
    if (signature) {
      if (!this.signature || changed) this.signature = signature.slice();
      else blendSignature(this.signature, signature);
    }
    return changed;
  }

  /** Forget everything (e.g. ?lock toggled, tests). */
  reset(): void {
    this.state = 'searching';
    this.last = null;
    this.signature = null;
    this.lastMarkerMs = -Infinity;
  }

  private seen(box: { cx: number; cy: number }, nowMs: number): void {
    this.last = { x: box.cx, y: box.cy };
    this.lastSeenMs = nowMs;
  }

  private score(i: number, appearance: (i: number) => Float32Array | null): number | null {
    if (!this.signature) return null;
    const sig = appearance(i);
    if (!sig) return null;
    const s = similarity(this.signature, sig);
    this.lastSimilarity = s;
    return s;
  }

  private bestByAppearance(indices: number[], appearance: (i: number) => Float32Array | null): number | null {
    let best: number | null = null;
    let bestScore = -Infinity;
    for (const i of indices) {
      const s = this.score(i, appearance);
      if (s !== null && s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return best;
  }

  private nearest(indices: number[], boxes: Array<{ cx: number; cy: number } | null>): number {
    let best = indices[0]!;
    let bestD = Infinity;
    for (const i of indices) {
      const b = boxes[i]!;
      const d = Math.hypot(b.cx - this.last!.x, b.cy - this.last!.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}
