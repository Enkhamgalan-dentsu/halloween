import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WearerLock } from '../src/tracking/wearer-lock.ts';
import { colorSignature, similarity } from '../src/tracking/appearance.ts';
import { fakePose } from './helpers.ts';

/** A flat-colour "person" crop: top colour (shirt) over bottom colour (trousers). */
function person(top: [number, number, number], bottom: [number, number, number], noise = 0, seed = 1): Float32Array {
  const w = 16, h = 32;
  const px = new Uint8Array(w * h * 4);
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32 - 0.5) * noise;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = y < h / 2 ? top : bottom;
    const i = (y * w + x) * 4;
    px[i] = Math.max(0, Math.min(255, c[0] + rand()));
    px[i + 1] = Math.max(0, Math.min(255, c[1] + rand()));
    px[i + 2] = Math.max(0, Math.min(255, c[2] + rand()));
    px[i + 3] = 255;
  }
  return colorSignature(px, w, h);
}

const ME = person([20, 20, 24], [120, 30, 30], 20); // black top, red trousers
const OTHER = person([30, 80, 160], [40, 40, 45], 20, 9); // blue top, dark trousers

test('appearance: same person matches, different clothes do not', () => {
  assert.ok(similarity(ME, person([22, 22, 26], [125, 35, 28], 25, 5)) > 0.9);
  assert.ok(similarity(ME, OTHER) < 0.75);
});

test('nobody wears the costume until the marker is seen', () => {
  const lock = new WearerLock();
  const frames = [fakePose(0.5, 0.5, 0.25, 0.35), fakePose(0.3, 0.5)];
  assert.equal(lock.update(frames, 0, () => ME), -1, 'biggest, most central person is NOT picked');
  assert.equal(lock.state, 'searching');
  lock.markerOn(1, frames, 10, ME);
  assert.equal(lock.update(frames, 33, (i) => (i === 1 ? ME : OTHER)), 1);
});

test('locked: a bigger person walking past does not steal it', () => {
  const lock = new WearerLock();
  lock.markerOn(0, [fakePose(0.5, 0.5)], 0, ME);
  let t = 0;
  for (let k = 0; k < 20; k++) {
    t += 33;
    const passer = fakePose(0.1 + k * 0.04, 0.5, 0.3, 0.4); // walks across, in front
    const me = fakePose(0.5, 0.5);
    const idx = lock.update([passer, me], t, (i) => (i === 0 ? OTHER : ME));
    assert.equal(idx, 1, `frame ${k}: still me`);
  }
});

test('wearer leaves the frame → costume hidden, other people never get it', () => {
  const lock = new WearerLock();
  lock.markerOn(0, [fakePose(0.5, 0.5)], 0, ME);
  // I walk out; someone in different clothes steps into my spot. A couple of frames of
  // tolerance (blur/lighting), then they are rejected for good.
  let frame = 0;
  for (let t = 33; t < 2000; t += 33, frame++) {
    const idx = lock.update([fakePose(0.5, 0.5)], t, () => OTHER);
    if (frame >= 2) assert.equal(idx, -1, `frame ${frame}`);
  }
  assert.equal(lock.state, 'searching');
});

test('wearer comes back (no marker visible) → recognized by clothing, others ignored', () => {
  const lock = new WearerLock();
  lock.markerOn(0, [fakePose(0.5, 0.5)], 0, ME);
  for (let t = 33; t < 1500; t += 33) lock.update([], t, () => null);
  assert.equal(lock.state, 'searching');
  const idx = lock.update([fakePose(0.3, 0.5), fakePose(0.7, 0.5)], 1600, (i) => (i === 0 ? OTHER : person([24, 22, 25], [118, 33, 31], 22, 4)));
  assert.equal(idx, 1);
});

test('marker seen on someone else → switches to them (the real wearer)', () => {
  const lock = new WearerLock();
  const frames = [fakePose(0.3, 0.5), fakePose(0.7, 0.5)];
  lock.markerOn(0, frames, 0, OTHER);
  assert.equal(lock.markerOn(1, frames, 500, ME), true);
  assert.equal(lock.update(frames, 533, (i) => (i === 1 ? ME : OTHER)), 1);
});

test('two people overlapping: the fingerprint decides', () => {
  const lock = new WearerLock();
  lock.markerOn(0, [fakePose(0.5, 0.5)], 0, ME);
  const idx = lock.update([fakePose(0.52, 0.5), fakePose(0.48, 0.5)], 33, (i) => (i === 0 ? OTHER : ME));
  assert.equal(idx, 1);
});
