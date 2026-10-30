import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { PoseSolver } from '../src/rig/solver.ts';
import { RootPlacer, estimateDepth, fitScale, focalPx } from '../src/rig/placement.ts';
import { BONNIE, MERMAID, PROFILES, analyzeRig } from '../src/rig/profiles.ts';
import type { SuitProfile } from '../src/rig/profiles.ts';
import { Suit } from '../src/rig/suit.ts';
import { BONE_KEYS } from '../src/rig/bones.ts';
import type { BoneKey } from '../src/rig/bones.ts';
import { VIEW, makeFrame, yawQuat } from './synthetic.ts';
import { glbPositions } from './glb.ts';

const DEG = Math.PI / 180;
const mermaid = analyzeRig(MERMAID, glbPositions('public/suits/mermaid.glb'));
const bonnie = analyzeRig(BONNIE, glbPositions('public/suits/bonnie.glb'));
const solver = (o: ConstructorParameters<typeof PoseSolver>[1] = {}, rig = mermaid) =>
  new PoseSolver(rig.restDir, { swayAmplitude: 0, ...o });

/** Direction a bone points in model space after its solved delta. */
const boneDir = (key: BoneKey, delta: Quaternion, rig = mermaid) => (rig.restDir[key] as Vector3).clone().applyQuaternion(delta);
const dirOf = (a: Vector3, b: Vector3) => b.clone().sub(a).normalize();

// ------------------------------------------------------------------ profiles vs. GLBs

test('every profile node exists in its GLB and the measurements are sane', () => {
  for (const [id, profile] of Object.entries(PROFILES) as Array<[string, SuitProfile]>) {
    const rig = analyzeRig(profile, glbPositions(`public/suits/${id}.glb`)); // throws on a missing node
    assert.ok(rig.measure.torso > 0.3 && rig.measure.torso < 0.7, `${id} torso ${rig.measure.torso}`);
    assert.ok(rig.measure.shoulders > 0.3 && rig.measure.shoulders < 0.7, `${id} shoulders ${rig.measure.shoulders}`);
    for (const d of Object.values(rig.restDir)) assert.ok(Math.abs(d.length() - 1) < 1e-6);
  }
  assert.equal(mermaid.measure.legs, null);
  assert.ok(bonnie.measure.legs! > 0.5 && bonnie.measure.legs! < 0.75, `bonnie legs ${bonnie.measure.legs}`);
  // Bonnie is in a T-pose: arms along ±X, legs straight down.
  assert.ok(bonnie.restDir.leftUpperArm!.angleTo(new Vector3(1, 0, 0)) < 3 * DEG);
  assert.ok(bonnie.restDir.rightUpperArm!.angleTo(new Vector3(-1, 0, 0)) < 3 * DEG);
  assert.ok(bonnie.restDir.leftUpperLeg!.angleTo(new Vector3(0, -1, 0)) < 5 * DEG);
});

// ------------------------------------------------------------------ Suit: any rest pose

test('Suit.applyDeltas: bones end up pointing along delta·restDir, whatever their rest rotation', () => {
  // A tiny rig with deliberately rotated bone frames (like Bonnie's FBX bones).
  const root = new Group();
  const hips = new Bone(); hips.name = 'H'; hips.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  const mid = new Bone(); mid.name = 'M'; // non-driven bone in between (like Hip_Bn_05)
  mid.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
  const arm = new Bone(); arm.name = 'A'; arm.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), -1.1);
  const tip = new Bone(); tip.name = 'T';
  root.add(hips); hips.add(mid); mid.add(arm); arm.add(tip);
  hips.position.set(0, 1, 0); mid.position.set(0, -0.1, 0); arm.position.set(0.2, 0.05, 0.1); tip.position.set(0, 0.3, 0);
  root.updateMatrixWorld(true);
  const pos = (o: Bone) => o.getWorldPosition(new Vector3());
  const restArm = dirOf(pos(arm), pos(tip));

  const profile = {
    ...MERMAID,
    bones: { hips: { node: 'H', toward: 'M' }, leftUpperArm: { node: 'A', toward: 'T' } },
    anchor: ['H'],
    shoulders: ['A', 'H'],
  } as const satisfies SuitProfile;
  const suit = Suit.fromModel(profile, root);
  const delta = {} as Record<BoneKey, Quaternion>;
  for (const k of BONE_KEYS) delta[k] = new Quaternion();
  delta.hips.setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
  delta.leftUpperArm.setFromAxisAngle(new Vector3(0, 0, 1), 1.2);
  suit.applyDeltas(delta);
  suit.root.updateMatrixWorld(true);
  const expected = restArm.clone().applyQuaternion(delta.leftUpperArm);
  assert.ok(dirOf(pos(arm), pos(tip)).angleTo(expected) < 1e-4, 'arm direction');

  // Identity deltas restore the bind pose exactly.
  for (const k of BONE_KEYS) delta[k].identity();
  suit.applyDeltas(delta);
  suit.root.updateMatrixWorld(true);
  assert.ok(dirOf(pos(arm), pos(tip)).angleTo(restArm) < 1e-5, 'rest pose');
  assert.ok(mid.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7)) < 1e-6, 'undriven bone keeps its rest local');
});

