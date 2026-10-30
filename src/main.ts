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
import { WearerLock } from './tracking/wearer-lock.ts';
import { PersonSampler } from './tracking/sampler.ts';
import { FaceEngine } from './identity/face-engine.ts';
import { FaceChecker } from './identity/face-check.ts';
import { FaceLock } from './identity/face-lock.ts';
import { parseEnrollment } from './identity/matcher.ts';
import type { Enrollment } from './identity/matcher.ts';
import type { PoseFrame } from './tracking/pose.ts';
import { FacingEstimator } from './rig/facing.ts';
import { RootPlacer } from './rig/placement.ts';
import { PoseSolver } from './rig/solver.ts';
import type { SolvedPose } from './rig/solver.ts';
import { Suit } from './rig/suit.ts';
import { SuitFollower } from './rig/follow.ts';
import { PROFILES } from './rig/profiles.ts';
import type { SuitProfile } from './rig/profiles.ts';
import { Loader } from './ui/loader.ts';
import { Haunt } from './ui/haunt.ts';
import { coverMapping } from './util/viewport.ts';
import { Ema, RateCounter } from './util/rate.ts';

/** Wearer not seen for this long → drop the pose and hide the suit. */
const LOST_AFTER_MS = 500;
/** Nobody seen for this long → show the "point at the costume" hint. */
const HINT_AFTER_MS = 2000;
/** The wearer's enrolled face (made with tools/enroll/, see README). */
const ENROLLMENT_URL = `${import.meta.env.BASE_URL}face/wearer.json`;
/** Rough download sizes for the combined progress bar when a size is unknown. */
const SUIT_BYTES_GUESS = 3.2e6;

const cfg = readConfig();

const stage = document.getElementById('stage') as HTMLDivElement;
const video = document.getElementById('camera') as HTMLVideoElement;
const canvas = document.getElementById('overlay') as HTMLCanvasElement;
const pill = document.getElementById('pill') as HTMLDivElement;
const arCredit = document.getElementById('ar-credit') as HTMLParagraphElement;

const showPill = (msg: string | null) => {
  const hidden = msg === null;
  if (pill.hidden !== hidden) pill.hidden = hidden;
  if (msg !== null && pill.textContent !== msg) pill.textContent = msg;
};

// ---- which costume: forced with ?suit=, otherwise a coin flip on every load ----
const profile: SuitProfile = PROFILES[cfg.suit ?? (Math.random() < 0.5 ? 'mermaid' : 'bonnie')];

const loader = new Loader();
const c = profile.credit;
loader.setCredit(
  `“<a href="${c.sourceUrl}" target="_blank" rel="noopener">${c.title}</a>” by ` +
    `<a href="${c.authorUrl}" target="_blank" rel="noopener">${c.author}</a>, ` +
    `<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> — adapted for this app.`,
);
arCredit.textContent = `“${c.title}” by ${c.author} · CC BY 4.0`;

