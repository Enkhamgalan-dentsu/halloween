import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaceLock } from '../src/identity/face-lock.ts';
import type { FaceCheckerLike } from '../src/identity/face-lock.ts';
import type { FaceCheck } from '../src/identity/face-check.ts';
import { torsoBox } from '../src/tracking/select.ts';
import { WearerLock } from '../src/tracking/wearer-lock.ts';
import type { PoseFrame } from '../src/tracking/pose.ts';
import { fakePose } from './helpers.ts';

const SIG = new Float32Array(32).fill(1 / 16); // each half (top/bottom) sums to 1
const video = {} as HTMLVideoElement;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Fake checker: whoever stands at x≈`meX` is the wearer; everyone else is "other". */
function fakeChecker(state: { meX: number; calls: number; faceVisible: boolean }): FaceCheckerLike {
  return {
    canCheck: () => state.faceVisible,
    async check(_v, frame: PoseFrame): Promise<FaceCheck> {
      state.calls++;
      const box = torsoBox(frame.image)!;
      const me = Math.abs(box.cx - state.meX) < 0.05;
      return { verdict: me ? 'match' : 'other', distance: me ? 0.4 : 0.8, x: box.cx, y: box.cy - 0.2 };
    },
  };
}

function setup(meX: number) {
  const state = { meX, calls: 0, faceVisible: true };
  const lock = new WearerLock();
  let now = 0;
  const events = { changed: 0, rejected: 0 };
  const faces = new FaceLock(fakeChecker(state), lock, video, {
    fingerprint: () => SIG,
    onWearerChanged: () => events.changed++,
    onRejected: () => events.rejected++,
    now: () => now,
  });
  const step = async (frames: PoseFrame[], ms: number) => {
    now = ms;
    const i = lock.update(frames, ms, () => SIG);
    faces.tick(frames, i, ms);
    await tick();
    return i;
  };
  return { state, lock, faces, events, step };
}

test('face lock: searches faces round-robin and locks onto the enrolled one only', async () => {
  const { lock, events, step } = setup(0.7);
  const frames = [fakePose(0.5, 0.5, 0.25, 0.35), fakePose(0.7, 0.5)];
  let i = -1;
  let t = 0;
  for (; t < 1000 && i < 0; t += 33) i = await step(frames, t);
  // the big central person was checked first and rejected; the one at 0.7 matched
  assert.equal(lock.state, 'locked');
  assert.equal(events.changed, 1);
  for (const end = t + 3000; t < end; t += 33) i = await step(frames, t);
  assert.equal(i, 1, 'the suit stays on the person at x=0.7 (others re-checked, ignored)');
  assert.equal(events.rejected, 0);
});

test('face lock: no visible faces → no checks, nobody locked', async () => {
  const { state, lock, step } = setup(0.5);
  state.faceVisible = false;
  for (let t = 0; t < 1000; t += 33) await step([fakePose(0.5, 0.5)], t);
  assert.equal(state.calls, 0);
  assert.equal(lock.state, 'searching');
});

test('face lock: keeps following with the face turned away (continuity)', async () => {
  const { state, step } = setup(0.5);
  let x = 0.5;
  for (let t = 0; t < 400; t += 33) await step([fakePose(x, 0.5)], t);
  state.faceVisible = false; // turned around
  let i = -1;
  for (let t = 400; t < 3000; t += 33) {
    x += 0.004; // walking away from where the face was seen
    i = await step([fakePose(x, 0.5), fakePose(0.15, 0.5)], t);
  }
  assert.equal(i, 0);
});

test('face lock: two "not the wearer" verdicts drop a wrong lock', async () => {
  const { state, lock, events, step } = setup(0.5);
  const frames = [fakePose(0.5, 0.5)];
  for (let t = 0; t < 300; t += 33) await step(frames, t);
  assert.equal(lock.state, 'locked');
  state.meX = 0.9; // pretend the face no longer matches (e.g. someone else stepped in)
  for (let t = 300; t < 6000 && lock.state === 'locked'; t += 33) await step(frames, t);
  assert.equal(lock.state, 'searching');
  assert.equal(events.rejected, 1);
});