// ------------------------------------------------------------------ solver (mermaid)

test('neutral stance facing the camera → hips and chest ≈ rest, no swap', () => {
  const out = solver().solve(makeFrame().frame, 'front', 0);
  assert.equal(out.swapped, false);
  assert.ok(out.delta.hips.angleTo(new Quaternion()) < 3 * DEG);
  assert.ok(out.delta.chest.angleTo(new Quaternion()) < 3 * DEG);
  assert.ok(out.confidence > 0.95);
});

test('turned 60° → hips yaw 60°', () => {
  const out = solver().solve(makeFrame({ yaw: 60 * DEG }).frame, 'front', 0);
  assert.ok(out.delta.hips.angleTo(yawQuat(60 * DEG)) < 3 * DEG);
});

test('left arm straight out to the side → upper + lower arm point +X', () => {
  const { frame } = makeFrame({
    edit: (j) => {
      j[13]!.set(0.47, 0.5, 0);
      j[15]!.set(0.72, 0.5, 0);
      j[17]!.set(0.8, 0.49, -0.02);
      j[19]!.set(0.8, 0.51, 0.02);
    },
  });
  const out = solver().solve(frame, 'front', 0);
  assert.ok(boneDir('leftUpperArm', out.delta.leftUpperArm).angleTo(new Vector3(1, 0, 0)) < 2 * DEG);
  assert.ok(boneDir('leftLowerArm', out.delta.leftLowerArm).angleTo(new Vector3(1, 0, 0)) < 2 * DEG);
  assert.ok(boneDir('rightUpperArm', out.delta.rightUpperArm).y < -0.7);
});

test('back view mislabelled by MediaPipe → swapped, suit faces away from the camera', () => {
  const out = solver().solve(makeFrame({ yaw: Math.PI, mislabel: true }).frame, 'back', 0);
  assert.equal(out.swapped, true);
  assert.ok(new Vector3(0, 0, 1).applyQuaternion(out.delta.hips).z < -0.95);
});

test('back view labelled correctly → no swap, still faces away', () => {
  const out = solver().solve(makeFrame({ yaw: Math.PI }).frame, 'back', 0);
  assert.equal(out.swapped, false);
  assert.ok(new Vector3(0, 0, 1).applyQuaternion(out.delta.hips).z < -0.95);
});

test('standing straight → tail keeps its rest curve (moves only with the hips)', () => {
  const out = solver().solve(makeFrame().frame, 'front', 0);
  for (const k of ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'] as const) {
    assert.ok(out.delta[k].angleTo(out.delta.hips) < 3 * DEG, k);
  }
});

test('knees raised forward (sitting) → upper tail swings forward', () => {
  const { frame } = makeFrame({
    edit: (j) => {
      j[25]!.set(0.1, 0, 0.44); j[26]!.set(-0.1, 0, 0.44);
      j[27]!.set(0.1, -0.42, 0.44); j[28]!.set(-0.1, -0.42, 0.44);
    },
  });
  const out = solver().solve(frame, 'front', 0);
  assert.ok(new Vector3(0, -1, 0).applyQuaternion(out.delta.tail2).angleTo(new Vector3(0, 0, 1)) < 3 * DEG);
  assert.ok(new Vector3(0, -1, 0).applyQuaternion(out.delta.tail4).angleTo(new Vector3(0, -1, 0)) < 3 * DEG);
});

