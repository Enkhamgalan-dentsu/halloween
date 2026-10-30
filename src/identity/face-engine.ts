/**
 * Face recognition with @vladmandic/face-api (TensorFlow.js, WebGL): tiny face detector
 * → tiny 68-point landmarks (alignment) → 128-d descriptor. The library (~1.3 MB JS) is
 * loaded lazily; the weights (~6.7 MB, self-hosted in /models/face/, see
 * scripts/fetch-assets.mjs) are fetched by us — preloaded from index.html, with progress —
 * and handed to face-api as weight maps (identical to loadFromUri, minus a round trip).
 */
import type * as FaceApi from '@vladmandic/face-api';
import { fetchBytes } from '../util/fetch-bytes.ts';

export type FaceInput = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;

export interface FaceResult {
  descriptor: Float32Array;
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

export const FACE_MODEL_URL = `${import.meta.env.BASE_URL}models/face`;

/** face-api net → weight file stem (index.html preloads the same files). */
const NETS = {
  tinyFaceDetector: 'tiny_face_detector_model',
  faceLandmark68TinyNet: 'face_landmark_68_tiny_model',
  faceRecognitionNet: 'face_recognition_model',
} as const;
type NetName = keyof typeof NETS;

/** Decoded size of the three .bin files (progress bar when sizes are unknown). */
export const FACE_WEIGHT_BYTES = 6_714_577;

export interface FaceWeights {
  net: NetName;
  specs: FaceApi.WeightSpec[];
  bin: ArrayBuffer;
}

/** Start downloading all face weights now (manifests + bins in parallel). */
export function fetchFaceWeights(onProgress?: (loadedBytes: number) => void): Promise<FaceWeights[]> {
  const loaded: Partial<Record<NetName, number>> = {};
  const report = () => onProgress?.(Object.values(loaded).reduce((a, b) => a + (b ?? 0), 0));
  return Promise.all(
    (Object.keys(NETS) as NetName[]).map(async (net) => {
      const base = `${FACE_MODEL_URL}/${NETS[net]}`;
      const [manifest, bytes] = await Promise.all([
        fetch(`${base}-weights_manifest.json`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} loading ${base}-weights_manifest.json`);
          return r.json() as Promise<Array<{ weights: FaceApi.WeightSpec[] }>>;
        }),
        fetchBytes(`${base}.bin`, (n) => {
          loaded[net] = n;
          report();
        }),
      ]);
      return { net, specs: manifest.flatMap((group) => group.weights), bin: bytes.buffer };
    }),
  );
}

export class FaceEngine {
  readonly backend: string;
  private readonly api: typeof FaceApi;

  private constructor(api: typeof FaceApi) {
    this.api = api;
    this.backend = api.tf.getBackend();
  }

  /** `weights`: pass an early `fetchFaceWeights()` so the download overlaps everything else. */
  static async load(weights: Promise<FaceWeights[]> = fetchFaceWeights()): Promise<FaceEngine> {
    const api = await import('@vladmandic/face-api');
    try {
      await api.tf.setBackend('webgl');
    } catch {
      /* falls back to whatever tfjs picks (wasm/cpu) */
    }
    await api.tf.ready();
    for (const w of await weights) api.nets[w.net].loadFromWeightMap(api.tf.io.decodeWeights(w.bin, w.specs));
    const engine = new FaceEngine(api);
    await engine.warmUp();
    return engine;
  }

  /**
   * The first WebGL inference of each net compiles its shaders — seconds on a phone. Run
   * the WHOLE pipeline once behind the loading screen, so the first real face check on the
   * camera view is fast. A blank image isn't enough (no face → landmarks + recognition never
   * run); grey noise with a near-zero detector threshold always yields a "face".
   */
  private async warmUp(): Promise<void> {
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 100 + ((i * 2654435761) >>> 24) / 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    await this.api
      .detectSingleFace(c, new this.api.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 1e-4 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor()
      .then(
        () => undefined,
        () => undefined,
      );
  }

  /**
   * Descriptor of the most prominent face in `input` (a head crop, or a photo), or null.
   * inputSize: 160 for small head crops, 320–416 for whole frames / photos.
   */
  async describe(input: FaceInput, inputSize = 160): Promise<Float32Array | null> {
    return (await this.analyze(input, inputSize))?.descriptor ?? null;
  }

  /** Like describe(), plus where the face is (input pixels) and the detector score. */
  async analyze(input: FaceInput, inputSize = 160): Promise<FaceResult | null> {
    const result = await this.api
      .detectSingleFace(input, new this.api.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.35 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (!result) return null;
    const { x, y, width, height } = result.detection.box;
    return { descriptor: result.descriptor, box: { x, y, width, height }, score: result.detection.score };
  }
}
