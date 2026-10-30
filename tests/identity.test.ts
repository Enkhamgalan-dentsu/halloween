import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestDistance, judge, parseEnrollment, spread } from '../src/identity/matcher.ts';
import { faceVisible, headCrop, MIN_FACE_PX } from '../src/identity/head.ts';
import { makeFrame } from './synthetic.ts';

const rnd = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5);
const unit = (v: number[]) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const near = (base: number[], amount: number, seed: number) => { const r = rnd(seed); return unit(base.map((x) => x + r() * amount)); };

const me = unit(Array.from({ length: 128 }, rnd(1)));
const stranger = unit(Array.from({ length: 128 }, rnd(99)));
const enrollment = parseEnrollment({ version: 1, createdAt: 'x', descriptors: [near(me, 0.05, 2), near(me, 0.05, 3), near(me, 0.05, 4)] })!;

test('enrollment: needs ≥ 3 valid 128-number descriptors', () => {
  assert.ok(enrollment);
  assert.equal(parseEnrollment({ version: 1, descriptors: [me, me] }), null);
  assert.equal(parseEnrollment({ version: 2, descriptors: [me, me, me] }), null);
  assert.equal(parseEnrollment({ version: 1, descriptors: [me, me, [1, 2, 3]] }), null, 'bad entries dropped → too few');
  assert.equal(parseEnrollment(null), null);
});

test('matcher: my face matches, a stranger does not, the middle is "unsure"', () => {
  assert.equal(judge(bestDistance(near(me, 0.04, 7), enrollment)), 'match');
  assert.equal(judge(bestDistance(stranger, enrollment)), 'other');
  assert.equal(judge(0.55), 'unsure');
  assert.ok(spread(enrollment.descriptors) < 0.35);
});

test('head crop: centred on the face, square in pixels, sized from the eyes/ears', () => {
  const { frame } = makeFrame({ depth: 2 });
  const vw = 390, vh = 844; // synthetic frames are normalized to this view
  const head = headCrop(frame, vw, vh)!;
  const nose = frame.image[0]!;
  const cx = (head.rect.x + head.rect.w / 2) * vw;
  const cy = (head.rect.y + head.rect.h / 2) * vh;
  assert.ok(Math.abs(cx - nose.x * vw) < 1);
  assert.ok(cy < nose.y * vh, 'a bit above the nose (forehead)');
  assert.ok(Math.abs(head.rect.w * vw - head.rect.h * vh) < 1e-6, 'square in pixels');
  // A ~0.21 m face at 2 m on this view (focal ≈ 688 px) is ≈ 72 px tall.
  assert.ok(head.facePx > 55 && head.facePx < 95, `facePx ${head.facePx.toFixed(1)}`);
});

test('far away → face too small to bother; back view → no face check', () => {
  const far = makeFrame({ depth: 6 });
  assert.ok(headCrop(far.frame, 390, 844)!.facePx < MIN_FACE_PX);
  const back = makeFrame({ visibility: (i) => (i <= 10 ? 0.1 : 0.99) });
  assert.equal(faceVisible(back.frame), false);
  assert.equal(faceVisible(makeFrame().frame), true);
});
