/**
 * Face-gated wearer lock: decides WHEN to run a face check and on WHOM, and feeds the
 * (async) verdicts into the WearerLock.
 *
 *  - searching: check one face-visible person every SEARCH_MS (round-robin) until one
 *    matches the enrolled wearer → lock.confirm().
 *  - locked: re-check the wearer every LOCKED_MS (keeps the lock honest) and now and then
 *    someone else (in case the lock drifted onto the wrong person). Two confident
 *    "that's not the wearer" verdicts on the locked person → lock.reject().
 *
 * Between checks — and whenever the wearer turns away — the lock keeps following by
 * continuity + clothing fingerprint (wearer-lock.ts), so faces only need to be seen now
 * and then.
 */
import type { PoseFrame } from '../tracking/pose.ts';
import { torsoBox } from '../tracking/select.ts';
import type { WearerLock } from '../tracking/wearer-lock.ts';
import type { FaceCheck } from './face-check.ts';

export interface FaceCheckerLike {
  canCheck(video: HTMLVideoElement, frame: PoseFrame): boolean;
  check(video: HTMLVideoElement, frame: PoseFrame): Promise<FaceCheck | null>;
}

export interface FaceLockHooks {
  /** Clothing fingerprint of a person (stored on confirm). */
  fingerprint(frame: PoseFrame): Float32Array | null;
  /** The lock moved to a different person: reset smoothing so the suit doesn't glide over. */
  onWearerChanged(): void;
  /** The locked person turned out not to be the wearer. */
  onRejected(): void;
  /** Clock (same as the frame timestamps). */
  now(): number;
}

export interface FaceLockOptions {
  searchMs: number;
  lockedMs: number;
  othersMs: number;
  /** Max torso-centre travel (normalized) between scan start and result. */
  gate: number;
  /** Consecutive "other" verdicts on the locked person before dropping them. */
  rejectAfter: number;
}

export const DEFAULT_FACE_LOCK: FaceLockOptions = {
  searchMs: 200,
  lockedMs: 1500,
  othersMs: 2500,
  gate: 0.24,
  rejectAfter: 2,
};

export interface FaceMark {
  x: number;
  y: number;
  verdict: FaceCheck['verdict'];
  t: number;
}

const centreOf = (frame: PoseFrame | undefined) => {
  const box = frame ? torsoBox(frame.image) : null;
  return box ? { x: box.cx, y: box.cy } : null;
};

export class FaceLock {
  /** Recent check results (debug overlay). */
  readonly marks: FaceMark[] = [];
  last: FaceCheck | null = null;
  lastMatchMs = -Infinity;
  checks = 0;
  private busy = false;
  private cursor = 0;
  private lastCheckMs = -Infinity;
  private lastOthersMs = -Infinity;
  private otherStreak = 0;
  private errors = 0;
  private latest: readonly PoseFrame[] = [];
  private readonly opts: FaceLockOptions;
  private readonly checker: FaceCheckerLike;
  private readonly lock: WearerLock;
  private readonly video: HTMLVideoElement;
  private readonly hooks: FaceLockHooks;

  constructor(
    checker: FaceCheckerLike,
    lock: WearerLock,
    video: HTMLVideoElement,
    hooks: FaceLockHooks,
    opts: Partial<FaceLockOptions> = {},
  ) {
    this.checker = checker;
    this.lock = lock;
    this.video = video;
    this.hooks = hooks;
    this.opts = { ...DEFAULT_FACE_LOCK, ...opts };
  }

  get pending(): boolean {
    return this.busy;
  }

  /** Call every camera frame, after `lock.update()` returned `wearer` (−1 = nobody). */
  tick(frames: readonly PoseFrame[], wearer: number, nowMs: number): void {
    this.latest = frames;
    if (this.busy || frames.length === 0) return;
    const k = this.pick(frames, wearer, nowMs);
    if (k < 0) return;
    this.lastCheckMs = nowMs;
    void this.run(frames[k]!, k === wearer);
  }

  /** Whom to check now, or −1. */
  private pick(frames: readonly PoseFrame[], wearer: number, nowMs: number): number {
    const checkable = frames.map((_, k) => k).filter((k) => this.checker.canCheck(this.video, frames[k]!));
    if (checkable.length === 0) return -1;
    if (wearer < 0) {
      if (nowMs - this.lastCheckMs < this.opts.searchMs) return -1;
      return checkable[this.cursor++ % checkable.length]!;
    }
    const others = checkable.filter((k) => k !== wearer);
    if (others.length > 0 && nowMs - this.lastOthersMs > this.opts.othersMs && nowMs - this.lastCheckMs > this.opts.searchMs) {
      this.lastOthersMs = nowMs;
      return others[this.cursor++ % others.length]!;
    }
    // After a doubtful "other" verdict, look again soon instead of in LOCKED_MS.
    const wait = this.otherStreak > 0 ? this.opts.searchMs : this.opts.lockedMs;
    if (checkable.includes(wearer) && nowMs - this.lastCheckMs > wait) return wearer;
    return -1;
  }

  private async run(frame: PoseFrame, wasWearer: boolean): Promise<void> {
    this.busy = true;
    const start = centreOf(frame);
    try {
      const res = await this.checker.check(this.video, frame);
      if (res) this.apply(res, start, wasWearer);
    } catch (err) {
      if (this.errors++ < 3) console.error('[face] check failed', err);
    } finally {
      this.busy = false;
    }
  }

  private apply(res: FaceCheck, start: { x: number; y: number } | null, wasWearer: boolean): void {
    const now = this.hooks.now();
    this.checks++;
    this.last = res;
    this.marks.push({ x: res.x, y: res.y, verdict: res.verdict, t: now });
    if (this.marks.length > 8) this.marks.shift();
    if (!start || (res.verdict !== 'match' && res.verdict !== 'other')) return;

    if (res.verdict === 'match') {
      this.otherStreak = 0;
      this.lastMatchMs = now;
      const k = this.nearest(start);
      if (k < 0) return;
      const frame = this.latest[k]!;
      if (this.lock.confirm(k, this.latest, now, this.hooks.fingerprint(frame))) this.hooks.onWearerChanged();
      return;
    }
    // 'other': only matters if it was the person we're (still) locked on.
    const pos = this.lock.position;
    if (!wasWearer || !pos || Math.hypot(start.x - pos.x, start.y - pos.y) > this.opts.gate) return;
    if (++this.otherStreak >= this.opts.rejectAfter) {
      this.otherStreak = 0;
      this.lock.reject(now);
      this.hooks.onRejected();
    }
  }

  /** The person (in the latest frame) closest to where the checked person was. */
  private nearest(p: { x: number; y: number }): number {
    let best = -1;
    let bestD = this.opts.gate;
    this.latest.forEach((f, k) => {
      const c = centreOf(f);
      if (!c) return;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  }
}
