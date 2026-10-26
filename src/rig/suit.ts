import { Bone, Group, SkeletonHelper, Vector3 } from 'three';
import type { Object3D, Quaternion } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BONE_KEYS, SUIT_BONES, jointNodeName } from './bones.ts';
import type { BoneKey } from './bones.ts';
import { JOINT_NAMES } from './rest-pose.ts';
import type { RestPose } from './rest-pose.ts';
import type { SolvedPose } from './solver.ts';

/** Show the suit once tracking confidence is above this; hide below the lower bound. */
const SHOW_ABOVE = 0.5;
const HIDE_BELOW = 0.25;

/** The loaded, rigged suit: a root Group (placed/scaled each frame) + named bones. */
export class Suit {
  readonly root = new Group();
  /** Rest-pose joints read from the skeleton (metres, hips at origin). */
  readonly rest: RestPose;
  private readonly bones: Record<BoneKey, Bone>;
  private shown = false;

  static async load(url: string): Promise<Suit> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Suit(gltf.scene);
  }

  private constructor(model: Object3D) {
    this.root.name = 'suit-root';
    this.root.add(model);
    this.root.updateMatrixWorld(true);

    const find = (name: string): Object3D => {
      const o = model.getObjectByName(name);
      if (!o) throw new Error(`Suit GLB is missing node "${name}"`);
      return o;
    };

    const bones = {} as Record<BoneKey, Bone>;
    for (const key of BONE_KEYS) {
      const o = find(SUIT_BONES[key]);
      if (!(o instanceof Bone)) throw new Error(`Suit node "${SUIT_BONES[key]}" is not a bone`);
      bones[key] = o;
    }
    this.bones = bones;

    const hips = find(jointNodeName('Hips')).getWorldPosition(new Vector3());
    const rest = {} as RestPose;
    for (const j of JOINT_NAMES) rest[j] = find(jointNodeName(j)).getWorldPosition(new Vector3()).sub(hips);
    this.rest = rest;

    // Bounding volumes are from the bind pose; a posed suit would get culled wrongly.
    model.traverse((o) => {
      if ('isSkinnedMesh' in o && o.isSkinnedMesh) o.frustumCulled = false;
    });
    this.root.visible = false;
  }

  apply(pose: SolvedPose): void {
    this.applyLocal(pose.local);
  }

  applyLocal(local: Record<BoneKey, Quaternion>): void {
    for (const key of BONE_KEYS) this.bones[key].quaternion.copy(local[key]);
  }

  place(position: Vector3, scale: number): void {
    this.root.position.copy(position);
    this.root.scale.setScalar(scale);
  }

  /** Show/hide with hysteresis, so weak tracking never shows a twisted rig. */
  setConfidence(confidence: number): void {
    if (!this.shown && confidence > SHOW_ABOVE) this.shown = true;
    else if (this.shown && confidence < HIDE_BELOW) this.shown = false;
    this.root.visible = this.shown;
  }

  hide(): void {
    this.shown = false;
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** ?debug: draws the suit's bones. */
  makeHelper(): SkeletonHelper {
    return new SkeletonHelper(this.root);
  }
}
