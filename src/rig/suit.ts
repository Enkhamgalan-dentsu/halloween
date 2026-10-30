import { Bone, Group, Quaternion, SkeletonHelper, Vector3 } from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { BoneKey } from './bones.ts';
import { analyzeRig } from './profiles.ts';
import type { RigAnalysis, SuitProfile } from './profiles.ts';

/** Show the suit once tracking confidence is above this; hide below the lower bound. */
const SHOW_ABOVE = 0.5;
const HIDE_BELOW = 0.25;

interface ChainEntry {
  bone: Bone;
  key: BoneKey | null;
  /** Index of the parent bone in the chain, or −1 if the parent is not a bone. */
  parent: number;
  /** World rotation (model space) of a non-bone parent — never moves. */
  staticParentWorld: Quaternion;
  restLocal: Quaternion;
  restWorld: Quaternion;
}

/**
 * A loaded, rigged suit. `root` is placed and scaled every frame; inside it the model is
 * offset so the profile's anchor (the suit's hips) sits at the root's origin.
 *
 * `applyDeltas` takes the solver's model-space "rotation away from rest" per bone key and
 * walks the real skeleton (parents first): driven bones get  W = delta · restWorld,
 * undriven bones (Bonnie's Hip_Bn_05, fingers, ears, the mermaid's chain ends…) keep their
 * rest offset from their parent, and every bone's local rotation is parentW⁻¹ · W. That
 * makes any rest pose work — identity (mermaid) or an FBX T-pose (Bonnie).
 */
export class Suit {
  readonly root = new Group();
  readonly profile: SuitProfile;
  readonly rig: RigAnalysis;
  private readonly chain: ChainEntry[] = [];
  private readonly world: Quaternion[] = [];
  private readonly tmp = new Quaternion();
  private shown = false;

  static async load(profile: SuitProfile, onProgress?: (loaded: number, total: number) => void): Promise<Suit> {
    const gltf = await new GLTFLoader().loadAsync(profile.url, (e) => onProgress?.(e.loaded, e.total));
    return new Suit(profile, gltf.scene);
  }

  /** Wrap an already-loaded model (tests, tools). */
  static fromModel(profile: SuitProfile, model: Object3D): Suit {
    return new Suit(profile, model);
  }

  private constructor(profile: SuitProfile, model: Object3D) {
    this.profile = profile;
    this.root.name = `suit-${profile.id}`;
    const holder = new Group();
    holder.add(model);
    this.root.add(holder);
    this.root.updateMatrixWorld(true);

    const find = (name: string): Object3D => {
      const o = model.getObjectByName(name);
      if (!o) throw new Error(`Suit "${profile.id}" is missing node "${name}"`);
      return o;
    };
    this.rig = analyzeRig(profile, (name) => find(name).getWorldPosition(new Vector3()));
    holder.position.copy(this.rig.anchor).negate();
    this.root.updateMatrixWorld(true);

    const keyOf = new Map<string, BoneKey>();
    for (const [key, b] of Object.entries(profile.bones) as Array<[BoneKey, { node: string }]>) {
      if (!(find(b.node) instanceof Bone)) throw new Error(`Suit node "${b.node}" is not a bone`);
      keyOf.set(b.node, key);
    }
    const index = new Map<Object3D, number>();
    model.traverse((o) => {
      if (!(o instanceof Bone)) return;
      // traverse() is depth-first pre-order: a bone's parent is always already indexed.
      const parent = o.parent ? (index.get(o.parent) ?? -1) : -1;
      index.set(o, this.chain.length);
      this.chain.push({
        bone: o,
        key: keyOf.get(o.name) ?? null,
        parent,
        staticParentWorld: o.parent ? o.parent.getWorldQuaternion(new Quaternion()) : new Quaternion(),
        restLocal: o.quaternion.clone(),
        restWorld: o.getWorldQuaternion(new Quaternion()),
      });
      this.world.push(new Quaternion());
    });

    // Bounding volumes are from the bind pose; a posed suit would get culled wrongly.
    model.traverse((o) => {
      if ('isSkinnedMesh' in o && o.isSkinnedMesh) o.frustumCulled = false;
    });
    this.root.visible = false;
  }

  /** Model-space rotations away from rest, per bone key (solver / follower output). */
  applyDeltas(delta: Record<BoneKey, Quaternion>): void {
    for (let i = 0; i < this.chain.length; i++) {
      const c = this.chain[i] as ChainEntry;
      const parentWorld = c.parent >= 0 ? (this.world[c.parent] as Quaternion) : c.staticParentWorld;
      const w = this.world[i] as Quaternion;
      if (c.key) w.copy(delta[c.key]).multiply(c.restWorld);
      else w.copy(parentWorld).multiply(c.restLocal);
      c.bone.quaternion.copy(this.tmp.copy(parentWorld).invert().multiply(w));
    }
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
