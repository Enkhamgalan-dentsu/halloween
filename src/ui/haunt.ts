/**
 * Spooky frame around the camera view: drifting fog creeping in from the edges, a
 * breathing dark-red vignette, something dripping from the top edge, film grain and the
 * odd dying-light flicker. Pure CSS animation (transforms/opacity → compositor only), so
 * it costs ~nothing next to pose tracking. Respects prefers-reduced-motion (styles.css).
 */

/** Tileable fog: fractal noise → pale green-grey smoke with soft alpha. */
const FOG_SVG = (seed: number, freq: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'>` +
      `<filter id='f' x='0' y='0' width='100%' height='100%'>` +
      `<feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='4' seed='${seed}' stitchTiles='stitch'/>` +
      `<feColorMatrix values='0 0 0 0 0.66  0 0 0 0 0.74  0 0 0 0 0.71  0 0 0 1.9 -0.78'/>` +
      `</filter><rect width='512' height='512' filter='url(#f)'/></svg>`,
  )}")`;

/** Fine grain, tiled small. */
const GRAIN_SVG = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 -0.12'/></filter>` +
    `<rect width='160' height='160' filter='url(#g)'/></svg>`,
)}")`;

/** Random drips hanging from the top edge (a different set on every load). */
function dripsSvg(rand: () => number): string {
  const drips: string[] = [];
  let x = 0;
  while (x < 100) {
    const w = 1.2 + rand() * 3.2;
    const len = 6 + rand() ** 2 * 34; // mostly short, a few long
    const cx = x + w / 2;
    const dur = (7 + rand() * 9).toFixed(1);
    const delay = (-rand() * 10).toFixed(1);
    // A rounded drop: down one side, bulb at the bottom, back up the other side.
    drips.push(
      `<path class='drip' style='animation-duration:${dur}s;animation-delay:${delay}s;transform-origin:${cx.toFixed(2)}px 0' ` +
        `d='M${x.toFixed(2)} 0 C${(x + w * 0.15).toFixed(2)} ${(len * 0.6).toFixed(1)} ${(cx - w * 0.5).toFixed(2)} ${(len * 0.85).toFixed(1)} ${(cx - w * 0.35).toFixed(2)} ${len.toFixed(1)} ` +
        `A${(w * 0.4).toFixed(2)} ${(w * 0.4).toFixed(2)} 0 0 0 ${(cx + w * 0.35).toFixed(2)} ${len.toFixed(1)} ` +
        `C${(cx + w * 0.5).toFixed(2)} ${(len * 0.85).toFixed(1)} ${(x + w * 0.85).toFixed(2)} ${(len * 0.6).toFixed(1)} ${(x + w).toFixed(2)} 0Z'/>`,
    );
    x += w + rand() * 7;
  }
  return (
    `<svg viewBox='0 0 100 44' preserveAspectRatio='none' xmlns='http://www.w3.org/2000/svg'>` +
    `<defs><linearGradient id='blood' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='#1a0004'/><stop offset='0.55' stop-color='#4a0410'/><stop offset='1' stop-color='#7a0a1c'/>` +
    `</linearGradient></defs>` +
    `<g fill='url(#blood)'><rect x='0' y='-1' width='100' height='3.2'/>${drips.join('')}</g></svg>`
  );
}

export class Haunt {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement = document.body, rand: () => number = Math.random) {
    const root = document.createElement('div');
    root.className = 'haunt';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      `<div class="haunt-fog"><div class="haunt-fog-layer haunt-fog-layer--a"></div><div class="haunt-fog-layer haunt-fog-layer--b"></div></div>` +
      `<div class="haunt-vignette"></div>` +
      `<div class="haunt-drips">${dripsSvg(rand)}</div>` +
      `<div class="haunt-grain"></div>` +
      `<div class="haunt-flicker"></div>`;
    root.style.setProperty('--fog-a', FOG_SVG(Math.floor(rand() * 999), 0.006));
    root.style.setProperty('--fog-b', FOG_SVG(Math.floor(rand() * 999), 0.011));
    root.style.setProperty('--grain', GRAIN_SVG);
    parent.appendChild(root);
    this.root = root;
  }

  /** Fade in (after the loading screen). */
  show(): void {
    requestAnimationFrame(() => this.root.classList.add('haunt--on'));
  }
}
