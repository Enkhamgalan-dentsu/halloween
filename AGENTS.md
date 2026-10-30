# AGENTS.md — Haunted Suit (WebAR Halloween costume)

Instructions for AI coding agents (and humans) working in this repo. Read this first,
then `docs/PLAN.md` for the phase you are working on.

## What this is

The wearer has a printed QR marker on their **chest** and **back**. A guest scans it with
their phone camera → the URL opens this web app → the app uses the **rear camera**,
tracks the wearer's body, and renders a **rigged 3D Halloween suit** over them that
follows their movement in real time.

Fixed context: **indoor** party, **full‑body** suit, production URL **https://halloween-ruby.vercel.app**
(Vercel project `halloween-ruby`; the printed QR markers point here, so the project name must never change). There are **two costumes**, picked at random
(50/50) on every load, `?suit=mermaid|bonnie` to force one:
- **Creepy Mermaid** (`public/suits/mermaid.glb`, seenoise, CC BY 4.0) — rigged by us,
  identity rest rotations, **tail instead of legs** (the wearer's legs drive the tail).
- **Reanimated Melted Chocolate Bonnie** (`public/suits/bonnie.glb`, OrangeSauceu,
  CC BY 4.0) — came rigged (FBX T-pose, non-identity rest rotations), legs drive legs.
Both credits are shown (loading screen + small AR corner). Details: `docs/SUIT.md`.
The costume appears **only on the person wearing the printed QR marker** (wearer lock:
marker → then body continuity + clothing fingerprint; `?lock=0` disables). Markers to print:
`assets/markers/` (A3 recommended).
The app starts by itself (no tap): scary loading screen (`src/ui/loader.ts`, image
`public/loading.jpg`) while camera + tracker + suit load in parallel.

Hard deadline: **Halloween, 2026‑10‑31**. Code freeze 2026‑10‑30. Prefer simple and
robust over clever. A stable, slightly‑less‑fancy suit beats a jittery fancy one.

## Stack

| Concern | Choice |
|---|---|
| Build | Vite + TypeScript (strict), no UI framework |
| Rendering | three.js (`WebGLRenderer`, transparent canvas over `<video>`) |
| Body tracking | MediaPipe Tasks Vision — `PoseLandmarker` (33 landmarks, image + world) |
| Suit asset | `tools/build-suit/` → `public/suits/mermaid.glb` (Mixamo-named humanoid bones + tail chain) |
| Marker | Standard QR code (opens URL; also detected in‑frame for front/back) |
| Hosting | Vercel, `halloween-ruby.vercel.app`, config in `vercel.json` (`netlify.toml` kept as a mirror) |

No backend. No accounts. No analytics. No third‑party CDNs at runtime — the wasm and
models are self‑hosted from `public/`.

## Commands

```bash
npm run setup      # first time: installs deps (latest) + fetches wasm/models
npm run assets     # re-copy MediaPipe wasm + download pose models into public/
npm run dev        # HTTPS dev server on :5173, reachable from phones on the LAN
npm run typecheck  # tsc --noEmit — must pass before you finish any task
npm test           # node:test unit tests for pure modules (tests/*.test.ts, Node ≥ 22.6)
npm run build      # fetch assets (prebuild) + typecheck + production build into dist/
npm run preview    # serve dist/ locally
```

Testing on a phone: same Wi‑Fi, open `https://<laptop-LAN-IP>:5173`, accept the
self‑signed certificate warning once.

## Layout

```
index.html            start screen, <video id="camera">, <canvas id="overlay">
src/
  main.ts             boot + frame loop (camera → pose → rig → render)
  config.ts           URL → config: /F | /B marker paths, ?cam=front, ?debug, ?video=, ?model=
  camera.ts           getUserMedia + recorded-clip source, friendly errors
  scene.ts            three.js overlay scene/camera/renderer
  debug/hud.ts        ?debug overlay (FPS, video/screen size)
  util/viewport.ts    video-normalized ↔ screen mapping (object-fit: cover!)
  tracking/pose.ts    PoseTracker interface + landmark indices
  tracking/mediapipe-pose.ts  MediaPipe PoseLandmarker (download progress, GPU→CPU fallback)
  tracking/filters.ts One Euro filter
  tracking/smoothing.ts  PoseSmoother: One Euro on all landmarks (?mc= ?beta=)
  tracking/select.ts  torsoBox() + WearerSelector (only used with ?lock=0)
  tracking/wearer-lock.ts  WearerLock: marker-locked wearer, continuity, re-identification
  tracking/appearance.ts   clothing colour fingerprint (hue/grey histograms, top/bottom)
  markers/finder.ts   QR finder-pattern detector (no decode; works on iOS)
  markers/qr.ts       MarkerScanner: torso crops, marker search, fingerprint, Android decode
  markers/marker-grids.ts  module grids of the printed markers (tests render them)
  debug/skeleton.ts   ?debug 2D skeleton overlay
  util/fetch-bytes.ts fetch with progress
  util/rate.ts        RateCounter (Hz), Ema
  rig/bones.ts        solver bone keys + hierarchy (torso, arms, legs, tail)
  rig/profiles.ts     per-suit profile: node names, anchor, fit, credit; analyzeRig()
  rig/landmarks.ts    the ONE MediaPipe → three.js axis conversion, L/R swap, trust()
  rig/solver.ts       landmarks → per-bone rotation DELTAS from rest (any rig)
  rig/placement.ts    depth / scale / position of the suit root
  rig/facing.ts       front/back estimate (marker side + face visibility)
  rig/suit.ts         GLB loading; applies deltas through the real hierarchy + rest rotations
  ui/loader.ts        auto-start scary loading screen (static, glitches, whispers, progress)
  rig/follow.ts       ghost-like easing: spring root, per-bone lag (tail trails), hover bob
  markers/qr.ts       in-frame marker detection                     (Phase 4)
public/               served as-is: models/*.task, mediapipe/wasm/, suits/mermaid.glb
assets/               source files, NOT served: creepy_mermaid.glb (32 MB sculpt), markers/, recordings/
scripts/              node scripts (asset fetching, marker generation)
tools/build-suit/     browser pipeline: source sculpt → rigged suit GLB (see docs/SUIT.md)
tools/pose-lab/       dev page: synthetic poses → real solver + suit (no camera needed)
tests/                unit tests for pure modules (npm test)
docs/PLAN.md          the project plan — phases, decisions, risks
netlify.toml          SPA rewrites for /F and /B, cache headers (vercel.json mirrors it)
```

## Coordinate systems (get these right — most bugs live here)

- **MediaPipe image landmarks**: normalized `[0,1]` to the *video frame*, x right, y **down**.
- **MediaPipe world landmarks**: metres, origin at hip centre, x right, y **down**, z toward
  the camera (approx.). Convert to three.js (y **up**, right‑handed, camera looks −z) in
  exactly **one** function and nowhere else.
- **Screen**: the video is shown with `object-fit: cover`, so it is cropped. Always map
  landmarks with `util/viewport.ts` — never `x * window.innerWidth`.
- **Left/right**: MediaPipe `LEFT_*` is the *person's* left. With the rear camera (not
  mirrored) the person's left appears on the right of the image. The selfie camera
  (`?cam=front`) is mirrored in CSS and in `coverMapping(..., mirrored=true)`.
