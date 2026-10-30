import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { SuitFollower } from '../src/rig/follow.ts';
import { BONE_KEYS } from '../src/rig/bones.ts';
import type { BoneKey } from '../src/rig/bones.ts';

const pose = (angle = 0): Record<BoneKey, Quaternion> => {
  const r = {} as Record<BoneKey, Quaternion>;
  for (const k of BONE_KEYS) r[k] = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);
  return r;
};
const run = (f: SuitFollower, seconds: number, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) f.update(1 / fps);
};

test('first target snaps (no gliding in from the origin)', () => {
  const f = new SuitFollower({ bobAmplitude: 0 });
  f.setTarget(pose(0.5), new Vector3(1, 2, -3), 0.8);
  f.update(1 / 60);
  assert.ok(f.position.distanceTo(new Vector3(1, 2, -3)) < 1e-9);
  assert.equal(f.scale, 0.8);
  assert.ok(f.rotations.head.angleTo(pose(0.5).head) < 1e-6);
});

test('fast move: lags a little, then catches up smoothly without overshoot', () => {
  const f = new SuitFollower({ bobAmplitude: 0 });
  f.setTarget(pose(), new Vector3(0, 0, -3), 1);
  f.update(1 / 60);
  f.setTarget(pose(), new Vector3(0.5, 0, -3), 1); // wearer steps 50 cm sideways
  run(f, 0.1);
  const early = f.position.x;
  assert.ok(early > 0.02 && early < 0.35, `after 0.1 s: ${early.toFixed(3)} (trailing)`);
  let max = 0;
  for (let i = 0; i < 90; i++) {
    f.update(1 / 60);
    max = Math.max(max, f.position.x);
  }
  assert.ok(f.position.x > 0.495, `after 1.6 s: ${f.position.x.toFixed(3)} (caught up)`);
  assert.ok(max <= 0.5 + 1e-6, 'never overshoots');
});

test('frame-rate independent: 30 fps and 120 fps end up in the same place', () => {
  const at = (fps: number) => {
    const f = new SuitFollower({ bobAmplitude: 0 });
    f.setTarget(pose(), new Vector3(0, 0, 0), 1);
    f.update(1 / fps);
    f.setTarget(pose(), new Vector3(1, 0, 0), 1);
    run(f, 0.3, fps);
    return f.position.x;
  };
  assert.ok(Math.abs(at(30) - at(120)) < 0.02);
});

test('the tail trails behind the hips (follow-through)', () => {
  const f = new SuitFollower({ bobAmplitude: 0 });
  f.setTarget(pose(0), new Vector3(), 1);
  f.update(1 / 60);
  f.setTarget(pose(1), new Vector3(), 1);
  run(f, 0.2);
  const hipsLeft = f.rotations.hips.angleTo(pose(1).hips);
  const finLeft = f.rotations.fin.angleTo(pose(1).fin);
  assert.ok(finLeft > hipsLeft * 1.5, `hips ${hipsLeft.toFixed(2)} rad behind, fin ${finLeft.toFixed(2)} rad`);
});

test('float = 0 is locked to the tracking', () => {
  const f = new SuitFollower({ float: 0 });
  f.setTarget(pose(0), new Vector3(), 1);
  f.update(1 / 60);
  f.setTarget(pose(1), new Vector3(0.7, 0, 0), 1.1);
  f.update(1 / 60);
  assert.ok(f.displayPosition.distanceTo(new Vector3(0.7, 0, 0)) < 1e-9, 'no lag, no bob');
  assert.ok(f.rotations.tail5.angleTo(pose(1).tail5) < 1e-6);
});

test('a huge jump (someone else) snaps instead of flying across the screen', () => {
  const f = new SuitFollower({ bobAmplitude: 0 });
  f.setTarget(pose(), new Vector3(0, 0, -3), 1);
  f.update(1 / 60);
  f.setTarget(pose(), new Vector3(2, 0, -3), 1);
  f.update(1 / 60);
  assert.ok(f.position.distanceTo(new Vector3(2, 0, -3)) < 1e-9);
});

test('hover bob is gentle and centred on the tracked position', () => {
  const f = new SuitFollower();
  f.setTarget(pose(), new Vector3(0, 0, -3), 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 400; i++) {
    f.update(1 / 60);
    lo = Math.min(lo, f.displayPosition.y);
    hi = Math.max(hi, f.displayPosition.y);
  }
  assert.ok(hi - lo > 0.02 && hi - lo < 0.04, `bob range ${(hi - lo).toFixed(3)} m`);
  assert.ok(Math.abs((hi + lo) / 2) < 0.002);
});
