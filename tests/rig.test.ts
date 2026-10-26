import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { PoseSolver } from '../src/rig/solver.ts';
import { RootPlacer, estimateDepth, fitScale, focalPx } from '../src/rig/placement.ts';
import { REST_JOINTS, restPoseFromTable } from '../src/rig/rest-pose.ts';
import type { JointName } from '../src/rig/rest-pose.ts';
import { BONE_SEGMENT, jointNodeName } from '../src/rig/bones.ts';
import type { BoneKey } from '../src/rig/bones.ts';
import { VIEW, makeFrame, yawQuat } from './synthetic.ts';

const rest = restPoseFromTable();
const solver = (o: ConstructorParameters<typeof PoseSolver>[1] = {}) => new PoseSolver(rest, { swayAmplitude: 0, ...o });
const DEG = Math.PI / 180;

/** Direction a bone points in model space for a solved world rotation. */
function boneDir(key: BoneKey, world: Quaternion): Vector3 {
  const [a, b] = BONE_SEGMENT[key];
  return rest[b].clone().sub(rest[a]).normalize().applyQuaternion(world);
}

test('rest pose table matches the bones in public/suits/mermaid.glb', () => {
  const buf = readFileSync(new URL('../public/suits/mermaid.glb', import.meta.url));
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes: Array<{ name?: string; translation?: number[]; matrix?: number[]; children?: number[] }>;
  };
  // GLTFExporter writes bone transforms as column-major matrices (translation = 12..14).
  const local = (i: number): [number, number, number] => {
    const n = gltf.nodes[i];
    const m = n?.matrix;
    if (m) return [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0];
    return (n?.translation ?? [0, 0, 0]) as [number, number, number];
  };
  const parent = new Map<number, number>();
  gltf.nodes.forEach((n, i) => n.children?.forEach((c) => parent.set(c, i)));
  const worldPos = (i: number): Vector3 => {
    const t = new Vector3(...local(i));
    const p = parent.get(i);
    return p === undefined ? t : t.add(worldPos(p));
  };
  const hipsIndex = gltf.nodes.findIndex((n) => n.name === 'mixamorigHips');
  const hips = worldPos(hipsIndex);
  for (const name of Object.keys(REST_JOINTS) as JointName[]) {
    const i = gltf.nodes.findIndex((n) => n.name === jointNodeName(name));
    assert.ok(i >= 0, `node ${name} exists`);
    const d = worldPos(i).sub(hips).distanceTo(rest[name]);
    assert.ok(d < 0.002, `${name} off by ${d.toFixed(4)} m`);
  }
});

test('neutral stance facing the camera → hips and chest ≈ identity, no swap', () => {
  const { frame } = makeFrame();
  const out = solver().solve(frame, 'front', 0);
  assert.equal(out.swapped, false);
  assert.ok(out.world.hips.angleTo(new Quaternion()) < 3 * DEG);
  assert.ok(out.world.chest.angleTo(new Quaternion()) < 3 * DEG);
  assert.ok(out.confidence > 0.95);
});

test('turned 60° → hips yaw 60°', () => {
  const { frame } = makeFrame({ yaw: 60 * DEG });
  const out = solver().solve(frame, 'front', 0);
  assert.ok(out.world.hips.angleTo(yawQuat(60 * DEG)) < 3 * DEG);
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
  assert.ok(boneDir('leftUpperArm', out.world.leftUpperArm).angleTo(new Vector3(1, 0, 0)) < 2 * DEG);
  assert.ok(boneDir('leftLowerArm', out.world.leftLowerArm).angleTo(new Vector3(1, 0, 0)) < 2 * DEG);
  // The right arm still hangs down-ish.
  assert.ok(boneDir('rightUpperArm', out.world.rightUpperArm).y < -0.7);
});

test('back view mislabelled by MediaPipe → swapped, suit faces away from the camera', () => {
  const { frame } = makeFrame({ yaw: Math.PI, mislabel: true });
  const out = solver().solve(frame, 'back', 0);
  assert.equal(out.swapped, true);
  const forward = new Vector3(0, 0, 1).applyQuaternion(out.world.hips);
  assert.ok(forward.z < -0.95, `forward ${forward.toArray()}`);
});