- **Back view**: when the wearer faces away, MediaPipe can swap left/right. Facing is
  decided by the marker side (`/B` path / in‑frame QR) first, nose/ear visibility second.

## Conventions

- TypeScript strict; no `any`; no non‑null `!` on DOM lookups outside `main.ts`.
- Erasable TypeScript only (`erasableSyntaxOnly`): no enums, namespaces or constructor
  parameter properties, so pure modules run directly with `node --experimental-strip-types`.
- Relative imports include the `.ts` extension (`import { x } from './y.ts'`) — required
  for Node to run the tests; Vite handles it fine.
- Tests live in `tests/`, use `node:test` + `node:assert/strict`, and only import pure
  modules (no DOM, no MediaPipe, no three.js renderer).
- Modules are small and single‑purpose. Pure math (solver, filters, mapping) has no DOM or
  three.js renderer dependency so it can be unit‑tested and run on recorded data.
- Only `main.ts` owns the frame loop. Other modules expose plain functions/classes.
- Tracking runs per camera frame and only sets the follower's *target*; the render loop
  (every screen frame) eases the displayed suit toward it (`SuitFollower.update(dt)`).
- No per‑frame allocations in hot paths (reuse `Vector3`/`Quaternion` scratch objects).
- three.js `q.slerpQuaternions(a, b, t)` copies `a` into `q` first — never pass `q` as `b`.
- Never block the UI on asset loading without a visible progress/status message.
- The printed QR payloads are exactly `HTTPS://HALLOWEEN-RUBY.VERCEL.APP/F` (chest) and
  `HTTPS://HALLOWEEN-RUBY.VERCEL.APP/B` (back) — uppercase so they encode in QR alphanumeric mode.
  `/F`, `/B` must keep working forever (config.ts + netlify.toml). Changing them after
  printing breaks the costume.
