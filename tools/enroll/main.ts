/**
 * Enrollment tool (dev only: `npm run dev` → /tools/enroll/). Captures the wearer's face
 * descriptors with the SAME pipeline the app uses at the party (head crop → 160×160 →
 * face-api descriptor), plus a full-resolution one per sample, and saves wearer.json.
 * Verify mode shows live distance / verdict against the current samples.
 */
import { FaceEngine } from '../../src/identity/face-engine.ts';
import type { FaceInput, FaceResult } from '../../src/identity/face-engine.ts';
import { bestDistance, euclidean, judge, parseEnrollment, spread } from '../../src/identity/matcher.ts';
import type { Enrollment } from '../../src/identity/matcher.ts';

interface Sample {
  thumb: string;
  descriptors: number[][]; // [crop-160 (party pipeline), full-res]
}

const MAX_SAMPLES = 24;
const AUTO_TARGET = 10;
const MIN_FACE_PX = 90;
/** Skip a capture that is nearly identical to one we already have. */
const MIN_NOVELTY = 0.12;
const PROMPTS = [
  'Look straight at the camera',
  'Turn your head a little to the left',
  'Turn your head a little to the right',
  'Chin up a little',
  'Chin down a little',
  'Smile',
  'Neutral face',
  'Step back a bit',
  'Tilt your head',
  'Look straight again',
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const overlay = $<HTMLCanvasElement>('overlay');
const say = $<HTMLDivElement>('say');
const btnStart = $<HTMLButtonElement>('start');
const btnCapture = $<HTMLButtonElement>('capture');
const btnVerify = $<HTMLButtonElement>('verify');
const btnDownload = $<HTMLButtonElement>('download');
const btnClear = $<HTMLButtonElement>('clear');
const inputPhotos = $<HTMLInputElement>('photos');
const inputLoad = $<HTMLInputElement>('load');
const grid = $<HTMLDivElement>('grid');
const stats = $<HTMLParagraphElement>('stats');
const verdictEl = $<HTMLParagraphElement>('verdict');
const verifyStats = $<HTMLParagraphElement>('verifyStats');

const crop = document.createElement('canvas');
crop.width = crop.height = 160;
const cropCtx = crop.getContext('2d')!;

let engine: FaceEngine | null = null;
let samples: Sample[] = [];
let loaded: number[][] = []; // descriptors from a loaded wearer.json (no thumbnails)
let capturing = false;
let verifying = false;
let busy = false;

const allDescriptors = () => [...samples.flatMap((s) => s.descriptors), ...loaded];
const enrollment = (): Enrollment => ({
  version: 1,
  model: 'face-api/face_recognition_model',
  createdAt: new Date().toISOString(),
  descriptors: allDescriptors().map((d) => d.map((v) => Math.round(v * 1e5) / 1e5)),
});

/** Same crop as the app (identity/head.ts: side ≈ face height × 2.2), scaled to 160 px. */
function cropAround(input: FaceInput, box: FaceResult['box'], w: number, h: number): boolean {
  const side = box.height * 2.2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2 - box.height * 0.05;
  cropCtx.fillStyle = '#000';
  cropCtx.fillRect(0, 0, 160, 160);
  const sx = cx - side / 2;
  const sy = cy - side / 2;
  if (side < 8 || w <= 0 || h <= 0) return false;
  cropCtx.drawImage(input, sx, sy, side, side, 0, 0, 160, 160);
  return true;
}

const sizeOf = (input: FaceInput) =>
  input instanceof HTMLVideoElement
    ? { w: input.videoWidth, h: input.videoHeight }
    : input instanceof HTMLImageElement
      ? { w: input.naturalWidth, h: input.naturalHeight }
      : { w: input.width, h: input.height };

/** One sample from a frame/photo, or a reason it was skipped. */
async function sampleFrom(input: FaceInput, inputSize: number): Promise<Sample | string> {
  if (!engine) return 'models still loading';
  const { w, h } = sizeOf(input);
  const full = await engine.analyze(input, inputSize);
  if (!full) return 'no face found';
  drawBox(full, w, h);
  if (full.box.height < MIN_FACE_PX) return 'come a little closer';
  if (!cropAround(input, full.box, w, h)) return 'no face found';
  const small = await engine.describe(crop, 160);
  if (!small) return 'face too small / blurry';
  return { thumb: crop.toDataURL('image/jpeg', 0.7), descriptors: [Array.from(small), Array.from(full.descriptor)] };
}

function drawBox(face: FaceResult | null, w: number, h: number, color = '#ffe14d'): void {
  overlay.width = w;
  overlay.height = h;
  const ctx = overlay.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (!face) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, w / 200);
  const b = face.box;
  ctx.strokeRect(b.x, b.y, b.width, b.height);
}

