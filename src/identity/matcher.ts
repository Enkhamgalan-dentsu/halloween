/**
 * The wearer's enrolled face (public/face/wearer.json, made with /tools/enroll/) and the
 * match decision. Pure — no DOM, no face-api — so it is unit tested.
 *
 * Descriptors are face-api's 128-number face embeddings; the same person is typically
 * < 0.45 apart (euclidean), different people > 0.6.
 */
export interface Enrollment {
  version: 1;
  model: 'face-api/face_recognition_model';
  createdAt: string;
  descriptors: number[][];
}

export type Verdict = 'match' | 'unsure' | 'other';

export interface MatchThresholds {
  /** Below → it's the wearer. */
  match: number;
  /** Above → definitely someone else (between = unsure: ignore). */
  other: number;
}

export const DEFAULT_THRESHOLDS: MatchThresholds = { match: 0.5, other: 0.62 };

export function parseEnrollment(json: unknown): Enrollment | null {
  if (!json || typeof json !== 'object') return null;
  const e = json as Partial<Enrollment>;
  if (e.version !== 1 || !Array.isArray(e.descriptors)) return null;
  const descriptors = e.descriptors.filter((d) => Array.isArray(d) && d.length === 128 && d.every((v) => Number.isFinite(v)));
  if (descriptors.length < 3) return null;
  return { version: 1, model: 'face-api/face_recognition_model', createdAt: String(e.createdAt ?? ''), descriptors };
}

export function euclidean(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number);
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Distance to the closest enrolled sample (robust to head angle / lighting variety). */
export function bestDistance(descriptor: ArrayLike<number>, enrollment: Enrollment): number {
  let best = Infinity;
  for (const d of enrollment.descriptors) best = Math.min(best, euclidean(descriptor, d));
  return best;
}

export function judge(distance: number, t: MatchThresholds = DEFAULT_THRESHOLDS): Verdict {
  if (distance < t.match) return 'match';
  if (distance > t.other) return 'other';
  return 'unsure';
}

/** Mean pairwise distance of the enrolled samples (enrollment quality check). */
export function spread(descriptors: number[][]): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < descriptors.length; i++) {
    for (let j = i + 1; j < descriptors.length; j++) {
      s += euclidean(descriptors[i]!, descriptors[j]!);
      n++;
    }
  }
  return n ? s / n : 0;
}
