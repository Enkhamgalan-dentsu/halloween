import './styles.css';
import { readConfig } from './config.ts';
import { friendlyCameraError, startCamera, startVideoFile } from './camera.ts';
import type { CameraInfo } from './camera.ts';
import { OverlayScene } from './scene.ts';
import { DebugHud } from './debug/hud.ts';
import { SkeletonOverlay } from './debug/skeleton.ts';
import { MediaPipePoseTracker } from './tracking/mediapipe-pose.ts';
import { PoseSmoother } from './tracking/smoothing.ts';
import { WearerSelector } from './tracking/select.ts';
import type { PoseFrame } from './tracking/pose.ts';
import { SUIT_URL } from './rig/bones.ts';
import { FacingEstimator } from './rig/facing.ts';
import { RootPlacer } from './rig/placement.ts';
import { PoseSolver } from './rig/solver.ts';
import type { SolvedPose } from './rig/solver.ts';
import { Suit } from './rig/suit.ts';
import { SuitFollower } from './rig/follow.ts';
import { coverMapping } from './util/viewport.ts';
import { Ema, RateCounter } from './util/rate.ts';

/** Wearer not seen for this long → drop the pose and hide the suit. */
const LOST_AFTER_MS = 500;
/** Nobody seen for this long → show the "point at the costume" hint. */
const HINT_AFTER_MS = 2000;

const cfg = readConfig();

const stage = document.getElementById('stage') as HTMLDivElement;
const video = document.getElementById('camera') as HTMLVideoElement;
const canvas = document.getElementById('overlay') as HTMLCanvasElement;
const startScreen = document.getElementById('start-screen') as HTMLDivElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const pill = document.getElementById('pill') as HTMLDivElement;

const setStatus = (msg: string) => {
  statusEl.textContent = msg;
};
const showPill = (msg: string | null) => {
  const hidden = msg === null;
  if (pill.hidden !== hidden) pill.hidden = hidden;
  if (msg !== null && pill.textContent !== msg) pill.textContent = msg;
};

// Start downloading the tracker (~20 MB) and the suit (~2 MB) immediately, while the
// guest reads the start screen and answers the camera prompt. Errors surface in start().
let loadPercent = 0;
const tracker = new MediaPipePoseTracker({
  model: cfg.poseModel,
  numPoses: 3,
  onProgress: (p) => {
    loadPercent = Math.round(p.fraction * 100);
    if (!pill.hidden && !tracker.ready) showPill(`Summoning spirits… ${loadPercent}%`);
  },
});
const trackerReady = tracker.init();
trackerReady.catch(() => {});
const suitReady = Suit.load(SUIT_URL);
suitReady.catch(() => {});

// ---- tracking state (written by the video-frame loop, read by the render loop) ----
const smoother = new PoseSmoother(cfg.smoothing);
const selector = new WearerSelector();
let wearer: PoseFrame | null = null; // smoothed; same object every frame
let others: PoseFrame[] = [];
let lastSeenMs = -Infinity;
let trackingStartedMs = 0;
const poseRate = new RateCounter();
const detectMs = new Ema(0.1);
let detectErrors = 0;

interface Rig {
  suit: Suit;
  solver: PoseSolver;
  placer: RootPlacer;
  facing: FacingEstimator;
  follower: SuitFollower;
  wasVisible: boolean;
  last: SolvedPose | null;
}
let rig: Rig | null = null;

function onVideoFrame(nowMs: number): void {
  const t0 = performance.now();
  let frames: PoseFrame[];
  try {
    frames = tracker.detect(video, nowMs);
  } catch (err) {
    // Keep the loop alive (e.g. a dropped GPU frame); log only the first few.
    if (detectErrors++ < 3) console.error('[pose] detect failed', err);
    return;
  }
  detectMs.push(performance.now() - t0);
  poseRate.tick(nowMs);

  const i = selector.select(frames);
  const picked = i >= 0 ? frames[i] : undefined;
  if (picked) {
    wearer = smoother.apply(picked);
    others = frames.filter((_, j) => j !== i);
    lastSeenMs = nowMs;
  } else {
    others = frames;
    if (wearer && nowMs - lastSeenMs > LOST_AFTER_MS) {
      wearer = null;
      smoother.reset();
      selector.reset();
      rig?.placer.reset();
      rig?.suit.hide();
    }
  }

  if (rig && wearer && picked) driveSuit(rig, wearer, nowMs);

  const sinceSeen = nowMs - Math.max(lastSeenMs, trackingStartedMs);
  showPill(sinceSeen > HINT_AFTER_MS ? 'Point your camera at the costume' : null);
}

/** Landmarks → suit pose + placement. Runs once per camera frame. */
function driveSuit(r: Rig, frame: PoseFrame, nowMs: number): void {
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  // Raw (un-mirrored) mapping: the 3D layer is mirrored in CSS for the selfie camera.
  const mapping = coverMapping(video.videoWidth, video.videoHeight, viewW, viewH, false);
  const facing = r.facing.update(frame);
  const pose = r.solver.solve(frame, facing, nowMs);
  const placed = r.placer.update(frame, mapping, viewW, viewH, cfg.fov);
  if (!placed) {
    r.suit.setConfidence(0);
    return;
  }
  // Only set the target here; the render loop eases toward it every frame (follow.ts).
  r.follower.setTarget(pose.local, r.placer.position, r.placer.scale);
  r.suit.setConfidence(pose.confidence);
  r.last = pose;
}