function novelty(s: Sample): number {
  const all = allDescriptors();
  if (all.length === 0) return Infinity;
  return Math.min(...all.map((d) => euclidean(d, s.descriptors[0]!)));
}

function addSample(s: Sample): void {
  if (samples.length >= MAX_SAMPLES) return;
  samples.push(s);
  render();
}

function render(): void {
  const all = allDescriptors();
  grid.replaceChildren();
  samples.forEach((s, i) => {
    const others = all.filter((d) => !s.descriptors.includes(d));
    const mean = others.length ? others.reduce((a, d) => a + euclidean(d, s.descriptors[0]!), 0) / others.length : 0;
    const fig = document.createElement('figure');
    if (mean > 0.55) fig.className = 'outlier';
    const img = document.createElement('img');
    img.src = s.thumb;
    const cap = document.createElement('figcaption');
    cap.textContent = others.length ? mean.toFixed(2) : '—';
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = 'Remove sample';
    del.onclick = () => {
      samples.splice(i, 1);
      render();
    };
    fig.append(img, cap, del);
    grid.append(fig);
  });
  const n = samples.length;
  const outliers = grid.querySelectorAll('figure.outlier').length;
  stats.textContent = all.length
    ? `${n} samples${loaded.length ? ` + ${loaded.length} loaded descriptors` : ''} · spread ${spread(all).toFixed(2)} (same person ≈ 0.25–0.45)` +
      (outliers ? ` · ${outliers} outlier${outliers > 1 ? 's' : ''} (red) — remove if it isn’t you` : '') +
      (all.length < 6 ? ' · capture at least 3 samples' : '')
    : 'No samples yet.';
  btnDownload.disabled = all.length < 6 && !(all.length >= 3 && loaded.length >= 3);
  btnClear.disabled = all.length === 0;
  btnVerify.disabled = !engine || all.length < 3 || !video.srcObject;
}

async function startCamera(): Promise<void> {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    await video.play();
    btnStart.disabled = true;
    btnCapture.disabled = false;
    say.textContent = 'Ready. Press Auto-capture and follow the prompts.';
    render();
    requestAnimationFrame(loop);
  } catch (err) {
    say.textContent = `Camera error: ${err instanceof Error ? err.message : String(err)} (needs https or localhost)`;
  }
}

let lastTick = 0;
let promptIndex = 0;
let promptSince = 0;
let captured = 0;

async function loop(now: number): Promise<void> {
  requestAnimationFrame(loop);
  if (busy || !engine || video.readyState < 2 || now - lastTick < 300) return;
  lastTick = now;
  busy = true;
  try {
    if (capturing) await captureStep(now);
    else if (verifying) await verifyStep();
  } finally {
    busy = false;
  }
}

async function captureStep(now: number): Promise<void> {
  if (now - promptSince < 900) return; // give them time to follow the prompt
  const s = await sampleFrom(video, 320);
  if (typeof s === 'string') {
    say.textContent = `${PROMPTS[promptIndex % PROMPTS.length]} — ${s}`;
    return;
  }
  if (novelty(s) < MIN_NOVELTY && captured > 0) {
    say.textContent = `${PROMPTS[promptIndex % PROMPTS.length]} — move a bit more`;
    return;
  }
  addSample(s);
  captured++;
  promptIndex++;
  promptSince = now;
  if (captured >= AUTO_TARGET) {
    capturing = false;
    btnCapture.textContent = 'Auto-capture';
    say.textContent = `Done: ${captured} samples. Try Verify, then download.`;
    return;
  }
  say.textContent = `✓ ${captured}/${AUTO_TARGET} · ${PROMPTS[promptIndex % PROMPTS.length]}`;
}

