// @ts-check
/**
 * Suit build pipeline: source GLB (static sculpt) → rigged, phone-sized suit GLB.
 *
 *   1. bake node transforms (Y-up, glTF units of the source)
 *   2. simplify every mesh with meshoptimizer (triangle budget per material)
 *   3. build a skeleton from hand-measured joint positions (JOINTS below)
 *   4. skin weights: inverse distance to bone capsules, normalized by bone radius
 *   5. proportion fix: scale the tail / arm chains along their length (keeps girth)
 *   6. convert to metres with the hips at the origin, shrink textures to WebP
 *   7. export a binary glTF with GLTFExporter
 *
 * Runs in a browser (needs canvas for textures). Open /tools/build-suit/ on the dev
 * server and press Build, or drive it headless (see README.md next to this file).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export const CONFIG = {
  source: '/assets/creepy_mermaid.glb',
  /** Mermaid hips→shoulders is ~135 source units; an adult's is ~0.52 m. */
  metresPerUnit: 0.52 / 135,
  /** Tail (hips→fin base) becomes hip→ankle length; fin shortened; arms a bit long = creepy. */
  tailScale: 0.4,
  finScale: 0.6,
  armScale: 0.75,
  /** Fraction of triangles kept, by material name. */
  simplify: /** @type {Record<string, number>} */ ({ Body: 0.3, Head: 0.35, Hair: 0.35, 'Hair.001': 0.35, Teeth: 0.1, Eyes: 1 }),
  /** Max texture size, by material name (metal/roughness maps get half). */
  textureSize: /** @type {Record<string, number>} */ ({ Body: 1024, Head: 1024, Hair: 512, 'Hair.001': 512, Eyes: 256, Teeth: 256 }),
  imageType: 'image/webp',
  /** Normal + metal/roughness maps. Lossy compression smears the fine pitted-skin detail. */
  dataImageType: 'image/webp',
  /** Encoder quality for lossy images (WebP/JPEG). GLTFExporter doesn't expose it. */
  imageQuality: 0.95,
};

/**
 * Joint positions in source units (after the root transform: Y up, +Z = facing).
 * Measured from slices of the mesh — see docs/SUIT.md. "Left" = the mermaid's own left (+X).
 * [name, parent, position]
 * @type {Array<[string, string | null, [number, number, number]]>}
 */
export const JOINTS = [
  ['Hips', null, [0, -95, -8]],
  ['Spine', 'Hips', [1, -55, 5]],
  ['Spine1', 'Spine', [2, -15, 14]],
  ['Spine2', 'Spine1', [0, 30, 4]],
  ['Neck', 'Spine2', [0, 72, -4]],
  ['Head', 'Neck', [1, 92, 4]],
  ['HeadTop_End', 'Head', [2, 170, 18]],
  ['LeftShoulder', 'Spine2', [12, 58, -6]],
  ['LeftArm', 'LeftShoulder', [66, 40, -9]],
  ['LeftForeArm', 'LeftArm', [126, -58, -46]],
  ['LeftHand', 'LeftForeArm', [162, -155, -30]],
  ['LeftHandTip', 'LeftHand', [175, -228, -58]],
  ['RightShoulder', 'Spine2', [-12, 58, -6]],
  ['RightArm', 'RightShoulder', [-66, 40, -10]],
  ['RightForeArm', 'RightArm', [-129, -58, -22]],
  ['RightHand', 'RightForeArm', [-200, -140, 21]],
  ['RightHandTip', 'RightHand', [-215, -215, 10]],
  ['Tail1', 'Hips', [0, -100, -10]],
  ['Tail2', 'Tail1', [8, -220, 10]],
  ['Tail3', 'Tail2', [23, -320, 38]],
  ['Tail4', 'Tail3', [9, -420, 23]],
  ['Tail5', 'Tail4', [-25, -520, -42]],
  ['Fin', 'Tail5', [-8, -600, -114]],
  ['FinEnd', 'Fin', [-5, -790, -153]],
];