/** Every rendered frame: ease the displayed suit toward the latest tracked pose. */
function animateSuit(r: Rig, dtSeconds: number): void {
  const visible = r.suit.visible;
  if (visible && !r.wasVisible) r.follower.snap(); // appear in place, don't glide in
  r.wasVisible = visible;
  if (!visible) return;
  r.follower.update(dtSeconds);
  r.suit.applyLocal(r.follower.local);
  r.suit.place(r.follower.displayPosition, r.follower.scale);
}

/** ?debug: visibility / presence of the 4 torso landmarks — why the suit shows or hides. */
function torsoReliability(frame: PoseFrame): string {
  return [11, 12, 23, 24]
    .map((i) => {
      const l = frame.world[i];
      return `${(l?.visibility ?? 0).toFixed(1)}/${(l?.presence ?? 0).toFixed(1)}`;
    })
    .join(' ');
}

/** Run `onVideoFrame` once per *new* camera frame (not per screen refresh). */
function startTrackingLoop(): void {
  trackingStartedMs = performance.now();
  if (typeof video.requestVideoFrameCallback === 'function') {
    const step = (now: number) => {
      onVideoFrame(now);
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
  } else {
    let lastTime = -1;
    const step = (now: number) => {
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        onVideoFrame(now);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

async function start(): Promise<void> {
  startBtn.disabled = true;
  setStatus('Waking the dead…');

  let cameraInfo: CameraInfo | null = null;
  try {
    if (cfg.videoSrc) {
      await startVideoFile(video, cfg.videoSrc);
    } else {
      cameraInfo = (await startCamera(video, { facing: cfg.facing, zoom: cfg.zoom })).info;
    }
  } catch (err) {
    console.error(err);
    setStatus(friendlyCameraError(err));
    startBtn.disabled = false;
    return;
  }

  const mirrored = cfg.facing === 'user' && !cfg.videoSrc;
  document.body.classList.toggle('mirrored', mirrored);
  startScreen.hidden = true;

  const overlay = new OverlayScene(canvas, cfg.fov);
  const skeleton = cfg.debug ? new SkeletonOverlay(stage) : null;
  const onResize = () => {
    overlay.resize(window.innerWidth, window.innerHeight);
    skeleton?.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);
  onResize();

  const hud = cfg.debug
    ? new DebugHud(() => ({
        pose: `${poseRate.hz.toFixed(1)} Hz`,
        detect: `${detectMs.value.toFixed(1)} ms`,
        people: others.length + (wearer ? 1 : 0),
        backend: tracker.delegate ?? 'loading',
        suit: rig ? (rig.suit.visible ? 'shown' : 'hidden') : 'loading',
        conf: rig?.last ? rig.last.confidence.toFixed(2) : '—',
        facing: rig ? `${rig.facing.facing} (face ${rig.facing.faceScore.toFixed(2)})` : '—',
        swapLR: rig?.last ? rig.last.swapped : '—',
        depth: rig?.placer.valid ? `${rig.placer.depth.toFixed(2)} m` : '—',
        scale: rig?.placer.valid ? rig.placer.scale.toFixed(2) : '—',
        video: `${video.videoWidth}×${video.videoHeight}`,
        view: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
        side: cfg.side,
        camera: cfg.videoSrc ? 'file' : cfg.facing,
        lens: cameraInfo ? `${cameraInfo.wide}${cameraInfo.zoom !== null ? ` (zoom ${cameraInfo.zoom})` : ''}` : '—',
        label: cameraInfo?.label.slice(0, 28) ?? '—',
        torso: wearer ? torsoReliability(wearer) : '—',
        model: cfg.poseModel,
        smooth: `mc ${cfg.smoothing.minCutoff} β ${cfg.smoothing.beta}`,
        fov: `${cfg.fov}°`,
        size: cfg.size,
        float: cfg.float,
      }))
    : null;

  let lastFrameMs = -1;
  overlay.renderer.setAnimationLoop((time: number) => {
    const dt = lastFrameMs < 0 ? 0 : (time - lastFrameMs) / 1000;
    lastFrameMs = time;
    if (rig) animateSuit(rig, dt);
    overlay.render();
    if (skeleton && video.videoWidth > 0) {
      const mapping = coverMapping(video.videoWidth, video.videoHeight, window.innerWidth, window.innerHeight, mirrored);
      skeleton.draw(wearer, others, mapping);
    }
    hud?.tick(time);
  });

  if (!tracker.ready) showPill(`Summoning spirits… ${loadPercent}%`);
  let suit: Suit;
  try {
    [, suit] = await Promise.all([trackerReady, suitReady]);
  } catch (err) {
    console.error(err);
    showPill('Could not load the costume. Check your connection and reload.');
    return;
  }

  overlay.scene.add(suit.root);
  if (cfg.debug) overlay.scene.add(suit.makeHelper());
  rig = {
    suit,
    solver: new PoseSolver(suit.rest, { headPitch: (cfg.headPitchDeg * Math.PI) / 180, finMode: cfg.fin }),
    placer: Object.assign(new RootPlacer(suit.rest), { sizeMultiplier: cfg.size }),
    facing: new FacingEstimator(cfg.side),
    follower: new SuitFollower({ float: cfg.float }),
    wasVisible: false,
    last: null,
  };

  showPill(null);
  startTrackingLoop();
  if (cfg.debug) console.info('[haunted-suit] config', cfg, 'backend', tracker.delegate);
}

startBtn.addEventListener('click', () => void start());
