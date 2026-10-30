/**
 * Face recognition with @vladmandic/face-api (TensorFlow.js, WebGL): tiny face detector
 * → tiny 68-point landmarks (alignment) → 128-d descriptor. Loaded lazily (dynamic import,
 * ~1.3 MB JS + ~6.7 MB models self-hosted in /models/face/, see scripts/fetch-assets.mjs).
 */
import type * as FaceApi from '@vladmandic/face-api';

export type FaceInput = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;

export interface FaceResult {
  descriptor: Float32Array;
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

export const FACE_MODEL_URL = `${import.meta.env.BASE_URL}models/face`;

export class FaceEngine {
  readonly backend: string;
  private readonly api: typeof FaceApi;

  private constructor(api: typeof FaceApi) {
    this.api = api;
    this.backend = api.tf.getBackend();
  }

  static async load(): Promise<FaceEngine> {
    const api = await import('@vladmandic/face-api');
    try {
      await api.tf.setBackend('webgl');
    } catch {
      /* falls back to whatever tfjs picks (wasm/cpu) */
    }
    await api.tf.ready();
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL),
      api.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_URL),
      api.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL),
    ]);
    const engine = new FaceEngine(api);
    // Warm-up: the first WebGL inference compiles shaders (~1 s) — do it behind the loader.
    const blank = document.createElement('canvas');
    blank.width = blank.height = 160;
    await engine.describe(blank).catch(() => null);
    return engine;
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