/** Deforming bones: segment = joint → `to` joint, capsule radius (source units) for weighting. */
const SEGMENTS = /** @type {Record<string, { to: string, radius: number }>} */ ({
  Hips: { to: 'Spine', radius: 55 },
  Spine: { to: 'Spine1', radius: 50 },
  Spine1: { to: 'Spine2', radius: 55 },
  Spine2: { to: 'Neck', radius: 58 },
  Neck: { to: 'Head', radius: 25 },
  Head: { to: 'HeadTop_End', radius: 45 },
  LeftShoulder: { to: 'LeftArm', radius: 30 },
  LeftArm: { to: 'LeftForeArm', radius: 22 },
  LeftForeArm: { to: 'LeftHand', radius: 20 },
  LeftHand: { to: 'LeftHandTip', radius: 25 },
  RightShoulder: { to: 'RightArm', radius: 30 },
  RightArm: { to: 'RightForeArm', radius: 22 },
  RightForeArm: { to: 'RightHand', radius: 20 },
  RightHand: { to: 'RightHandTip', radius: 25 },
  Tail1: { to: 'Tail2', radius: 55 },
  Tail2: { to: 'Tail3', radius: 50 },
  Tail3: { to: 'Tail4', radius: 42 },
  Tail4: { to: 'Tail5', radius: 38 },
  Tail5: { to: 'Fin', radius: 30 },
  Fin: { to: 'FinEnd', radius: 60 },
});

/**
 * Which bones each source mesh may be weighted to (key: "material#mesh", then material).
 * A function picks per vertex (source units).
 * @typedef {string[] | ((p: THREE.Vector3) => string[])} Allowed
 */
