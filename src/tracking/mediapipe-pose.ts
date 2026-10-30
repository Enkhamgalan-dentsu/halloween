import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseModel } from '../config.ts';
import { fetchBytes } from '../util/fetch-bytes.ts';
import type { PoseFrame, PoseTracker } from './pose.ts';

type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
type Delegate = 'GPU' | 'CPU';

export interface LoadProgress {
  /** 0..1 across wasm runtime + model. */
  fraction: number;
  loadedMB: number;
}

export interface MediaPipePoseOptions {
  model: PoseModel;
  /** Track several people so the wearer can be picked (see select.ts). */
  numPoses?: number;
  onProgress?: (p: LoadProgress) => void;
}

const BASE = import.meta.env.BASE_URL;

/** Used for the progress bar when the server doesn't send a usable Content-Length. */
const APPROX_BYTES = { wasm: 13.5e6, lite: 5.8e6, full: 9.4e6 } as const;

/**
 * PoseTracker backed by MediaPipe PoseLandmarker.
 *
 * The wasm runtime and the model are self-hosted (public/mediapipe/wasm, public/models,
 * see scripts/fetch-assets.mjs) and downloaded with fetch() so we can show progress:
 * the model goes in as a buffer, the wasm binary as a blob: URL. If that fails we fall
 * back to letting MediaPipe load the files itself, and from GPU to CPU inference.
 */
export class MediaPipePoseTracker implements PoseTracker {
  delegate: Delegate | null = null;

  private readonly opts: MediaPipePoseOptions;
  private landmarker: PoseLandmarker | null = null;
  private initPromise: Promise<void> | null = null;
  private lastTimestamp = -1;

  constructor(opts: MediaPipePoseOptions) {
    this.opts = opts;
  }

  /** Safe to call more than once; downloads start on the first call. */
  init(): Promise<void> {
    this.initPromise ??= this.load();
    return this.initPromise;
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  detect(video: HTMLVideoElement, timestampMs: number): PoseFrame[] {
    const landmarker = this.landmarker;
    if (!landmarker || video.videoWidth === 0) return [];

    // VIDEO mode requires strictly increasing timestamps.
    const ts = timestampMs > this.lastTimestamp ? timestampMs : this.lastTimestamp + 1;
    this.lastTimestamp = ts;

    const result = landmarker.detectForVideo(video, ts);
    const frames: PoseFrame[] = result.landmarks.map((image, i) => ({
      timestampMs: ts,
      image,
      world: result.worldLandmarks[i] ?? [],
    }));
    result.close(); // frees segmentation masks if any; landmark arrays stay valid
    return frames;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }

  private async load(): Promise<void> {
    const { model, onProgress } = this.opts;
    const parts = {
      wasm: { loaded: 0, total: APPROX_BYTES.wasm },
      model: { loaded: 0, total: APPROX_BYTES[model] },
    };
    const report = () => {
      const loaded = parts.wasm.loaded + parts.model.loaded;
      const total = parts.wasm.total + parts.model.total;
      onProgress?.({ fraction: Math.min(loaded / total, 1), loadedMB: loaded / 1e6 });
    };
    const track = (part: { loaded: number; total: number }) => (loaded: number, total: number | null) => {
      part.loaded = loaded;
      if (total) part.total = total;
      report();
    };

    // The model doesn't depend on the wasm variant: don't wait for the SIMD probe.
    const modelReady = fetchBytes(`${BASE}models/pose_landmarker_${model}.task`, track(parts.model));
    modelReady.catch(() => {});
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
    const [wasmBytes, modelBytes] = await Promise.all([fetchBytes(fileset.wasmBinaryPath, track(parts.wasm)), modelReady]);
    onProgress?.({ fraction: 1, loadedMB: (wasmBytes.byteLength + modelBytes.byteLength) / 1e6 });

    const wasmUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));
    const prefetched: WasmFileset = { ...fileset, wasmBinaryPath: wasmUrl };
    const attempts: Array<[WasmFileset, Delegate]> = [
      [prefetched, 'GPU'],
      [fileset, 'GPU'],
      [fileset, 'CPU'],
    ];

    let lastError: unknown;
    try {
      for (const [files, delegate] of attempts) {
        try {
          this.landmarker = await this.create(files, modelBytes, delegate);
          this.delegate = delegate;
          return;
        } catch (err) {
          console.warn(`[pose] init failed (${delegate}), trying fallback`, err);
          lastError = err;
        }
      }
    } finally {
      URL.revokeObjectURL(wasmUrl);
    }
    throw lastError instanceof Error ? lastError : new Error('Pose tracker failed to initialise');
  }

  private create(files: WasmFileset, modelBytes: Uint8Array, delegate: Delegate): Promise<PoseLandmarker> {
    return PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: modelBytes, delegate },
      runningMode: 'VIDEO',
      numPoses: this.opts.numPoses ?? 3,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
  }
}