// ---- downloads start immediately: tracker (~20 MB) + the chosen suit (~3 MB) ----
let trackerMB = 0;
let trackerFraction = 0;
let suitLoaded = 0;
let suitTotal = SUIT_BYTES_GUESS;
// Face models (~7 MB, no byte progress from face-api): counted when they're ready.
const FACE_MB = cfg.lock ? 7 : 0;
let faceDoneMB = 0;
const reportProgress = () => {
  const trackerTotalMB = trackerFraction > 0 ? trackerMB / trackerFraction : 19.3;
  const loadedMB = trackerMB + suitLoaded / 1e6 + faceDoneMB;
  loader.setProgress(loadedMB / (trackerTotalMB + suitTotal / 1e6 + FACE_MB));
};
const tracker = new MediaPipePoseTracker({
  model: cfg.poseModel,
  numPoses: 3,
  onProgress: (p) => {
    trackerMB = p.loadedMB;
    trackerFraction = p.fraction;
    reportProgress();
  },
});
const trackerReady = tracker.init();
trackerReady.catch(() => {});
// Face recognition (Phase 4): only if the wearer has enrolled; ?lock=0 skips it.
type Identity = { enrollment: Enrollment; engine: FaceEngine } | { error: string };
const identityReady: Promise<Identity> = cfg.lock ? loadIdentity() : Promise.resolve({ error: 'off (?lock=0)' });
void identityReady.then(() => {
  faceDoneMB = FACE_MB;
  reportProgress();
});
async function loadIdentity(): Promise<Identity> {
  let enrollment: Enrollment | null = null;
  try {
    const res = await fetch(ENROLLMENT_URL, { cache: 'no-cache' });
    if (res.ok) enrollment = parseEnrollment(await res.json());
  } catch {
    /* not deployed / bad JSON */
  }
  if (!enrollment) return { error: 'not enrolled (no face/wearer.json)' };
  try {
    return { enrollment, engine: await FaceEngine.load() };
  } catch (err) {
    console.error('[face] engine failed to load', err);
    return { error: 'face engine failed' };
  }
}
const suitReady = Suit.load(profile, (loaded, total) => {
  suitLoaded = loaded;
  if (total > 0) suitTotal = total;
  reportProgress();
});
suitReady.catch(() => {});

// ---- tracking state (written by the video-frame loop, read by the render loop) ----
const smoother = new PoseSmoother(cfg.smoothing);
const selector = new WearerSelector(); // fallback (not enrolled / ?lock=0): most central person
// Default: the costume goes ONLY on the enrolled wearer's face (Phase 4).
const lock = new WearerLock();
const sampler = new PersonSampler();
let faceLock: FaceLock | null = null;
let identityNote = 'loading';
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

  const i = faceLock ? pickWearer(frames, nowMs, faceLock) : selector.select(frames);
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

  if (faceLock && lock.state === 'searching') rig?.suit.hide(); // never linger on someone else
  if (rig && wearer && picked) driveSuit(rig, wearer, nowMs);

  const sinceSeen = nowMs - Math.max(lastSeenMs, trackingStartedMs);
  showPill(
    sinceSeen <= HINT_AFTER_MS
      ? null
      : faceLock && frames.length > 0
        ? 'Point the camera at the wearer’s face'
        : 'Point your camera at the costume',
  );
}

/**
 * Which detected person is the wearer? Follows the lock (continuity + clothing
 * fingerprint) and lets the face checks confirm / reject it. Returns −1 for nobody.
 */
function pickWearer(frames: PoseFrame[], nowMs: number, faces: FaceLock): number {
  const prints = new Map<number, Float32Array | null>();
  const appearance = (k: number) => {
    if (!prints.has(k)) prints.set(k, frames[k] ? sampler.fingerprint(video, frames[k]) : null);
    return prints.get(k) ?? null;
  };
  const i = lock.update(frames, nowMs, appearance);
  faces.tick(frames, i, nowMs);
  return i;
}

function makeFaceLock(enrollment: Enrollment, engine: FaceEngine): FaceLock {
  return new FaceLock(new FaceChecker(engine, enrollment, sampler), lock, video, {
    fingerprint: (frame) => sampler.fingerprint(video, frame),
    onWearerChanged: () => {
      // A different person: don't smooth/glide from the previous body.
      smoother.reset();
      rig?.placer.reset();
      rig?.follower.snap();
    },
    onRejected: () => rig?.suit.hide(),
    now: () => performance.now(),
  });
}

/** Landmarks → suit pose target. Runs once per camera frame. */
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
  r.follower.setTarget(pose.delta, r.placer.position, r.placer.scale);
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
  r.suit.applyDeltas(r.follower.rotations);
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

/**
 * Camera, started straight away (no tap). Browsers that insist on a user gesture — some
 * in-app QR browsers — reject with NotAllowedError; then the loader offers a button.
 */