const BODY_BONES = Object.keys(SEGMENTS);
const UNDERARM = ['Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'RightShoulder', 'RightArm'];
const HIPS_AND_TAIL = ['Hips', 'Spine', 'Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5', 'Fin'];
const ALLOWED = /** @type {Record<string, Allowed>} */ ({
  Hair: ['Head'],
  'Hair.001': ['Head'],
  Eyes: ['Head'],
  Teeth: ['Head'],
  Head: ['Neck', 'Head'],
  // Object_3 = webbing under the arms + frilly hip fins + ridge down the back of the tail.
  // The hip fins sit next to the hands, so they must never follow the hands.
  'Body#Object_3': (p) => (p.y > -60 && Math.abs(p.x) > 40 ? UNDERARM : HIPS_AND_TAIL),
  Body: BODY_BONES,
});

/** Per-segment length scale for the proportion fix. */
function segmentScale(/** @type {string} */ bone) {
  if (/^Tail[1-5]$/.test(bone)) return CONFIG.tailScale;
  if (bone === 'Fin') return CONFIG.finScale;
  if (/^(Left|Right)(Arm|ForeArm)$/.test(bone)) return CONFIG.armScale;
  return 1;
}

const WEIGHT_POWER = 10;
const MAX_INFLUENCES = 4;

/** Bone names in the output GLB (Mixamo-style for the humanoid part). */
export function boneName(/** @type {string} */ joint) {
  return /^(Tail\d|Fin|FinEnd)$/.test(joint) ? joint : `mixamorig${joint}`;
}

/**
 * @param {(msg: string) => void} log
 * @returns {Promise<{ glb: ArrayBuffer, report: Record<string, unknown> }>}
 */
export async function buildSuit(log = console.log) {
  await MeshoptSimplifier.ready;
  log(`loading ${CONFIG.source}`);
  const gltf = await new GLTFLoader().loadAsync(CONFIG.source);
  gltf.scene.updateMatrixWorld(true);

  /** @type {THREE.Mesh[]} */
  const sources = [];
  gltf.scene.traverse((o) => {
    if (/** @type {THREE.Mesh} */ (o).isMesh) sources.push(/** @type {THREE.Mesh} */ (o));
  });

  const J = new Map(JOINTS.map(([name, , p]) => [name, new THREE.Vector3(...p)]));
  const parentOf = new Map(JOINTS.map(([name, parent]) => [name, parent]));
  const newJ = scaledJoints(J, parentOf);
  const boneOrder = JOINTS.map(([name]) => name);
  const boneIndex = new Map(boneOrder.map((n, i) => [n, i]));

  const report = /** @type {Record<string, unknown>} */ ({ meshes: [] });
  const out = new THREE.Group();
  out.name = 'Suit';
  const { bones, skeleton } = makeSkeleton(newJ, parentOf, boneOrder);
  out.add(/** @type {THREE.Bone} */ (bones[0]));
  out.updateMatrixWorld(true);

  const doneTextures = new Set();
  for (const src of sources) {
    const material = /** @type {THREE.MeshStandardMaterial} */ (src.material);
    const key = material.name;
    let geom = src.geometry.clone();
    geom.applyMatrix4(src.matrixWorld);
    // KEEP the source tangents (simplified vertices keep valid ones; applyProportions
    // stretches them with the surface). Without vertex tangents three.js derives the
    // normal-map frame from screen-space derivatives, which weakens the bumps on the
    // squashed tail, and the normal-map green convention flips — both made the skin read
    // as flat and wet. (applyMatrix4 above already rotates tangents with the mesh.)
    const trisBefore = triCount(geom);

    geom = simplify(geom, CONFIG.simplify[key] ?? 0.5);
    const allowed = ALLOWED[`${key}#${src.name}`] ?? ALLOWED[key] ?? BODY_BONES;
    const { skinIndex, skinWeight } = computeWeights(geom, J, allowed, boneIndex);
    applyProportions(geom, J, newJ, skinIndex, skinWeight, boneOrder);
    toMetres(geom, /** @type {THREE.Vector3} */ (newJ.get('Hips')));

    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    shrinkTextures(material, CONFIG.textureSize[key] ?? 1024, doneTextures);

    const mesh = new THREE.SkinnedMesh(geom, material);
    mesh.name = `${key}_${src.name}`;
    out.add(mesh);
    mesh.bind(skeleton);
    /** @type {unknown[]} */ (report.meshes).push({ mesh: mesh.name, trisBefore, trisAfter: triCount(geom), verts: geom.attributes.position.count, bones: typeof allowed === 'function' ? 'per-vertex' : allowed.length });
    log(`${mesh.name}: ${trisBefore} → ${triCount(geom)} tris`);
  }

  log('exporting');
  const glb = await withImageQuality(CONFIG.imageQuality, async () =>
    /** @type {ArrayBuffer} */ (await new GLTFExporter().parseAsync(out, { binary: true })),
  );
  report.bytes = glb.byteLength;
  report.bones = boneOrder.map(boneName);
  report.joints = Object.fromEntries([...newJ].map(([k, v]) => [k, v.clone().sub(/** @type {THREE.Vector3} */ (newJ.get('Hips'))).multiplyScalar(CONFIG.metresPerUnit).toArray().map((x) => +x.toFixed(3))]));
  log(`done: ${(glb.byteLength / 1e6).toFixed(2)} MB`);
  return { glb, report };
}

// ---------------------------------------------------------------- skeleton

/** New joint positions after scaling each chain segment along its length. */
function scaledJoints(/** @type {Map<string, THREE.Vector3>} */ J, /** @type {Map<string, string | null>} */ parentOf) {
  const out = new Map();
  for (const [name, parent] of parentOf) {
    const p = /** @type {THREE.Vector3} */ (J.get(name));
    if (!parent) {
      out.set(name, p.clone());
      continue;
    }
    const offset = p.clone().sub(/** @type {THREE.Vector3} */ (J.get(parent))).multiplyScalar(segmentScale(parent));
    out.set(name, out.get(parent).clone().add(offset));
  }
  return out;
}

function makeSkeleton(/** @type {Map<string, THREE.Vector3>} */ newJ, /** @type {Map<string, string | null>} */ parentOf, /** @type {string[]} */ order) {
  const s = CONFIG.metresPerUnit;
  const byName = new Map();
  const bones = order.map((name) => {
    const bone = new THREE.Bone();
    bone.name = boneName(name);
    byName.set(name, bone);
    return bone;
  });
  for (const name of order) {
    const parent = parentOf.get(name);
    const bone = byName.get(name);
    if (parent) {
      bone.position.copy(/** @type {THREE.Vector3} */ (newJ.get(name))).sub(/** @type {THREE.Vector3} */ (newJ.get(parent))).multiplyScalar(s);
      byName.get(parent).add(bone);
    }
  }
  return { bones, skeleton: new THREE.Skeleton(bones) };
}

// ---------------------------------------------------------------- geometry

function triCount(/** @type {THREE.BufferGeometry} */ g) {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

function simplify(/** @type {THREE.BufferGeometry} */ geom, /** @type {number} */ ratio) {
  const pos = geom.attributes.position;
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const index = geom.index ? Uint32Array.from(geom.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
  if (ratio >= 1) return compact(geom, index);
  const target = Math.floor((index.length * ratio) / 3) * 3;
  const [simplified] = MeshoptSimplifier.simplify(index, positions, 3, target, 0.05);
  return compact(geom, simplified);
}

/** Keep only referenced vertices; copy position/normal/tangent/uv. */
function compact(/** @type {THREE.BufferGeometry} */ geom, /** @type {Uint32Array} */ index) {
  const remap = new Int32Array(geom.attributes.position.count).fill(-1);
  let n = 0;
  for (const i of index) if (remap[i] === -1) remap[i] = n++;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'tangent', 'uv']) {
    const a = geom.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(n * a.itemSize);
    for (let i = 0; i < remap.length; i++) {
      const j = remap[i];
      if (j < 0) continue;
      for (let c = 0; c < a.itemSize; c++) arr[j * a.itemSize + c] = a.getComponent(i, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const idx = n < 65536 ? new Uint16Array(index.length) : new Uint32Array(index.length);
  for (let k = 0; k < index.length; k++) idx[k] = remap[/** @type {number} */ (index[k])];
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---------------------------------------------------------------- skinning

function computeWeights(
  /** @type {THREE.BufferGeometry} */ geom,
  /** @type {Map<string, THREE.Vector3>} */ J,
  /** @type {Allowed} */ allowed,
  /** @type {Map<string, number>} */ boneIndex,
) {
  const pos = geom.attributes.position;
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  const segsFor = (/** @type {string[]} */ names) =>
    names.map((name) => {
      const seg = /** @type {{ to: string, radius: number }} */ (SEGMENTS[name]);
      return { index: /** @type {number} */ (boneIndex.get(name)), a: /** @type {THREE.Vector3} */ (J.get(name)), b: /** @type {THREE.Vector3} */ (J.get(seg.to)), r: seg.radius };
    });
  const cache = new Map();
  const v = new THREE.Vector3();
  const line = new THREE.Line3();
  const closest = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const names = typeof allowed === 'function' ? allowed(v) : allowed;
    if (!cache.has(names)) cache.set(names, segsFor(names));
    const segs = cache.get(names);
    const scored = segs.map(() => ({ index: 0, w: 0 }));
    segs.forEach((/** @type {{ index: number, a: THREE.Vector3, b: THREE.Vector3, r: number }} */ s, /** @type {number} */ k) => {
      line.set(s.a, s.b).closestPointToPoint(v, true, closest);
      const d = Math.max(closest.distanceTo(v) / s.r, 1e-3);
      const entry = /** @type {{ index: number, w: number }} */ (scored[k]);
      entry.index = s.index;
      entry.w = 1 / d ** WEIGHT_POWER;
    });
    const top = [...scored].sort((x, y) => y.w - x.w).slice(0, MAX_INFLUENCES);
    const sum = top.reduce((acc, t) => acc + t.w, 0);
    top.forEach((t, k) => {
      skinIndex[i * 4 + k] = t.index;
      skinWeight[i * 4 + k] = t.w / sum;
    });
  }
  return { skinIndex, skinWeight };
}

/**
 * Blend per-bone "scale along the bone axis" transforms by the skin weights (no shear).
 * Normals get the inverse-transpose of the same transform (scale along the axis by 1/k):
 * a squashed surface must have its normals tilted to match, or the lighting no longer
 * fits the shape and the fine bump detail smears into broad, wet-looking highlights.
 */
function applyProportions(
  /** @type {THREE.BufferGeometry} */ geom,
  /** @type {Map<string, THREE.Vector3>} */ J,
  /** @type {Map<string, THREE.Vector3>} */ newJ,
  /** @type {Uint16Array} */ skinIndex,
  /** @type {Float32Array} */ skinWeight,
  /** @type {string[]} */ order,
) {
  const per = order.map((name) => {
    const seg = SEGMENTS[name];
    const a = /** @type {THREE.Vector3} */ (J.get(name));
    const axis = seg ? /** @type {THREE.Vector3} */ (J.get(seg.to)).clone().sub(a).normalize() : new THREE.Vector3(0, 1, 0);
    return { a, na: /** @type {THREE.Vector3} */ (newJ.get(name)), axis, k: seg ? segmentScale(name) : 1 };
  });
  const pos = geom.attributes.position;
  const nor = geom.getAttribute('normal');
  const tan = geom.getAttribute('tangent');
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const t = new THREE.Vector3();
  const accT = new THREE.Vector3();
  const rel = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const accN = new THREE.Vector3();
  const part = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (nor) n.fromBufferAttribute(nor, i);
    if (tan) t.set(tan.getX(i), tan.getY(i), tan.getZ(i));
    acc.set(0, 0, 0);
    accN.set(0, 0, 0);
    accT.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = /** @type {number} */ (skinWeight[i * 4 + k]);
      if (w === 0) continue;
      const b = /** @type {(typeof per)[number]} */ (per[/** @type {number} */ (skinIndex[i * 4 + k])]);
      rel.copy(v).sub(b.a);
      const along = rel.dot(b.axis);
      part.copy(rel).addScaledVector(b.axis, along * (b.k - 1)).add(b.na);
      acc.addScaledVector(part, w);
      if (nor) {
        part.copy(n).addScaledVector(b.axis, n.dot(b.axis) * (1 / b.k - 1)).normalize();
        accN.addScaledVector(part, w);
      }
      if (tan) {
        // Tangents lie IN the surface: they stretch like positions (k), not like normals.
        part.copy(t).addScaledVector(b.axis, t.dot(b.axis) * (b.k - 1)).normalize();
        accT.addScaledVector(part, w);
      }
    }
    pos.setXYZ(i, acc.x, acc.y, acc.z);
    if (nor) {
      accN.normalize();
      nor.setXYZ(i, accN.x, accN.y, accN.z);
    }
    if (tan) {
      // Re-orthogonalize against the new normal; keep the handedness sign in .w.
      accT.addScaledVector(accN, -accT.dot(accN)).normalize();
      tan.setXYZ(i, accT.x, accT.y, accT.z);
    }
  }
}

function toMetres(/** @type {THREE.BufferGeometry} */ geom, /** @type {THREE.Vector3} */ hips) {
  geom.translate(-hips.x, -hips.y, -hips.z);
  geom.scale(CONFIG.metresPerUnit, CONFIG.metresPerUnit, CONFIG.metresPerUnit);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
}

// ---------------------------------------------------------------- textures

/**
 * GLTFExporter encodes images with canvas.toBlob(cb, type) and no quality argument
 * (browser default ≈ 0.8). Inject our quality for the duration of the export.
 */
async function withImageQuality(/** @type {number} */ quality, /** @type {() => Promise<ArrayBuffer>} */ fn) {
  const proto = HTMLCanvasElement.prototype;
  const original = proto.toBlob;
  proto.toBlob = function (callback, type, q) {
    const lossy = type === 'image/webp' || type === 'image/jpeg';
    return original.call(this, callback, type, lossy && q === undefined ? quality : q);
  };
  try {
    return await fn();
  } finally {
    proto.toBlob = original;
  }
}

function shrinkTextures(/** @type {THREE.MeshStandardMaterial} */ m, /** @type {number} */ size, /** @type {Set<unknown>} */ done) {
  const color = CONFIG.imageType;
  const data = CONFIG.dataImageType;
  /** @type {Array<[THREE.Texture | null, number, string]>} */
  const maps = [
    [m.map, size, color],
    [m.normalMap, size, data],
    [m.roughnessMap, Math.max(size / 2, 128), data],
    [m.metalnessMap, Math.max(size / 2, 128), data],
    [m.emissiveMap, size, color],
    [m.aoMap, Math.max(size / 2, 128), data],
  ];
  for (const [tex, max, type] of maps) {
    if (!tex || done.has(tex)) continue;
    done.add(tex);
    const img = /** @type {{ width: number, height: number }} */ (tex.image);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.drawImage(/** @type {CanvasImageSource} */ (tex.image), 0, 0, canvas.width, canvas.height);
    tex.image = canvas;
    tex.userData.mimeType = type;
    tex.needsUpdate = true;
  }
}
