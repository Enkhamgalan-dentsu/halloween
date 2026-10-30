/**
 * The small part of @vladmandic/face-api (1.7.x) this app uses. Declared locally so the
 * rest of the code type-checks even before `npm install` fetches the package; the real
 * package's API is identical for these members.
 */
declare module '@vladmandic/face-api' {
  export type NamedTensorMap = Record<string, unknown>;
  export interface WeightSpec {
    name: string;
    shape: number[];
    dtype: string;
  }
  export interface Net {
    loadFromUri(uri: string): Promise<void>;
    loadFromWeightMap(weightMap: NamedTensorMap): void;
    isLoaded: boolean;
  }
  export const nets: {
    tinyFaceDetector: Net;
    faceLandmark68TinyNet: Net;
    faceRecognitionNet: Net;
  };
  export class TinyFaceDetectorOptions {
    constructor(options?: { inputSize?: number; scoreThreshold?: number });
  }
  export interface FaceDetectionResult {
    score: number;
    box: { x: number; y: number; width: number; height: number };
  }
  export interface DescribedFace {
    detection: FaceDetectionResult;
    descriptor: Float32Array;
  }
  interface DescriptorTask extends PromiseLike<DescribedFace | undefined> {}
  interface LandmarksTask {
    withFaceDescriptor(): DescriptorTask;
  }
  interface SingleFaceTask extends PromiseLike<{ detection: FaceDetectionResult } | undefined> {
    withFaceLandmarks(useTinyLandmarkNet?: boolean): LandmarksTask;
  }
  export function detectSingleFace(input: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, options?: TinyFaceDetectorOptions): SingleFaceTask;
  export const tf: {
    io: { decodeWeights(buffer: ArrayBuffer, specs: WeightSpec[]): NamedTensorMap };
    setBackend(name: string): Promise<boolean>;
    ready(): Promise<void>;
    getBackend(): string;
  };
}
