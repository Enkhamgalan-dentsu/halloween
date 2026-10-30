/**
 * QR "finder pattern" detector — finds QR codes (without decoding them) in a grayscale
 * image. iOS Safari has no BarcodeDetector, so this is what tells the app which person
 * wears the costume marker. Pure: no DOM, runs in tests on synthetic images.
 *
 * Classic approach (as in ZXing): adaptive threshold → scan rows for the 1:1:3:1:1
 * dark/light run pattern of a finder "eye" → confirm vertically → merge repeated hits →
 * look for three eyes of similar size forming a right isosceles triangle.
 */

export interface FinderPattern {
  x: number;
  y: number;
  /** Estimated module (QR "pixel") size in image pixels. */
  module: number;
  /** How many scan rows confirmed it. */
  count: number;
}

export interface QrHit {
  /** Centre of the QR code, image pixels. */
  cx: number;
  cy: number;
  module: number;
  /** Approximate side length of the code, image pixels. */
  size: number;
}

/** Adaptive threshold: 1 = dark. Local mean over a window ~1/8 of the image. */
export function binarize(gray: Uint8Array, w: number, h: number): Uint8Array {
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x] as number;
      integral[(y + 1) * W + x + 1] = (integral[y * W + x + 1] as number) + rowSum;
    }
  }
  const r = Math.max(6, Math.round(Math.min(w, h) / 8));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum =
        (integral[y1 * W + x1] as number) - (integral[y0 * W + x1] as number) -
        (integral[y1 * W + x0] as number) + (integral[y0 * W + x0] as number);
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x] as number;
      out[y * w + x] = v < mean * 0.9 && mean - v > 5 ? 1 : 0;
    }
  }
  return out;
}

function ratioOk(s: readonly number[]): boolean {
  let total = 0;
  for (const c of s) {
    if (c === 0) return false;
    total += c;
  }
  if (total < 7) return false;
  const m = total / 7;
  const v = m * 0.6; // generous: blur + perspective
  return (
    Math.abs(m - (s[0] as number)) < v &&
    Math.abs(m - (s[1] as number)) < v &&
    Math.abs(3 * m - (s[2] as number)) < 3 * v &&
    Math.abs(m - (s[3] as number)) < v &&
    Math.abs(m - (s[4] as number)) < v
  );
}

/**
 * From `start` (inside the centre dark run) count the 5 runs along one axis.
 * Returns [centre, total] or null.
 */
function crossCheck(dark: (i: number) => boolean, start: number, len: number, maxCount: number, originalTotal: number): [number, number] | null {
  const s = [0, 0, 0, 0, 0];
  let i = start;
  while (i >= 0 && dark(i)) { s[2]!++; i--; }
  if (i < 0) return null;
  while (i >= 0 && !dark(i) && s[1]! <= maxCount) { s[1]!++; i--; }
  if (i < 0 || s[1]! > maxCount) return null;
  while (i >= 0 && dark(i) && s[0]! <= maxCount) { s[0]!++; i--; }
  if (s[0]! > maxCount) return null;
  i = start + 1;
  while (i < len && dark(i)) { s[2]!++; i++; }
  if (i === len) return null;
  while (i < len && !dark(i) && s[3]! <= maxCount) { s[3]!++; i++; }
  if (i === len || s[3]! > maxCount) return null;
  while (i < len && dark(i) && s[4]! <= maxCount) { s[4]!++; i++; }
  if (s[4]! > maxCount) return null;
  const total = s.reduce((a, b) => a + b, 0);
  // Vertical and horizontal sizes may differ by up to ~1.9× (marker turned ~55° away).
  if (Math.max(total, originalTotal) / Math.min(total, originalTotal) > 1.9) return null;
  if (!ratioOk(s)) return null;
  return [i - s[4]! - s[3]! - s[2]! / 2, total];
}