test('back view labelled correctly → no swap, still faces away', () => {
  const { frame } = makeFrame({ yaw: Math.PI });
  const out = solver().solve(frame, 'back', 0);
  assert.equal(out.swapped, false);
  assert.ok(new Vector3(0, 0, 1).applyQuaternion(out.world.hips).z < -0.95);
});

test('standing straight → tail keeps its rest curve (no leg delta)', () => {
  const { frame } = makeFrame();
  const out = solver().solve(frame, 'front', 0);
  for (const k of ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'] as const) {
    assert.ok(out.local[k].angleTo(new Quaternion()) < 3 * DEG, `${k} local rotation`);
  }
});

test('knees raised forward (sitting) → upper tail swings forward', () => {
  const { frame } = makeFrame({
    edit: (j) => {
      j[25]!.set(0.1, 0, 0.44);
      j[26]!.set(-0.1, 0, 0.44);
      j[27]!.set(0.1, -0.42, 0.44);
      j[28]!.set(-0.1, -0.42, 0.44);
    },
  });
  const out = solver().solve(frame, 'front', 0);
  const down = new Vector3(0, -1, 0).applyQuaternion(out.world.tail2);
  assert.ok(down.angleTo(new Vector3(0, 0, 1)) < 3 * DEG, `tail2 down-axis ${down.toArray()}`);
  const shinAxis = new Vector3(0, -1, 0).applyQuaternion(out.world.tail4);
  assert.ok(shinAxis.angleTo(new Vector3(0, -1, 0)) < 3 * DEG, 'lower tail follows the shins');
});

test('legs out of frame → tail stays in rest pose', () => {
  const { frame } = makeFrame({
    edit: (j) => {
      j[25]!.set(0.3, -0.2, 0.3); // garbage leg positions…
      j[27]!.set(-0.4, 0.1, 0.5);
    },
    visibility: (i) => (i >= 25 ? 0.05 : 0.99), // …out of frame: low visibility AND presence
    presence: (i) => (i >= 25 ? 0.05 : 0.99),
  });
  const out = solver().solve(frame, 'front', 0);
  assert.ok(out.world.tail1.angleTo(out.world.hips) < 1e-3);
  assert.ok(out.world.tail4.angleTo(out.world.hips) < 1e-3);
});

test('head turned 40° → head heading ≈ 40°, chest unchanged', () => {
  const pivot = new Vector3(0, 0.6, 0);
  const { frame } = makeFrame({
    edit: (j) => {
      for (let i = 0; i <= 10; i++) j[i]!.sub(pivot).applyQuaternion(yawQuat(40 * DEG)).add(pivot);
    },
  });
  const out = solver().solve(frame, 'front', 0);
  const f = new Vector3(0, 0, 1).applyQuaternion(out.world.head);
  const heading = Math.atan2(f.x, f.z) / DEG;
  assert.ok(Math.abs(heading - 40) < 3, `heading ${heading.toFixed(1)}°`);
  assert.ok(out.world.chest.angleTo(new Quaternion()) < 3 * DEG);
});

test('local rotations recompose to the world rotations', () => {
  const { frame } = makeFrame({ yaw: 0.4 });
  const out = solver().solve(frame, 'front', 1234);
  const recomposed = out.local.hips.clone().multiply(out.local.spine).multiply(out.local.spine1).multiply(out.local.chest)
    .multiply(out.local.leftShoulder).multiply(out.local.leftUpperArm);
  assert.ok(recomposed.angleTo(out.world.leftUpperArm) < 1e-4);
});

test('depth from apparent segment size ≈ true distance', () => {
  for (const depth of [1.5, 3, 4.5]) {
    const { frame, mapping } = makeFrame({ depth });
    const d = estimateDepth(frame, mapping, focalPx(VIEW.height, VIEW.fov))!;
    assert.ok(Math.abs(d - depth) / depth < 0.05, `depth ${depth} → ${d.toFixed(2)}`);
  }
});

