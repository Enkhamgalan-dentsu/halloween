/**
 * Pose lab (dev only): drives the real suit with synthetic MediaPipe landmarks
 * (tests/synthetic.ts) through the real solver + placement, and draws the landmark
 * skeleton underneath. Use it to tune the rig without a person in front of the camera.
 * Open https://localhost:5173/tools/pose-lab/ while `npm run dev` is running.
 */
import * as THREE from 'three';
import { Suit } from '../../src/rig/suit.ts';
import { PoseSolver } from '../../src/rig/solver.ts';
import { RootPlacer } from '../../src/rig/placement.ts';
import { SUIT_URL } from '../../src/rig/bones.ts';
import { SkeletonOverlay } from '../../src/debug/skeleton.ts';
import { makeFrame } from '../../tests/synthetic.ts';
import type { SyntheticOptions } from '../../tests/synthetic.ts';
import type { Facing } from '../../src/rig/facing.ts';
import { SuitFollower } from '../../src/rig/follow.ts';

type Scenario = SyntheticOptions & { facing?: Facing };

/** Moving scenarios (t in seconds) — to feel the ghost-like easing (?float). */
const ANIMATED: Record<string, (t: number) => Scenario> = {
  'step side to side (fast)': (t) => ({
    edit: (j) => {
      const dx = 0.45 * Math.sign(Math.sin(t * 1.6)) * Math.min(1, Math.abs(Math.sin(t * 1.6)) * 6);
      for (const p of j) p.x += dx;
    },
  }),
  'dance (animated)': (t) => ({
    yaw: 0.5 * Math.sin(t * 1.3),
    edit: (j) => {
      const a = Math.sin(t * 3);
      j[13]!.set(0.3, 0.5 + 0.25 * a, 0.05); j[15]!.set(0.45, 0.55 + 0.45 * a, 0.1);
      j[14]!.set(-0.3, 0.5 - 0.25 * a, 0.05); j[16]!.set(-0.45, 0.55 - 0.45 * a, 0.1);
      j[17]!.copy(j[15]!).y += 0.05; j[19]!.copy(j[15]!).y += 0.06;
      j[18]!.copy(j[16]!).y += 0.05; j[20]!.copy(j[16]!).y += 0.06;
      const hip = 0.06 * Math.sin(t * 3);
      for (const p of j) p.x += hip;
      j[25]!.z += 0.15 * Math.max(0, a); j[27]!.z += 0.1 * Math.max(0, a);
    },
  }),
  'quick spin': (t) => ({ yaw: (t * 2.5) % (2 * Math.PI) < Math.PI ? 0 : Math.PI / 2 }),
};

const SCENARIOS: Record<string, Scenario> = {
  neutral: {},
  'arms up': {
    edit: (j) => {
      j[13]!.set(0.26, 0.78, 0); j[14]!.set(-0.26, 0.78, 0);
      j[15]!.set(0.3, 1.04, 0.02); j[16]!.set(-0.3, 1.04, 0.02);
      j[17]!.set(0.32, 1.12, 0); j[18]!.set(-0.32, 1.12, 0);
      j[19]!.set(0.29, 1.13, 0.03); j[20]!.set(-0.29, 1.13, 0.03);
    },
  },
  wave: {
    edit: (j) => {
      j[14]!.set(-0.47, 0.55, 0.05); j[16]!.set(-0.55, 0.8, 0.08);
      j[18]!.set(-0.58, 0.88, 0.06); j[20]!.set(-0.55, 0.89, 0.1);
    },
  },
  'turned 45°': { yaw: Math.PI / 4 },
  'side on': { yaw: Math.PI / 2 },
  'back view': { yaw: Math.PI, mislabel: true, facing: 'back', visibility: () => 0.2, presence: () => 0.95 },
  'knee up': {
    edit: (j) => {
      j[25]!.set(0.1, 0, 0.44); j[27]!.set(0.1, -0.42, 0.44);
      j[29]!.set(0.1, -0.46, 0.4); j[31]!.set(0.1, -0.46, 0.56);
    },
  },
  'close (1.6 m)': { depth: 1.6 },
  'far (4.5 m)': { depth: 4.5 },
  'lean sideways': {
    edit: (j) => {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3);
      for (let i = 0; i < 23; i++) j[i]!.applyQuaternion(q);
    },
  },
  'legs hidden': { visibility: (i) => (i >= 25 ? 0.05 : 0.99) },
};

const FOV = 63;
const stage = document.getElementById('stage') as HTMLDivElement;
const select = document.getElementById('pose') as HTMLSelectElement;
const sway = document.getElementById('sway') as HTMLInputElement;
const bonesBox = document.getElementById('bones') as HTMLInputElement;
const info = document.getElementById('info') as HTMLSpanElement;
for (const name of [...Object.keys(ANIMATED), ...Object.keys(SCENARIOS)]) select.add(new Option(name, name));
const floatSel = document.getElementById('float') as HTMLSelectElement;

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl') as HTMLCanvasElement, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20101a, 1.6));
const key = new THREE.DirectionalLight(0xffe2c0, 2.2);
key.position.set(1, 2, 2);
scene.add(key);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);
const skeleton = new SkeletonOverlay(stage);

const suit = await Suit.load(SUIT_URL);
scene.add(suit.root);
const helper = suit.makeHelper();
scene.add(helper);
let solver = new PoseSolver(suit.rest);
let placer = new RootPlacer(suit.rest);
let follower = new SuitFollower({ float: Number(floatSel.value) });
let lastTime = -1;

const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  skeleton.resize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', resize);
resize();

select.onchange = sway.onchange = floatSel.onchange = () => {
  solver = new PoseSolver(suit.rest, sway.checked ? {} : { swayAmplitude: 0 });
  placer = new RootPlacer(suit.rest);
  follower = new SuitFollower({ float: Number(floatSel.value) });
};

renderer.setAnimationLoop((time: number) => {
  const view = { width: window.innerWidth, height: window.innerHeight, fov: FOV };
  const animated = ANIMATED[select.value];
  const scenario = animated ? animated(time / 1000) : (SCENARIOS[select.value] ?? {});
  const { frame, mapping } = makeFrame({ ...scenario, view });
  frame.timestampMs = time;
  const pose = solver.solve(frame, scenario.facing ?? 'front', time);
  placer.update(frame, mapping, view.width, view.height, FOV);
  follower.setTarget(pose.local, placer.position, placer.scale);
  follower.update(lastTime < 0 ? 0 : (time - lastTime) / 1000);
  lastTime = time;
  suit.applyLocal(follower.local);
  suit.place(follower.displayPosition, follower.scale);
  suit.root.visible = true;
  helper.visible = bonesBox.checked;
  skeleton.draw(frame, [], mapping);
  renderer.render(scene, camera);
  info.textContent = `depth ${placer.depth.toFixed(2)} m · scale ${placer.scale.toFixed(2)} · conf ${pose.confidence.toFixed(2)}${pose.swapped ? ' · L/R swapped' : ''}`;
});
