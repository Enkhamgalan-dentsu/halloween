import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectQrCodes } from '../src/markers/finder.ts';
import { MARKER_GRIDS } from '../src/markers/marker-grids.ts';

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

interface Render {
  w: number; h: number; cx: number; cy: number;
  /** Module size in pixels. */
  module: number;
  rotate?: number;
  /** Horizontal foreshortening (cos of the turn angle). */
  squash?: number;
  blur?: number;
  noise?: number;
  dark?: number; light?: number;
  background?: 'texture' | 'stripes' | 'checker' | 'blotches';
  qr?: boolean;
  seed?: number;
}

/** A crop of a "camera image": textured clothes + a printed marker under some transform. */
function render(o: Render): Uint8Array {
  const rand = rng(o.seed ?? 7);
  const { w, h } = o;
  const img = new Float32Array(w * h);
  // background
  const blobs = Array.from({ length: 30 }, () => [rand() * w, rand() * h, 5 + rand() * 25, 30 + rand() * 120] as const);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 70 + 40 * (x / w) + 20 * Math.sin(y / 13);
      if (o.background === 'stripes') v = (Math.floor(x / 4) % 2 ? 40 : 190);
      if (o.background === 'checker') v = ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? 40 : 190);
      if (o.background === 'blotches' || o.background === 'texture') {
        for (const [bx, by, r, c] of blobs) if ((x - bx) ** 2 + (y - by) ** 2 < r * r) v = c;
      }
      img[y * w + x] = v;
    }
  }
  if (o.qr !== false) {
    const rows = MARKER_GRIDS.front.rows;
    const n = rows.length;
    const qz = 4;
    const cos = Math.cos(o.rotate ?? 0);
    const sin = Math.sin(o.rotate ?? 0);
    const sq = o.squash ?? 1;
    const dark = o.dark ?? 30;
    const light = o.light ?? 225;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        let inside = 0;
        for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
          const dx = x + ox - o.cx;
          const dy = y + oy - o.cy;
          const u = (cos * dx + sin * dy) / sq / o.module + n / 2; // module coords
          const v = (-sin * dx + cos * dy) / o.module + n / 2;
          if (u < -qz || v < -qz || u >= n + qz || v >= n + qz) continue;
          inside++;
          const iu = Math.floor(u);
          const iv = Math.floor(v);
          const isDark = iu >= 0 && iv >= 0 && iu < n && iv < n && rows[iv]![iu] === '#';
          acc += isDark ? dark : light;
        }
        if (inside > 0) img[y * w + x] = (img[y * w + x]! * (4 - inside) + acc) / 4;
      }
    }
  }
  // blur
  let cur = img;
  for (let pass = 0; pass < (o.blur ?? 0); pass++) {
    const next = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) {
          const xx = x + l, yy = y + k;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += cur[yy * w + xx]!; c++; }
        }
        next[y * w + x] = s / c;
      }
    }
    cur = next;
  }
  const out = new Uint8Array(w * h);
  const amp = o.noise ?? 0;
  for (let i = 0; i < w * h; i++) {
    const n = amp ? (rand() + rand() + rand() - 1.5) * amp : 0;
    out[i] = Math.max(0, Math.min(255, Math.round(cur[i]! + n)));
  }
  return out;
}

const found = (o: Render) => detectQrCodes(render(o), o.w, o.h);
const near = (hit: { cx: number; cy: number }, o: Render, tol: number) =>
  Math.hypot(hit.cx - o.cx, hit.cy - o.cy) < tol;

test('finds a frontal marker (close: 6 px modules) and locates its centre', () => {
  const o: Render = { w: 360, h: 420, cx: 170, cy: 190, module: 6, background: 'texture', noise: 6 };
  const hits = found(o);
  assert.equal(hits.length, 1);
  assert.ok(near(hits[0]!, o, 6), `centre ${hits[0]!.cx.toFixed(1)},${hits[0]!.cy.toFixed(1)}`);
  assert.ok(Math.abs(hits[0]!.module - 6) < 1.2);
});

test('far away: 2.4 px modules, slightly rotated, blurred and noisy', () => {
  const o: Render = { w: 200, h: 260, cx: 100, cy: 120, module: 2.4, rotate: 0.15, blur: 1, noise: 8, background: 'texture', seed: 3 };
  const hits = found(o);
  assert.equal(hits.length, 1);
  assert.ok(near(hits[0]!, o, 6));
});

test('rotated 45° (leaning)', () => {
  const o: Render = { w: 320, h: 320, cx: 160, cy: 160, module: 4, rotate: Math.PI / 4, background: 'texture', noise: 5 };
  assert.equal(found(o).length, 1);
});

test('turned ~45° away (foreshortened) and dim party lighting', () => {
  const o: Render = { w: 300, h: 320, cx: 150, cy: 150, module: 4.5, squash: 0.7, dark: 25, light: 120, blur: 1, noise: 6, background: 'texture', seed: 11 };
  assert.equal(found(o).length, 1);
});

test('turned ~55° away and dim (side-on guest)', () => {
  const o: Render = { w: 300, h: 320, cx: 150, cy: 150, module: 4, squash: 0.6, dark: 20, light: 110, blur: 1, noise: 5, background: 'texture', seed: 5 };
  assert.equal(found(o).length, 1);
});

test('no marker → nothing found (textures, stripes, checkerboard, blotches)', () => {
  for (const background of ['texture', 'stripes', 'checker', 'blotches'] as const) {
    for (const seed of [1, 2, 3]) {
      const o: Render = { w: 300, h: 360, cx: 0, cy: 0, module: 4, qr: false, background, noise: 8, seed };
      assert.equal(found(o).length, 0, `${background} #${seed}`);
    }
  }
});