function openCamera(): Promise<CameraInfo | null> {
  return new Promise((resolve) => {
    const attempt = async () => {
      try {
        if (cfg.videoSrc) {
          await startVideoFile(video, cfg.videoSrc);
          resolve(null);
        } else {
          resolve((await startCamera(video, { facing: cfg.facing, zoom: cfg.zoom })).info);
        }
      } catch (err) {
        console.error(err);
        const blocked = err instanceof Error && err.name === 'NotAllowedError';
        loader.showError(friendlyCameraError(err), blocked ? 'Allow camera' : 'Try again', () => void attempt());
      }
    };
    void attempt();
  });
}

async function boot(): Promise<void> {
  const cameraReady = openCamera();

  let suit: Suit;
  let cameraInfo: CameraInfo | null;
  let identity: Identity;
  try {
    [, suit, cameraInfo, identity] = await Promise.all([trackerReady, suitReady, cameraReady, identityReady]);
  } catch (err) {
    console.error(err);
    loader.showError('The spirits could not be summoned. Check your connection and reload.', 'Reload', () =>
      window.location.reload(),
    );
    return;
  }

  if ('engine' in identity) {
    faceLock = makeFaceLock(identity.enrollment, identity.engine);
    identityNote = `${identity.enrollment.descriptors.length} faces · ${identity.engine.backend}`;
  } else {
    identityNote = identity.error; // fallback: the most central person wears the suit
    if (cfg.lock) console.warn(`[face] ${identity.error} — costume goes on the most central person`);
  }

  const mirrored = cfg.facing === 'user' && !cfg.videoSrc;
  document.body.classList.toggle('mirrored', mirrored);

  const overlay = new OverlayScene(canvas, cfg.fov);
  const skeleton = cfg.debug ? new SkeletonOverlay(stage) : null;
  const onResize = () => {
    overlay.resize(window.innerWidth, window.innerHeight);
    skeleton?.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);
  onResize();

  overlay.scene.add(suit.root);
  if (cfg.debug) overlay.scene.add(suit.makeHelper());
  rig = {
    suit,
    solver: new PoseSolver(suit.rig.restDir, { headPitch: (cfg.headPitchDeg * Math.PI) / 180, finMode: cfg.fin }),
    placer: Object.assign(new RootPlacer(suit.rig.measure), { sizeMultiplier: cfg.size }),
    facing: new FacingEstimator(cfg.side),
    follower: new SuitFollower({ float: cfg.float }),
    wasVisible: false,
    last: null,
  };

  const hud = cfg.debug
    ? new DebugHud(() => ({
        suit: `${profile.id} (${rig?.suit.visible ? 'shown' : 'hidden'})`,
        lock: faceLock ? `${lock.state}${faceLock.lastMatchMs > -Infinity ? ` · me ${((performance.now() - faceLock.lastMatchMs) / 1000).toFixed(1)}s ago` : ' · not seen yet'}` : 'central person',
        face: faceLock?.last
          ? `${faceLock.last.verdict}${faceLock.last.distance !== null ? ` ${faceLock.last.distance.toFixed(2)}` : ''} (#${faceLock.checks})`
          : identityNote,
        id: identityNote,
        match: lock.lastSimilarity !== null ? lock.lastSimilarity.toFixed(2) : '—',
        pose: `${poseRate.hz.toFixed(1)} Hz`,
        detect: `${detectMs.value.toFixed(1)} ms`,
        people: others.length + (wearer ? 1 : 0),
        backend: tracker.delegate ?? 'loading',
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
      const now = performance.now();
      const marks = faceLock?.marks ?? [];
      skeleton.draw(wearer, others, mapping, marks.map((m) => ({ x: m.x, y: m.y, verdict: m.verdict, ageMs: now - m.t })));
    }
    hud?.tick(time);
  });

  const haunt = new Haunt();
  startTrackingLoop();
  await loader.finish();
  haunt.show();
  arCredit.hidden = false;
  if (cfg.debug) console.info('[haunted-suit]', { config: cfg, suit: profile.id, backend: tracker.delegate });
}

void boot();