async function verifyStep(): Promise<void> {
  const all = allDescriptors();
  const s = await sampleFrom(video, 320);
  if (typeof s === 'string') {
    verdictEl.textContent = '';
    verifyStats.textContent = s;
    return;
  }
  const e: Enrollment = { ...enrollment(), descriptors: all };
  const dCrop = bestDistance(s.descriptors[0]!, e);
  const dFull = bestDistance(s.descriptors[1]!, e);
  const v = judge(dCrop);
  verdictEl.textContent = v === 'match' ? 'MATCH — it’s you' : v === 'other' ? 'NOT the wearer' : 'unsure';
  verdictEl.style.color = v === 'match' ? 'var(--ok)' : v === 'other' ? 'var(--bad)' : 'var(--meh)';
  verifyStats.textContent = `party pipeline (160 px crop) ${dCrop.toFixed(3)} · full-res ${dFull.toFixed(3)} · match < 0.50, other > 0.62. Ask a friend to try: they should get NOT the wearer.`;
}

btnStart.onclick = () => void startCamera();
btnCapture.onclick = () => {
  capturing = !capturing;
  verifying = false;
  btnVerify.textContent = 'Verify: off';
  verdictEl.textContent = verifyStats.textContent = '';
  btnCapture.textContent = capturing ? 'Stop' : 'Auto-capture';
  captured = 0;
  promptIndex = 0;
  promptSince = performance.now() - 900;
  say.textContent = capturing ? PROMPTS[0]! : 'Paused.';
};
btnVerify.onclick = () => {
  verifying = !verifying;
  capturing = false;
  btnCapture.textContent = 'Auto-capture';
  btnVerify.textContent = verifying ? 'Verify: on' : 'Verify: off';
  say.textContent = verifying ? 'Verifying live…' : 'Ready.';
  if (!verifying) verdictEl.textContent = verifyStats.textContent = '';
};
btnClear.onclick = () => {
  if (!confirm('Remove all samples?')) return;
  samples = [];
  loaded = [];
  render();
};
btnDownload.onclick = () => {
  const blob = new Blob([JSON.stringify(enrollment())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wearer.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
inputLoad.onchange = async () => {
  const file = inputLoad.files?.[0];
  inputLoad.value = '';
  if (!file) return;
  const e = parseEnrollment(JSON.parse(await file.text()));
  if (!e) {
    alert('Not a valid wearer.json (needs ≥3 descriptors).');
    return;
  }
  loaded = e.descriptors;
  render();
};
inputPhotos.onchange = async () => {
  const files = Array.from(inputPhotos.files ?? []);
  inputPhotos.value = '';
  let ok = 0;
  const skipped: string[] = [];
  for (const file of files) {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    try {
      await img.decode();
      while (busy) await new Promise((r) => setTimeout(r, 50));
      busy = true;
      const s = await sampleFrom(img, 416);
      if (typeof s === 'string') skipped.push(`${file.name}: ${s}`);
      else {
        addSample(s);
        ok++;
      }
    } catch {
      skipped.push(`${file.name}: could not read`);
    } finally {
      busy = false;
      URL.revokeObjectURL(img.src);
    }
  }
  say.textContent = `Added ${ok} photo${ok === 1 ? '' : 's'}${skipped.length ? ` · skipped: ${skipped.join('; ')}` : ''}`;
};

say.textContent = 'Loading face models…';
FaceEngine.load()
  .then((e) => {
    engine = e;
    btnStart.disabled = false;
    say.textContent = `Models ready (${e.backend}). Start the camera, or add photos of the wearer.`;
    render();
  })
  .catch((err) => {
    console.error(err);
    say.textContent = 'Could not load face models — run `npm install && npm run assets` first.';
  });
