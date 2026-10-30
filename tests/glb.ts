import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';

interface GltfNode {
  name?: string;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  children?: number[];
}

/** Rest (bind) world positions of every named node in a .glb — no GLTFLoader needed. */
export function glbPositions(path: string): (name: string) => Vector3 {
  const buf = readFileSync(new URL(`../${path}`, import.meta.url));
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { nodes: GltfNode[] };
  const parent = new Map<number, number>();
  gltf.nodes.forEach((n, i) => n.children?.forEach((c) => parent.set(c, i)));
  const local = (n: GltfNode): Matrix4 => {
    if (n.matrix) return new Matrix4().fromArray(n.matrix);
    return new Matrix4().compose(
      new Vector3(...((n.translation ?? [0, 0, 0]) as [number, number, number])),
      new Quaternion(...((n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])),
      new Vector3(...((n.scale ?? [1, 1, 1]) as [number, number, number])),
    );
  };
  const world = (i: number): Matrix4 => {
    const m = local(gltf.nodes[i] as GltfNode);
    const p = parent.get(i);
    return p === undefined ? m : world(p).multiply(m);
  };
  return (name: string) => {
    const i = gltf.nodes.findIndex((n) => n.name === name);
    if (i < 0) throw new Error(`${path}: no node "${name}"`);
    return new Vector3().setFromMatrixPosition(world(i));
  };
}
