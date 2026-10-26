import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneEuroFilter } from '../src/tracking/filters.ts';
import { PoseSmoother } from '../src/tracking/smoothing.ts';
import { WearerSelector, torsoBox } from '../src/tracking/select.ts';
import { fakePose } from './helpers.ts';

test('OneEuroFilter: constant input stays constant, step converges', () => {
  const f = new OneEuroFilter(1, 0);
  for (let t = 0; t < 10; t++) assert.equal(f.filter(0.3, t * 33), 0.3);
  let y = 0;
  let prev = 0.3;
  for (let t = 10; t < 100; t++) {
    y = f.filter(1, t * 33);
    assert.ok(y >= prev - 1e-12 && y <= 1, 'monotonic and bounded');
    prev = y;
  }
  assert.ok(y > 0.99);
});

test('PoseSmoother: first frame passes through, jitter is reduced, object reused', () => {
  const s = new PoseSmoother({ minCutoff: 1.2, beta: 6 });
  const first = s.apply(fakePose(0.5, 0.5, 0.2, 0.3, 0));
  assert.equal(first.image[11]!.x, 0.6);
  let rawVar = 0;
  let outVar = 0;
  for (let k = 1; k <= 200; k++) {
    const noise = (k % 2 ? 1 : -1) * 0.01;
    const out = s.apply(fakePose(0.5 + noise, 0.5, 0.2, 0.3, k * 33));
    assert.equal(out, first, 'same object every call');
    rawVar += noise ** 2;
    outVar += (out.image[11]!.x - 0.6) ** 2;
  }
  assert.ok(outVar < rawVar * 0.25, `smoothed variance ${outVar} vs raw ${rawVar}`);
});

test('torsoBox: centre and size', () => {
  const box = torsoBox(fakePose(0.4, 0.6, 0.2, 0.3).image)!;
  assert.ok(Math.abs(box.cx - 0.4) < 1e-9 && Math.abs(box.cy - 0.6) < 1e-9);
  assert.ok(Math.abs(box.w - 0.2) < 1e-9 && Math.abs(box.h - 0.3) < 1e-9);
});

test('WearerSelector: nobody → -1', () => {
  assert.equal(new WearerSelector().select([]), -1);
});

test('WearerSelector: prefers the bigger, more central person', () => {
  const sel = new WearerSelector();
  const small = fakePose(0.2, 0.5, 0.1, 0.15);
  const big = fakePose(0.5, 0.5, 0.25, 0.35);
  assert.equal(sel.select([small, big]), 1);
});

test('WearerSelector: someone a bit bigger walking past does not steal the suit', () => {
  const sel = new WearerSelector();
  const wearer = fakePose(0.5, 0.5, 0.2, 0.3);
  assert.equal(sel.select([wearer]), 0);
  const passerBy = fakePose(0.3, 0.5, 0.26, 0.36); // ~1.5x the area, close to centre
  assert.equal(sel.select([passerBy, fakePose(0.52, 0.5, 0.2, 0.3)]), 1);
});
