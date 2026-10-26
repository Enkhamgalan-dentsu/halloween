/**
 * ?debug overlay: frame rate and the numbers needed to tune the camera/solver on a
 * real phone (video resolution vs. screen size, pixel ratio, marker side).
 */
export type HudInfo = Record<string, string | number | boolean>;

export class DebugHud {
  private readonly el: HTMLPreElement;
  private readonly getInfo: () => HudInfo;
  private frames = 0;
  private windowStart = -1;
  private fps = 0;

  constructor(getInfo: () => HudInfo) {
    this.getInfo = getInfo;
    this.el = document.createElement('pre');
    this.el.id = 'debug-hud';
    document.body.appendChild(this.el);
  }

  /** Call once per rendered frame. */
  tick(nowMs: number): void {
    if (this.windowStart < 0) this.windowStart = nowMs;
    this.frames++;
    const elapsed = nowMs - this.windowStart;
    if (elapsed < 500) return;
    this.fps = (this.frames * 1000) / elapsed;
    this.frames = 0;
    this.windowStart = nowMs;
    this.draw();
  }

  private draw(): void {
    const lines = [`fps     ${this.fps.toFixed(1)}`];
    for (const [k, v] of Object.entries(this.getInfo())) lines.push(`${k.padEnd(7)} ${v}`);
    this.el.textContent = lines.join('\n');
  }

  dispose(): void {
    this.el.remove();
  }
}
