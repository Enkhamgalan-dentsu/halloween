# Haunted Suit — WebAR Halloween costume

Scan the QR → point the phone at the wearer → their face is recognized and they become a
creepy mermaid or a melted chocolate animatronic (random each time), following their
movement. Nobody else in frame gets the costume.

```bash
npm run setup   # install dependencies + fetch MediaPipe wasm/models + face models
npm run dev     # https://localhost:5173 (and https://<LAN-IP>:5173 for phones)
```

Enroll the wearer once: `npm run dev` → open `/tools/enroll/` → Auto-capture (≈10
samples, in the look you'll have at the party) → Verify → **Download wearer.json** → save
it as `public/face/wearer.json` → build and deploy. Without it, the most central person
gets the costume.

Print: `assets/qr/halloween-qr-A4.pdf` (opens https://halloween-ruby.vercel.app).

Privacy: `wearer.json` holds face descriptors (numbers, not photos) and is public once
deployed. Delete it from the repo/site after Halloween.

- Plan: [`docs/PLAN.md`](docs/PLAN.md)
- Agent/developer guide: [`AGENTS.md`](AGENTS.md)
