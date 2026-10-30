/**
 * Colour "fingerprint" of a person: hue histogram (12 bins) for coloured pixels + 4
 * brightness bins for grey/black/white ones, separately for the top half (torso) and
 * bottom half (legs) of the crop. Lets the wearer be re-identified when the marker is
 * out of view, and keeps someone in different clothes from stealing the costume.
 */
const HUE_BINS = 12;
const GREY_BINS = 4;
export const REGION_BINS = HUE_BINS + GREY_BINS;
export const SIGNATURE_LENGTH = REGION_BINS * 2;

/** RGBA crop (rows top→bottom) → signature (two normalized histograms). */
export function colorSignature(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const sig = new Float32Array(SIGNATURE_LENGTH);
  for (let y = 0; y < h; y++) {
    const base = y < h / 2 ? 0 : REGION_BINS;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = (rgba[i] as number) / 255;
      const g = (rgba[i + 1] as number) / 255;
      const b = (rgba[i + 2] as number) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const s = max === 0 ? 0 : (max - min) / max;
      if (s > 0.25 && max > 0.15) {
        let hue: number;
        if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
        const bin = Math.min(HUE_BINS - 1, Math.floor((hue / 6) * HUE_BINS));
        sig[base + bin]! += 1;
      } else {
        sig[base + HUE_BINS + Math.min(GREY_BINS - 1, Math.floor(max * GREY_BINS))]! += 1;
      }
    }
  }
  for (const base of [0, REGION_BINS]) {
    let sum = 0;
    for (let k = 0; k < REGION_BINS; k++) sum += sig[base + k]!;
    if (sum > 0) for (let k = 0; k < REGION_BINS; k++) sig[base + k]! /= sum;
  }
  return sig;
}

/** Bhattacharyya coefficient averaged over the two regions: 1 = identical, ~0 = unrelated. */
export function similarity(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let k = 0; k < SIGNATURE_LENGTH; k++) s += Math.sqrt(a[k]! * b[k]!);
  return s / 2;
}

/** Slowly adapt a stored signature (lighting changes as the wearer moves around). */
export function blendSignature(into: Float32Array, next: Float32Array, rate = 0.15): void {
  for (let k = 0; k < SIGNATURE_LENGTH; k++) into[k] = into[k]! * (1 - rate) + next[k]! * rate;
}