export function findFinderPatterns(bin: Uint8Array, w: number, h: number): FinderPattern[] {
  const found: FinderPattern[] = [];
  const at = (x: number, y: number) => bin[y * w + x] === 1;

  const handle = (endX: number, y: number, s: number[]) => {
    const total = s.reduce((a, b) => a + b, 0);
    const cx0 = endX - s[4]! - s[3]! - s[2]! / 2;
    const col = Math.round(cx0);
    const v = crossCheck((i) => at(col, i), y, h, s[2]! * 2, total);
    if (!v) return;
    const cy = v[0];
    const row = Math.round(cy);
    const hz = crossCheck((i) => at(i, row), col, w, s[2]! * 2, total);
    if (!hz) return;
    const cx = hz[0];
    const module = (hz[1] + v[1]) / 14;
    for (const p of found) {
      if (Math.abs(p.x - cx) <= p.module * 1.5 && Math.abs(p.y - cy) <= p.module * 1.5 && Math.abs(p.module - module) <= Math.max(1, p.module * 0.5)) {
        const n = p.count + 1;
        p.x = (p.x * p.count + cx) / n;
        p.y = (p.y * p.count + cy) / n;
        p.module = (p.module * p.count + module) / n;
        p.count = n;
        return;
      }
    }
    found.push({ x: cx, y: cy, module, count: 1 });
  };

  for (let y = 0; y < h; y++) {
    const s = [0, 0, 0, 0, 0];
    let state = 0;
    for (let x = 0; x < w; x++) {
      if (at(x, y)) {
        if ((state & 1) === 1) state++;
        s[state]!++;
      } else if ((state & 1) === 0) {
        if (state === 4) {
          if (ratioOk(s)) {
            handle(x, y, s);
            s.fill(0);
            state = 0;
          } else {
            s[0] = s[2]!; s[1] = s[3]!; s[2] = s[4]!; s[3] = 1; s[4] = 0;
            state = 3;
          }
        } else {
          state++;
          s[state]!++;
        }
      } else {
        s[state]!++;
      }
    }
    if (state === 4 && ratioOk(s)) handle(w, y, s);
  }
  return found;
}

/** Three finder patterns of similar size forming a right isosceles triangle = a QR code. */
export function groupQrCodes(patterns: FinderPattern[], maxCodes = 2): QrHit[] {
  const ps = patterns.filter((p) => p.count >= 2).sort((a, b) => b.count - a.count).slice(0, 12);
  const used = new Set<FinderPattern>();
  const hits: QrHit[] = [];
  const d = (a: FinderPattern, b: FinderPattern) => Math.hypot(a.x - b.x, a.y - b.y);
  for (let n = 0; n < maxCodes; n++) {
    let best: { score: number; hit: QrHit; ps: FinderPattern[] } | null = null;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        for (let k = j + 1; k < ps.length; k++) {
          const tri = [ps[i]!, ps[j]!, ps[k]!];
          if (tri.some((p) => used.has(p))) continue;
          const mods = tri.map((p) => p.module);
          if (Math.max(...mods) / Math.min(...mods) > 1.8) continue;
          const sides = [
            { len: d(tri[1]!, tri[2]!), ends: [tri[1]!, tri[2]!] },
            { len: d(tri[0]!, tri[2]!), ends: [tri[0]!, tri[2]!] },
            { len: d(tri[0]!, tri[1]!), ends: [tri[0]!, tri[1]!] },
          ].sort((a, b) => a.len - b.len);
          const [a, b, c] = sides as [typeof sides[0], typeof sides[0], typeof sides[0]];
          if (a.len <= 0) continue;
          const legRatio = b.len / a.len;
          const rightAngle = c.len / Math.hypot(a.len, b.len);
          const m = (mods[0]! + mods[1]! + mods[2]!) / 3;
          const legModules = (a.len + b.len) / 2 / m;
          // legRatio up to 1.9: the marker turned up to ~55° away foreshortens one leg.
          if (legRatio > 1.9 || rightAngle < 0.82 || rightAngle > 1.18 || legModules < 10 || legModules > 70) continue;
          const score = (legRatio - 1) + Math.abs(rightAngle - 1) * 2;
          if (!best || score < best.score) {
            const [e0, e1] = c.ends as [FinderPattern, FinderPattern];
            best = {
              score,
              ps: tri,
              hit: { cx: (e0.x + e1.x) / 2, cy: (e0.y + e1.y) / 2, module: m, size: (a.len + b.len) / 2 + 7 * m },
            };
          }
        }
      }
    }
    if (!best) break;
    for (const p of best.ps) used.add(p);
    hits.push(best.hit);
  }
  return hits;
}

/** Grayscale image → QR codes found (centres in image pixels). */
export function detectQrCodes(gray: Uint8Array, w: number, h: number): QrHit[] {
  return groupQrCodes(findFinderPatterns(binarize(gray, w, h), w, h));
}

/** RGBA (canvas ImageData) → luma. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    out[i] = ((rgba[j] as number) * 77 + (rgba[j + 1] as number) * 150 + (rgba[j + 2] as number) * 29) >> 8;
  }
  return out;
}
