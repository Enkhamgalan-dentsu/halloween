/**
 * The scary loading screen: the well image creeping closer under VHS static, scanlines,
 * a rolling tracking bar and glitch flickers (CSS), plus live TV noise (this canvas) and
 * rotating whispers. It starts on page load — no tap — and fades out with a burst of
 * static once the camera, tracker and suit are all ready.
 */
const WHISPERS = [
  'Waking the dead…',
  'Something is climbing out…',
  "Don't look away…",
  'It knows you are here…',
  'Closer…',
  'Do not blink…',
];

export class Loader {
  private readonly root = document.getElementById('loader') as HTMLDivElement;
  private readonly fill = document.getElementById('loader-fill') as HTMLDivElement;
  private readonly status = document.getElementById('loader-status') as HTMLParagraphElement;
  private readonly title = document.getElementById('loader-title') as HTMLParagraphElement;
  private readonly retry = document.getElementById('retry-btn') as HTMLButtonElement;
  private readonly credit = document.getElementById('loader-credit') as HTMLParagraphElement;
  private readonly noise = document.getElementById('loader-noise') as HTMLCanvasElement;
  private readonly started = performance.now();
  private percent = 0;
  private whisper = 0;
  private message: string | null = null;
  private running = true;
  private timer = 0;

  constructor() {
    this.startNoise();
    this.timer = window.setInterval(() => {
      this.whisper = (this.whisper + 1) % WHISPERS.length;
      this.render();
    }, 2400);
    this.render();
  }

  setProgress(fraction: number): void {
    this.percent = Math.max(this.percent, Math.min(99, Math.round(fraction * 100)));
    this.fill.style.width = `${this.percent}%`;
    this.render();
  }

  /** Model credit (CC BY): title + author with links. */
  setCredit(html: string): void {
    this.credit.innerHTML = html;
  }

  /** Show a problem (e.g. camera blocked) and optionally a button that retries. */
  showError(message: string, retryLabel: string | null, onRetry?: () => void): void {
    this.message = message;
    this.title.textContent = 'It cannot see you';
    this.title.dataset.text = 'It cannot see you';
    this.retry.hidden = retryLabel === null;
    if (retryLabel !== null) {
      this.retry.textContent = retryLabel;
      this.retry.onclick = () => {
        this.retry.hidden = true;
        this.message = null;
        this.title.textContent = "It's coming";
        this.title.dataset.text = "It's coming";
        this.render();
        onRetry?.();
      };
    }
    this.render();
  }

  /** Fade out (after a minimum creep time so the animation is actually seen). */
  async finish(minVisibleMs = 2600): Promise<void> {
    this.fill.style.width = '100%';
    this.percent = 100;
    this.render();
    const wait = minVisibleMs - (performance.now() - this.started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.root.classList.add('loader--out');
    await new Promise((r) => setTimeout(r, 900));
    this.root.hidden = true;
    this.running = false;
    window.clearInterval(this.timer);
  }

  private render(): void {
    this.status.textContent = this.message ?? `${WHISPERS[this.whisper] ?? ''} ${this.percent}%`;
  }

  /** Low-res random static, redrawn ~20×/s and scaled up (cheap on phones). */
  private startNoise(): void {
    const ctx = this.noise.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.noise;
    const img = ctx.createImageData(width, height);
    let last = 0;
    const draw = (now: number) => {
      if (!this.running) return;
      if (now - last > 50) {
        last = now;
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          d[i] = v * 0.55;
          d[i + 1] = v;
          d[i + 2] = v * 0.85;
          d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }
}
