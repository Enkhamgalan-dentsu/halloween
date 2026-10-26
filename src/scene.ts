import * as THREE from 'three';

/**
 * Transparent three.js layer drawn on top of the <video>.
 * The camera here stands in for the phone camera: Phase 2 aligns its FOV with the
 * video and places the suit so its projection lines up with the 2D pose landmarks.
 */
export class OverlayScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement, fovDeg = 63) {
    this.camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.05, 50);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20101a, 1.2));
    const key = new THREE.DirectionalLight(0xffe2c0, 2.0);
    key.position.set(1, 2, 2);
    this.scene.add(key);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}