test('legs out of frame → tail stays in rest pose', () => {
  const { frame } = makeFrame({
    edit: (j) => { j[25]!.set(0.3, -0.2, 0.3); j[27]!.set(-0.4, 0.1, 0.5); },
    visibility: (i) => (i >= 25 ? 0.05 : 0.99),
    presence: (i) => (i >= 25 ? 0.05 : 0.99),
  });
  const out = solver().solve(frame, 'front', 0);
  assert.ok(out.delta.tail1.angleTo(out.delta.hips) < 1e-3);
  assert.ok(out.delta.tail4.angleTo(out.delta.hips) < 1e-3);
});

test('head turned 40° → head heading ≈ 40°, chest unchanged', () => {
  const pivot = new Vector3(0, 0.6, 0);
  const { frame } = makeFrame({
    edit: (j) => { for (let i = 0; i <= 10; i++) j[i]!.sub(pivot).applyQuaternion(yawQuat(40 * DEG)).add(pivot); },
  });
  const out = solver().solve(frame, 'front', 0);
  const f = new Vector3(0, 0, 1).applyQuaternion(out.delta.head);
  assert.ok(Math.abs(Math.atan2(f.x, f.z) / DEG - 40) < 3);
  assert.ok(out.delta.chest.angleTo(new Quaternion()) < 3 * DEG);
});

test('seen from behind with low visibility: arms still follow (presence counts)', () => {
  const { frame } = makeFrame({
    yaw: Math.PI,
    edit: (j) => { j[13]!.set(0.47, 0.5, 0); j[15]!.set(0.72, 0.5, 0); },
    visibility: () => 0.2,
    presence: () => 0.95,
  });
  const out = solver().solve(frame, 'back', 0);
  assert.ok(boneDir('leftUpperArm', out.delta.leftUpperArm).angleTo(new Vector3(-1, 0, 0)) < 3 * DEG);
});

test('fin hangs in its sculpted pose by default, trails along the floor on request', () => {
  const { frame } = makeFrame();
  const hang = solver().solve(frame, 'front', 0);
  assert.ok(hang.delta.fin.angleTo(hang.delta.tail5) < 1e-6);
  const trail = solver({ finMode: 'trail' }).solve(frame, 'front', 0);
  assert.ok(boneDir('fin', trail.delta.fin).z < -0.8);
});

test('head pitch comes from the option, not from the nose', () => {
  const { frame } = makeFrame({ edit: (j) => j[0]!.set(0, 0.5, 0.1) });
  const level = solver().solve(frame, 'front', 0);
  assert.ok(level.delta.head.angleTo(level.delta.chest) < 3 * DEG);
  const down = solver({ headPitch: 0.2 }).solve(frame, 'front', 0);
  assert.ok(Math.abs(down.delta.head.angleTo(down.delta.chest) - 0.2) < 2 * DEG);
});

// ------------------------------------------------------------------ solver (Bonnie: legs, T-pose)

test('Bonnie: T-pose arms are swung down onto hanging arms, legs follow the legs', () => {
  const { frame } = makeFrame();
  const out = solver({}, bonnie).solve(frame, 'front', 0);
  const j = (i: number) => new Vector3(frame.world[i]!.x, -frame.world[i]!.y, -frame.world[i]!.z);
  assert.ok(boneDir('leftUpperArm', out.delta.leftUpperArm, bonnie).angleTo(dirOf(j(11), j(13))) < 2 * DEG);
  assert.ok(boneDir('rightLowerArm', out.delta.rightLowerArm, bonnie).angleTo(dirOf(j(14), j(16))) < 2 * DEG);
  assert.ok(boneDir('leftUpperLeg', out.delta.leftUpperLeg, bonnie).angleTo(dirOf(j(23), j(25))) < 2 * DEG);
  assert.ok(boneDir('rightLowerLeg', out.delta.rightLowerLeg, bonnie).angleTo(dirOf(j(26), j(28))) < 2 * DEG);
});

test('Bonnie: knee up → thigh points forward', () => {
  const { frame } = makeFrame({ edit: (j) => { j[25]!.set(0.1, 0, 0.44); j[27]!.set(0.1, -0.42, 0.44); } });
  const out = solver({}, bonnie).solve(frame, 'front', 0);
  assert.ok(boneDir('leftUpperLeg', out.delta.leftUpperLeg, bonnie).angleTo(new Vector3(0, 0, 1)) < 3 * DEG);
  assert.ok(boneDir('leftLowerLeg', out.delta.leftLowerLeg, bonnie).angleTo(new Vector3(0, -1, 0)) < 3 * DEG);
});

