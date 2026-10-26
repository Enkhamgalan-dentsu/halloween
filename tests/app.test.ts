import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.ts';
import { coverMapping, videoToView } from '../src/util/viewport.ts';

test('config: marker side from path and query', () => {
  assert.equal(readConfig('/F', '').side, 'front');
  assert.equal(readConfig('/b', '').side, 'back');
  assert.equal(readConfig('/', '?s=f').side, 'front');
  assert.equal(readConfig('/', '').side, 'unknown');
  assert.equal(readConfig('/x', '').side, 'unknown');
});

test('config: video source must be a same-origin path', () => {
  assert.equal(readConfig('/', '?video=/recordings/a.mp4').videoSrc, '/recordings/a.mp4');
  assert.equal(readConfig('/', '?video=//evil.example/a.mp4').videoSrc, null);
  assert.equal(readConfig('/', '?video=https://evil.example/a.mp4').videoSrc, null);
});

test('config: smoothing overrides, with fallback on junk', () => {
  const c = readConfig('/', '?mc=0.8&beta=10');
  assert.deepEqual(c.smoothing, { minCutoff: 0.8, beta: 10 });
  const d = readConfig('/', '?mc=abc&beta=-1');
  assert.deepEqual(d.smoothing, { minCutoff: 1.2, beta: 6 });
});

test('config: suit tuning params with sane defaults and clamping', () => {
  const d = readConfig('/F', '');
  assert.equal(d.size, 1);
  assert.equal(d.headPitchDeg, 0);
  assert.equal(d.fin, 'hang');
  assert.equal(d.zoom, 0.5);
  const c = readConfig('/F', '?size=0.85&head=-10&fin=trail&zoom=1&fov=500');
  assert.equal(c.size, 0.85);
  assert.equal(c.headPitchDeg, -10);
  assert.equal(c.fin, 'trail');
  assert.equal(c.zoom, 1);
  assert.equal(c.fov, 100);
});

test('coverMapping: landscape video on a portrait phone is cropped left/right', () => {
  const m = coverMapping(1280, 720, 390, 844);
  const c = videoToView(0.5, 0.5, m);
  assert.ok(Math.abs(c.x - 195) < 1e-9 && Math.abs(c.y - 422) < 1e-9);
  const tl = videoToView(0, 0, m);
  assert.ok(tl.x < 0, 'left edge is off-screen');
  assert.equal(tl.y, 0);
});

test('coverMapping: mirrored flips x only', () => {
  const m = coverMapping(720, 1280, 390, 844, true);
  const p = videoToView(0.25, 0.4, m);
  const q = videoToView(0.75, 0.4, coverMapping(720, 1280, 390, 844, false));
  assert.ok(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9);
});