test('RootPlacer: hips on the hips, size fits torso AND shoulders, ?size multiplies', () => {
  const { frame, mapping } = makeFrame({ depth: 2.5 });
  const placer = new RootPlacer(rest);
  assert.ok(placer.update(frame, mapping, VIEW.width, VIEW.height, VIEW.fov));
  assert.ok(placer.position.distanceTo(new Vector3(0, 0, -2.5)) < 0.12, `pos ${placer.position.toArray()}`);
  const expected = fitScale(0.5, 0.38, rest); // synthetic torso 0.5 m, shoulders 0.38 m
  assert.ok(Math.abs(placer.scale - expected) < 0.01, `scale ${placer.scale} vs ${expected}`);
  assert.ok(expected < 0.5 / 0.52 - 0.05, 'smaller than a torso-only fit');
  const smaller = Object.assign(new RootPlacer(rest), { sizeMultiplier: 0.9 });
  smaller.update(frame, mapping, VIEW.width, VIEW.height, VIEW.fov);
  assert.ok(Math.abs(smaller.scale - expected * 0.9) < 0.01);
});

test('seen from behind: low visibility but high presence → still confident and placed', () => {
  const { frame, mapping } = makeFrame({ yaw: Math.PI, mislabel: true, visibility: () => 0.2, presence: () => 0.95 });
  const out = solver().solve(frame, 'back', 0);
  assert.ok(out.confidence > 0.9, `confidence ${out.confidence}`);
  const placer = new RootPlacer(rest);
  assert.ok(placer.update(frame, mapping, VIEW.width, VIEW.height, VIEW.fov));
  assert.ok(Math.abs(placer.depth - 3) < 0.15, `depth ${placer.depth}`);
});

test('no usable segment for a frame → keep the last depth instead of hiding', () => {
  const placer = new RootPlacer(rest);
  const good = makeFrame({ depth: 2 });
  assert.ok(placer.update(good.frame, good.mapping, VIEW.width, VIEW.height, VIEW.fov));
  const bad = makeFrame({ depth: 2, visibility: () => 0.1, presence: () => 0.1 });
  bad.frame.timestampMs = 33;
  assert.ok(placer.update(bad.frame, bad.mapping, VIEW.width, VIEW.height, VIEW.fov));
  assert.ok(Math.abs(placer.depth - 2) < 0.05);
});

test('seen from behind with low visibility: arms still follow (presence counts)', () => {
  const { frame } = makeFrame({
    yaw: Math.PI,
    edit: (j) => {
      j[13]!.set(0.47, 0.5, 0);
      j[15]!.set(0.72, 0.5, 0);
    },
    visibility: () => 0.2,
    presence: () => 0.95,
  });
  const out = solver().solve(frame, 'back', 0);
  // Person's left arm out to their left; they face away, so in camera space that's −X.
  assert.ok(boneDir('leftUpperArm', out.world.leftUpperArm).angleTo(new Vector3(-1, 0, 0)) < 3 * DEG);
});

test('fin hangs in its sculpted pose by default, trails along the floor on request', () => {
  const { frame } = makeFrame();
  assert.ok(solver().solve(frame, 'front', 0).local.fin.angleTo(new Quaternion()) < 1e-6);
  const trail = solver({ finMode: 'trail' }).solve(frame, 'front', 0);
  assert.ok(boneDir('fin', trail.world.fin).z < -0.8, 'trails behind (away from the camera)');
});

test('head pitch comes from the option, not from the nose', () => {
  const { frame } = makeFrame({
    edit: (j) => j[0]!.set(0, 0.5, 0.1), // nose far below the ears → would look like "looking down"
  });
  const level = solver().solve(frame, 'front', 0);
  assert.ok(level.world.head.angleTo(level.world.chest) < 3 * DEG, 'head level with the chest');
  const down = solver({ headPitch: 0.2 }).solve(frame, 'front', 0);
  assert.ok(Math.abs(down.world.head.angleTo(down.world.chest) - 0.2) < 2 * DEG);
});