test('Bonnie: hidden arms hang down instead of sticking out in a T-pose', () => {
  const arms = new Set([13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  const { frame } = makeFrame({ visibility: (i) => (arms.has(i) ? 0.05 : 0.99), presence: (i) => (arms.has(i) ? 0.05 : 0.99) });
  const out = solver({}, bonnie).solve(frame, 'front', 0);
  for (const k of ['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm'] as const) {
    assert.ok(boneDir(k, out.delta[k], bonnie).y < -0.9, `${k} hangs`);
  }
});

// ------------------------------------------------------------------ placement

test('depth from apparent segment size ≈ true distance', () => {
  for (const depth of [1.5, 3, 4.5]) {
    const { frame, mapping } = makeFrame({ depth });
    const d = estimateDepth(frame, mapping, focalPx(VIEW.height, VIEW.fov))!;
    assert.ok(Math.abs(d - depth) / depth < 0.05, `depth ${depth} → ${d.toFixed(2)}`);
  }
});

test('mermaid fit: torso AND shoulders, ?size multiplies', () => {
  const { frame, mapping } = makeFrame({ depth: 2.5 });
  const placer = new RootPlacer(mermaid.measure);
  assert.ok(placer.update(frame, mapping, VIEW.width, VIEW.height, VIEW.fov));
  assert.ok(placer.position.distanceTo(new Vector3(0, 0, -2.5)) < 0.12);
  const expected = fitScale({ torso: 0.5, shoulders: 0.38, legs: null }, mermaid.measure);
  assert.ok(Math.abs(placer.scale - expected) < 0.01, `scale ${placer.scale} vs ${expected}`);
  const smaller = Object.assign(new RootPlacer(mermaid.measure), { sizeMultiplier: 0.9 });
  smaller.update(frame, mapping, VIEW.width, VIEW.height, VIEW.fov);
  assert.ok(Math.abs(smaller.scale - expected * 0.9) < 0.01);
});

test('Bonnie fit: torso AND legs (feet reach the floor), legs ignored when hidden', () => {
  const { frame, mapping } = makeFrame({ depth: 2.5 });
  const placer = new RootPlacer(bonnie.measure);
  placer.update(frame, mapping, VIEW.width, VIEW.height, VIEW.fov);
  const legs = 0.44 + 0.42; // synthetic thigh + shin (≈)
  const expected = Math.sqrt((0.5 / bonnie.measure.torso) * (legs / bonnie.measure.legs!));
  assert.ok(Math.abs(placer.scale - expected) < 0.02, `scale ${placer.scale} vs ${expected}`);
  const hidden = makeFrame({ depth: 2.5, visibility: (i) => (i >= 25 ? 0.05 : 0.99), presence: (i) => (i >= 25 ? 0.05 : 0.99) });
  const p2 = new RootPlacer(bonnie.measure);
  p2.update(hidden.frame, hidden.mapping, VIEW.width, VIEW.height, VIEW.fov);
  assert.ok(Math.abs(p2.scale - 0.5 / bonnie.measure.torso) < 0.02, 'torso only');
});

test('seen from behind: low visibility but high presence → still confident and placed', () => {
  const { frame, mapping } = makeFrame({ yaw: Math.PI, mislabel: true, visibility: () => 0.2, presence: () => 0.95 });
  assert.ok(solver().solve(frame, 'back', 0).confidence > 0.9);
  const placer = new RootPlacer(mermaid.measure);
  assert.ok(placer.update(frame, mapping, VIEW.width, VIEW.height, VIEW.fov));
  assert.ok(Math.abs(placer.depth - 3) < 0.15);
});

test('no usable segment for a frame → keep the last depth instead of hiding', () => {
  const placer = new RootPlacer(mermaid.measure);
  const good = makeFrame({ depth: 2 });
  assert.ok(placer.update(good.frame, good.mapping, VIEW.width, VIEW.height, VIEW.fov));
  const bad = makeFrame({ depth: 2, visibility: () => 0.1, presence: () => 0.1 });
  bad.frame.timestampMs = 33;
  assert.ok(placer.update(bad.frame, bad.mapping, VIEW.width, VIEW.height, VIEW.fov));
  assert.ok(Math.abs(placer.depth - 2) < 0.05);
});
