// Copies the MediaPipe wasm runtime and downloads the pose models into public/
// so the app self-hosts everything (no third-party CDN at the party).
// Usage: npm run assets   (after `npm install`)
import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe', 'wasm');
const modelDir = join(root, 'public', 'models');

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
};

const exists = (p) => access(p).then(() => true, () => false);

if (!(await exists(wasmSrc))) {
  console.error('✗ @mediapipe/tasks-vision is not installed. Run `npm run setup` first.');
  process.exit(1);
}
await mkdir(wasmDst, { recursive: true });
await cp(wasmSrc, wasmDst, { recursive: true });
console.log('✓ wasm   →', 'public/mediapipe/wasm');

await mkdir(modelDir, { recursive: true });
for (const [file, url] of Object.entries(MODELS)) {
  const dst = join(modelDir, file);
  if (await exists(dst)) {
    console.log('✓ model  →', `public/models/${file} (cached)`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`✗ ${file}: HTTP ${res.status}`);
    process.exit(1);
  }
  await writeFile(dst, Buffer.from(await res.arrayBuffer()));
  console.log('✓ model  →', `public/models/${file}`);
}