- Commit messages: imperative, scoped, e.g. `rig: solve forearm twist from wrist landmarks`.

## Performance budgets (mid‑range phone, ~2022)

| Item | Budget |
|---|---|
| Frame rate | ≥ 24 fps render, pose ≥ 15 Hz |
| Suit GLB | ≤ 5 MB, ≤ 40k triangles, textures ≤ 1024² (now 2.71 MB / 39.6k) — keep vertex tangents |
| Total first load | ≤ 25 MB (wasm ≈ 10 MB + lite model ≈ 6 MB + suit) |
| Pixel ratio | `min(devicePixelRatio, 2)` |

Use the **lite** pose model by default; `?model=full` exists for comparison only.

## Platform constraints

- Camera needs **HTTPS**. It is requested on page load (no tap); browsers that insist on a
  gesture (some in-app QR browsers) get an "Allow camera" button in the loader.
- `<video playsinline muted autoplay>` — all three are required on iOS Safari.
- QR scanners inside social apps (in‑app browsers) may block the camera; show a clear
  "open in Safari/Chrome" message rather than failing silently.
- Target: iOS Safari 16+, Chrome Android 110+. Desktop Chrome for development.

## Full body, indoors

- Guests need ~2–3 m to fit a standing adult in a portrait frame; closer than that the
  legs leave the frame. Out‑of‑frame or low‑visibility legs → ease them to a neutral
  standing pose and hide/fade the lower suit; never extrapolate.
- Indoor party light is dim, coloured and may flicker. Test with `?debug` under those
  conditions, not under office lighting.

## Testing

- `?debug` draws the landmark skeleton, FPS and facing state — use it for every change.
- `?video=/recordings/<clip>.mp4` replays a recorded clip (copy clips into `public/recordings/`
  locally; they are git‑ignored). Record: front, back, side, dancing, arms crossed, two
  people, low light, far (4 m) and near (1 m).
- `?cam=front` lets the wearer test alone with the selfie camera.
- `/tools/pose-lab/` shows the suit driven by synthetic poses — check rig changes there first.
- Tuning params (all optional): `?size=1` suit size multiplier, `?head=0` head pitch in
  degrees, `?fin=hang|trail`, `?zoom=0.5|1` wide vs normal lens, `?fov=63` 3D camera FOV,
  `?float=1` ghost-like easing (0 = locked to tracking, 2 = extra floaty).
  Size and position are estimated with the same FOV they're drawn with, so `fov` barely
  changes size — it only changes perspective strength. Use `?size` for size.
- MediaPipe `visibility` = not occluded; `presence` = in frame. Use `reliabilityOf()`
  (max of both) for *positions* (torso, limbs, depth); use visibility only for the face.
- Solver tests build synthetic MediaPipe frames with `tests/synthetic.ts`.
- Before finishing a task: `npm run typecheck` passes, and you state what you verified
  on a real phone vs. only on desktop.

## Do / Don't

- **Do** read `docs/PLAN.md` and update its checklist when you finish a phase item.
- **Do** degrade gracefully: low confidence → fade the suit, never show a twisted rig.
- **Don't** add a framework (React etc.), a backend, or a CDN dependency.
- **Don't** commit `node_modules/`, `public/mediapipe/wasm/`, `public/models/*.task`, or raw recordings.
- **Don't** change the marker URL format without updating the printed markers.
- **Don't** hand-edit `public/suits/*.glb`; change `tools/build-suit/` and rebuild.
- **Don't** remove the CC BY credits for the models (`profile.credit`, shown by main.ts).
- **Don't** assume identity rest rotations anywhere: the solver outputs deltas from rest and
  only `Suit.applyDeltas` turns them into local bone rotations.
- Adding a costume = a GLB in `public/suits/`, a profile in `rig/profiles.ts` (node names,
  anchor, shoulders, legs, fit, credit), and a test that its nodes exist.
