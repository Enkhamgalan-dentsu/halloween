# build-suit

Turns `assets/creepy_mermaid.glb` (static sculpt) into the rigged, phone-sized
`public/suits/mermaid.glb`. Details and design decisions: [`docs/SUIT.md`](../../docs/SUIT.md).

Run: `npm run dev` → open `https://localhost:5173/tools/build-suit/` → **Build** → save
the download to `public/suits/mermaid.glb`.

Plain browser JS (needs `<canvas>` for textures); the module exports `buildSuit()` and
`CONFIG`, so it can also be driven headless (Playwright) — `window.runBuild()` returns
`{ glb, report }`.
